/**
 * Browser-like headers to bypass 403 from sites that block non-browser requests.
 * Injected into proxied requests (sessionId + destination URL) before hammerhead.
 *
 * Anti-proxy bypass: spoof Referer/Origin to match destination; use parent page
 * Referer for CDN subresources; map CDN hosts to main site for Referer.
 */

const getSessionId = require('./getSessionId');
const StrShuffler = require('./StrShuffler');
const { NEW_PATHS, OLD_PATHS } = require('./patchServiceRoutes');

// Hammerhead task scripts are served under both their renamed paths (e.g. /_a/t.js)
// and their legacy /task.js / /iframe-task.js aliases. injectBrowserLikeHeaders has
// to early-return for ALL of those, otherwise the pipeline mangles the Referer that
// hammerhead needs to warm the session and unshuffle the URL.
const TASK_SCRIPT_PATHS = new Set([
    NEW_PATHS.task, NEW_PATHS.iframeTask,
    OLD_PATHS.task, OLD_PATHS.iframeTask,
]);

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Use gzip, deflate only to avoid ERR_CONTENT_DECODING_FAILED when pipeline decompresses/rewrites then re-encodes (br/zstd often mis-handled)
const ACCEPT_ENCODING_SAFE = 'gzip, deflate';

// Chrome HTTP/1.1 header wire order (fingerprinted by anti-bot services)
const CHROME_DOC_ORDER = [
    'host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile',
    'sec-ch-ua-full-version-list', 'sec-ch-ua-platform',
    'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model',
    'sec-ch-ua-platform-version',
    'upgrade-insecure-requests', 'user-agent', 'accept',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user', 'sec-fetch-dest',
    'referer', 'accept-encoding', 'accept-language', 'dnt',
    'cache-control', 'cookie', 'priority',
];
const CHROME_SUB_ORDER = [
    'host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile',
    'sec-ch-ua-full-version-list', 'sec-ch-ua-platform',
    'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-model',
    'sec-ch-ua-platform-version',
    'user-agent', 'accept', 'x-requested-with',
    // Discord-specific headers used for anti-abuse fingerprinting. Keep them in a stable
    // position (after x-requested-with, before referer) to match real Chrome behavior.
    'x-super-properties', 'x-fingerprint', 'x-discord-locale', 'x-discord-timezone',
    'x-debug-options', 'x-track',
    'referer', 'origin',
    'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest',
    'accept-encoding', 'accept-language', 'dnt',
    'cookie', 'priority',
];
function _reorderHeaders(headers, order) {
    const snapshot = Object.assign(Object.create(null), headers);
    for (const k of Object.keys(headers)) delete headers[k];
    for (const k of order) {
        if (k in snapshot) { headers[k] = snapshot[k]; delete snapshot[k]; }
    }
    for (const k of Object.keys(snapshot)) headers[k] = snapshot[k];
}

const DOCUMENT_HEADERS = {
    'user-agent': CHROME_UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'accept-encoding': ACCEPT_ENCODING_SAFE,
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-full-version-list': '"Google Chrome";v="131.0.6778.265", "Chromium";v="131.0.6778.265", "Not_A Brand";v="24.0.0.0"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0',
    'connection': 'keep-alive',
    'dnt': '0',
};

const SUBRESOURCE_HEADERS = {
    'user-agent': CHROME_UA,
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'accept-encoding': ACCEPT_ENCODING_SAFE,
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-full-version-list': '"Google Chrome";v="131.0.6778.265", "Chromium";v="131.0.6778.265", "Not_A Brand";v="24.0.0.0"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'dnt': '0',
    'priority': 'u=1',
};

// Region-specific Accept-Language (host pattern -> value)
const ZH_FIRST_HOST_RE = /\.?bilibili\.(com|cn)$|\.?douyin\.com$|\.?biliapi\.|\.?hdslb\.com$|\.?bilivideo\.|\.?taobao\.com$|\.?tmall\.|\.?weibo\.com$|\.?zhihu\.com$|\.?qq\.com$|\.?baidu\.com$|\.?jd\.com$|\.?163\.com$|\.?deepseek\.(com|ai)$|\.?doubao\.com$|\.?volccdn\.com$|\.?volces\.com$|\.?volcengine\.com$|\.?qianwen\.com$|\.?tongyi\.aliyun\.com$|\.?alicdn\.com$/i;
const JA_FIRST_HOST_RE = /\.?nicovideo\.jp$|\.?yahoo\.co\.jp$|\.?rakuten\.co\.jp$|\.?dmm\.co\.jp$|\.?pixiv\.net$|\.?line\.me$|\.?fc2\.com$/i;
const KO_FIRST_HOST_RE = /\.?naver\.(com|co\.kr)$|\.?daum\.net$|\.?kakao\.(com|co\.kr)$|\.?nate\.com$|\.?tistory\.com$/i;

// CDN/subdomain -> main site origin for Referer (sites block proxy Referer)
const CDN_REFERER_MAP = [
    [/poki-cdn\.com$/i, 'https://poki.com'],
    [/\.?poki\.com$/i, 'https://poki.com'],
    [/\.?discord\.com$/i, 'https://discord.com'],
    [/\.?discordapp\.com$/i, 'https://discord.com'],
    [/\.?cloudflare\.com$/i, 'https://www.cloudflare.com'],
    // Amazon
    [/\.?amazon\.(com|co\.\w+|de|fr|it|es|ca|com\.au|co\.jp|in|com\.br)$/i, 'https://www.amazon.com'],
    [/\.?ssl-images-amazon\.com$/i, 'https://www.amazon.com'],
    [/\.?media-amazon\.com$/i, 'https://www.amazon.com'],
    [/\.?images-amazon\.com$/i, 'https://www.amazon.com'],
    [/\.?cloudfront\.net$/i, 'https://www.amazon.com'],
    // Netflix
    [/\.?netflix\.com$/i, 'https://www.netflix.com'],
    [/\.?nflxvideo\.net$/i, 'https://www.netflix.com'],
    [/\.?nflxso\.net$/i, 'https://www.netflix.com'],
    [/\.?nflxext\.com$/i, 'https://www.netflix.com'],
    [/\.?nflximg\.net$/i, 'https://www.netflix.com'],
    // LinkedIn
    [/\.?linkedin\.com$/i, 'https://www.linkedin.com'],
    [/\.?licdn\.com$/i, 'https://www.linkedin.com'],
    [/\.?linkedin\.sc$/i, 'https://www.linkedin.com'],
    // Canva
    [/\.?canva\.com$/i, 'https://www.canva.com'],
    [/\.?canva\.cn$/i, 'https://www.canva.com'],
    // Slack
    [/\.?slack\.com$/i, 'https://slack.com'],
    [/\.?slack-edge\.com$/i, 'https://slack.com'],
    [/\.?slack-imgs\.com$/i, 'https://slack.com'],
    [/\.?slack-files\.com$/i, 'https://slack.com'],
    // GitLab
    [/\.?gitlab\.com$/i, 'https://gitlab.com'],
    [/\.?gitlab\.net$/i, 'https://gitlab.com'],
    // Figma
    [/\.?figma\.com$/i, 'https://www.figma.com'],
    [/\.?figmacdn\.com$/i, 'https://www.figma.com'],
    // Reddit
    [/\.?reddit\.com$/i, 'https://www.reddit.com'],
    [/\.?redditstatic\.com$/i, 'https://www.reddit.com'],
    [/\.?redditmedia\.com$/i, 'https://www.reddit.com'],
    [/\.?redd\.it$/i, 'https://www.reddit.com'],
    // Vercel
    [/\.?vercel\.com$/i, 'https://vercel.com'],
    [/\.?vercel\.app$/i, 'https://vercel.com'],
    [/\.?vercel-insights\.com$/i, 'https://vercel.com'],
    // YouTube
    [/\.?googlevideo\.com$/i, 'https://www.youtube.com'],
    [/\.?youtube\.com$/i, 'https://www.youtube.com'],
    [/\.?ytimg\.com$/i, 'https://www.youtube.com'],
    [/\.?ggpht\.com$/i, 'https://www.youtube.com'],
    // Twitch
    [/\.?twitch\.tv$/i, 'https://www.twitch.tv'],
    [/\.?twitchcdn\.net$/i, 'https://www.twitch.tv'],
    // Douyin / TikTok
    [/\.?douyin\.com$/i, 'https://www.douyin.com'],
    [/\.?douyinpic\.com$/i, 'https://www.douyin.com'],
    [/\.?douyincdn\.com$/i, 'https://www.douyin.com'],
    [/\.?douyinstatic\.com$/i, 'https://www.douyin.com'],
    [/\.?iesdouyin\.com$/i, 'https://www.douyin.com'],
    [/\.?byteimg\.com$/i, 'https://www.douyin.com'],
    [/\.?bytecdn\.cn$/i, 'https://www.douyin.com'],
    [/\.?bytecdn\.com$/i, 'https://www.douyin.com'],
    [/\.?bytegoofy\.com$/i, 'https://www.douyin.com'],
    [/\.?tiktok\.com$/i, 'https://www.tiktok.com'],
    [/\.?tiktokcdn\.com$/i, 'https://www.tiktok.com'],
    [/\.?musical\.ly$/i, 'https://www.tiktok.com'],
    // Bilibili
    [/\.?bilibili\.com$/i, 'https://www.bilibili.com'],
    [/\.?bilibili\.cn$/i, 'https://www.bilibili.com'],
    [/\.?bilivideo\.com$/i, 'https://www.bilibili.com'],
    [/\.?bilivideo\.cn$/i, 'https://www.bilibili.com'],
    [/\.?hdslb\.com$/i, 'https://www.bilibili.com'],
    [/\.?biliapi\.net$/i, 'https://www.bilibili.com'],
    [/\.?biliapi\.com$/i, 'https://www.bilibili.com'],
    [/\.?szbdyd\.com$/i, 'https://www.bilibili.com'],
    // Reddit
    [/\.?reddit\.com$/i, 'https://www.reddit.com'],
    [/\.?redditstatic\.com$/i, 'https://www.reddit.com'],
    [/\.?redditmedia\.com$/i, 'https://www.reddit.com'],
    // Twitter / X
    [/\.?twitter\.com$/i, 'https://twitter.com'],
    [/\.?x\.com$/i, 'https://twitter.com'],
    [/\.?twimg\.com$/i, 'https://twitter.com'],
    [/\.?abs\.twimg\.com$/i, 'https://twitter.com'],
    [/\.?pbs\.twimg\.com$/i, 'https://twitter.com'],
    [/\.?video\.twimg\.com$/i, 'https://twitter.com'],
    [/\.?ton\.twitter\.com$/i, 'https://twitter.com'],
    // Instagram
    [/\.?instagram\.com$/i, 'https://www.instagram.com'],
    [/\.?cdninstagram\.com$/i, 'https://www.instagram.com'],
    [/\.?fbcdn\.net$/i, 'https://www.facebook.com'],
    // Facebook
    [/\.?facebook\.com$/i, 'https://www.facebook.com'],
    [/\.?fb\.com$/i, 'https://www.facebook.com'],
    [/\.?fbcdn\.net$/i, 'https://www.facebook.com'],
    [/\.?xx\.fbcdn\.net$/i, 'https://www.facebook.com'],
    // Netflix
    [/\.?netflix\.com$/i, 'https://www.netflix.com'],
    [/\.?nflxvideo\.net$/i, 'https://www.netflix.com'],
    [/\.?nflxso\.net$/i, 'https://www.netflix.com'],
    [/\.?nflxext\.com$/i, 'https://www.netflix.com'],
    // Spotify
    [/\.?spotify\.com$/i, 'https://open.spotify.com'],
    [/\.?scdn\.co$/i, 'https://open.spotify.com'],
    [/\.?spotifycdn\.com$/i, 'https://open.spotify.com'],
    // Vimeo
    [/\.?vimeo\.com$/i, 'https://vimeo.com'],
    [/\.?vimeocdn\.com$/i, 'https://vimeo.com'],
    [/\.?cloud\.vimeo\.com$/i, 'https://vimeo.com'],
    // Imgur
    [/\.?imgur\.com$/i, 'https://imgur.com'],
    [/\.?i\.imgur\.com$/i, 'https://imgur.com'],
    // GitHub (raw / cdn)
    [/\.?github\.com$/i, 'https://github.com'],
    [/\.?githubassets\.com$/i, 'https://github.com'],
    [/\.?githubusercontent\.com$/i, 'https://github.com'],
    [/\.?raw\.githubusercontent\.com$/i, 'https://github.com'],
    // Medium
    [/\.?medium\.com$/i, 'https://medium.com'],
    [/\.?cdn-images-\d+\.medium\.com$/i, 'https://medium.com'],
    // Pinterest
    [/\.?pinterest\.com$/i, 'https://www.pinterest.com'],
    [/\.?pinimg\.com$/i, 'https://www.pinterest.com'],
    // LinkedIn
    [/\.?linkedin\.com$/i, 'https://www.linkedin.com'],
    [/\.?licdn\.com$/i, 'https://www.linkedin.com'],
    // WhatsApp / Meta CDN
    [/\.?whatsapp\.net$/i, 'https://web.whatsapp.com'],
    [/\.?whatsapp\.com$/i, 'https://web.whatsapp.com'],
    [/\.?cdn\.whatsapp\.net$/i, 'https://web.whatsapp.com'],
    // Telegram
    [/\.?t\.me$/i, 'https://web.telegram.org'],
    [/\.?telegram\.org$/i, 'https://web.telegram.org'],
    [/\.?telegram-cdn\.org$/i, 'https://web.telegram.org'],
    // Discord CDN (already above, keep)
    // Steam
    [/\.?steampowered\.com$/i, 'https://store.steampowered.com'],
    [/\.?steamcommunity\.com$/i, 'https://steamcommunity.com'],
    [/\.?steamstatic\.com$/i, 'https://store.steampowered.com'],
    [/\.?steamcdn-a\.akamaihd\.net$/i, 'https://store.steampowered.com'],
    // SoundCloud
    [/\.?soundcloud\.com$/i, 'https://soundcloud.com'],
    [/\.?sndcdn\.com$/i, 'https://soundcloud.com'],
    // VK
    [/\.?vk\.com$/i, 'https://vk.com'],
    [/\.?vk-cdn\.net$/i, 'https://vk.com'],
    [/\.?vk\.me$/i, 'https://vk.com'],
    // Nicovideo (Japan)
    [/\.?nicovideo\.jp$/i, 'https://www.nicovideo.jp'],
    [/\.?nimg\.jp$/i, 'https://www.nicovideo.jp'],
    // Naver (Korea)
    [/\.?naver\.com$/i, 'https://www.naver.com'],
    [/\.?naver\.co\.kr$/i, 'https://www.naver.com'],
    [/\.?navercorp\.com$/i, 'https://www.naver.com'],
    [/\.?nhncorp\.com$/i, 'https://www.naver.com'],
    [/\.?pstatic\.net$/i, 'https://www.naver.com'],
    // Pixiv
    [/\.?pixiv\.net$/i, 'https://www.pixiv.net'],
    [/\.?i\.pixiv\.net$/i, 'https://www.pixiv.net'],
    [/\.?pixiv\.net$/i, 'https://www.pixiv.net'],
    // Wikipedia / Wikimedia
    [/\.?wikipedia\.org$/i, 'https://www.wikipedia.org'],
    [/\.?wikimedia\.org$/i, 'https://www.wikipedia.org'],
    [/\.?upload\.wikimedia\.org$/i, 'https://www.wikipedia.org'],
    // Google (drive, docs, etc.)
    [/\.?google\.com$/i, 'https://www.google.com'],
    [/\.?googleapis\.com$/i, 'https://www.google.com'],
    [/\.?gstatic\.com$/i, 'https://www.google.com'],
    [/\.?googleusercontent\.com$/i, 'https://www.google.com'],
    // ChatGPT / OpenAI
    [/\.?chatgpt\.com$/i, 'https://chatgpt.com'],
    [/\.?openai\.com$/i, 'https://chatgpt.com'],
    [/\.?oaistatic\.com$/i, 'https://chatgpt.com'],
    [/\.?oaiusercontent\.com$/i, 'https://chatgpt.com'],
    [/\.?oaistatic\.net$/i, 'https://chatgpt.com'],
    [/\.?auth0\.openai\.com$/i, 'https://chatgpt.com'],
    // DeepSeek
    [/\.?deepseek\.com$/i, 'https://chat.deepseek.com'],
    [/\.?deepseek\.ai$/i, 'https://chat.deepseek.com'],
    // Claude / Anthropic
    [/\.?claude\.ai$/i, 'https://claude.ai'],
    [/\.?anthropic\.com$/i, 'https://claude.ai'],
    // Gemini
    [/\.?gemini\.google\.com$/i, 'https://gemini.google.com'],
    // Doubao (ByteDance AI)
    [/\.?doubao\.com$/i, 'https://www.doubao.com'],
    [/\.?volccdn\.com$/i, 'https://www.doubao.com'],
    [/\.?volces\.com$/i, 'https://www.doubao.com'],
    [/\.?volcengine\.com$/i, 'https://www.doubao.com'],
    [/\.?ibytedtos\.com$/i, 'https://www.doubao.com'],
    // Qianwen (Alibaba AI)
    [/\.?qianwen\.com$/i, 'https://qianwen.com'],
    [/\.?tongyi\.aliyun\.com$/i, 'https://qianwen.com'],
    [/\.?aliyuncs\.com$/i, 'https://qianwen.com'],
    [/\.?alicdn\.com$/i, 'https://qianwen.com'],
    [/\.?aliyun\.com$/i, 'https://qianwen.com'],
    // itch.io
    [/\.?itch\.io$/i, 'https://itch.io'],
    [/\.?itch\.zone$/i, 'https://itch.io'],
    [/\.?hwcdn\.net$/i, 'https://itch.io'],
    // Gimkit
    [/\.?gimkit\.com$/i, 'https://www.gimkit.com'],
];

// Match unshuffled (https://...) and shuffled proxy URLs.
// Accepts BOTH the current indicators (`_ps`, `_p1`) and the legacy ones
// (`_rhs`, `_rh1`) so old saved/shared URLs still route correctly.
// Optional /studyboard prefix for reverse-proxy deployments.
const PROXY_REQUEST_RE = /^(?:\/studyboard)?\/[a-z0-9]{32}(?:(?:![^\/]+)*)\/(?:https?:\/\/[^/]+|_p[s1]|_rh[s1])/i;
const UNSHUFFLED_ORIGIN_RE = /^(?:\/studyboard)?\/[a-z0-9]{32}(?:(?:![^\/]+)*)\/(https?:\/\/[^/]+)/i;

/**
 * Extract destination origin from proxy URL.
 * Handles unshuffled, shuffled, and comma-separated URL formats.
 */
function getDestinationOrigin(url, sessionStore) {
    if (!url) return null;
    const pathOnly = url.split('?')[0];
    const m = pathOnly.match(UNSHUFFLED_ORIGIN_RE);
    if (m) return m[1];

    const sessionId = getSessionId(pathOnly);
    if (!sessionId || !sessionStore) return null;
    const session = sessionStore.get(sessionId);
    if (!session?.shuffleDict) return null;

    const destPartMatch = pathOnly.match(new RegExp(`^(?:\\/studyboard)?\\/[a-z0-9]{32}(?:(?:![^\\/]+)*)\\/(.+)$`, 'i'));
    if (!destPartMatch) return null;
    let destPart = destPartMatch[1];
    if (!StrShuffler.isShuffled(destPart)) return null;

    try {
        const shuffler = new StrShuffler(session.shuffleDict);
        const unshuffled = shuffler.unshuffle(destPart);
        const firstUrl = unshuffled.split(',')[0].trim();
        const originMatch = firstUrl.match(/^(https?:\/\/[^/]+)/i);
        return originMatch ? originMatch[1] : null;
    } catch (_) {
        return null;
    }
}

/**
 * Get Referer origin from browser's Referer header (parent page).
 * Used for CDN subresources - CDN expects Referer from main site.
 */
function getRefererOriginFromHeader(referer, sessionStore) {
    const full = getRefererFullUrl(referer, sessionStore);
    if (!full) return null;
    try {
        return new URL(full).origin;
    } catch (_) {
        return null;
    }
}

/**
 * Get full destination URL from Referer (unshuffled). Use as Referer value so CDNs see a real page path.
 */
function getRefererFullUrl(referer, sessionStore) {
    if (!referer || typeof referer !== 'string') return null;
    const sessionId = getSessionId(referer);
    if (!sessionId || !sessionStore) return null;
    const session = sessionStore.get(sessionId);
    if (!session?.shuffleDict) return null;
    const pathMatch = referer.match(/(?:\/studyboard)?\/[a-z0-9]{32}(?:(?:![^\/\?]+)*)\/(.+?)(?:\?|$)/i);
    if (!pathMatch) return null;
    let destPart = pathMatch[1];
    if (StrShuffler.isShuffled(destPart)) {
        try {
            const shuffler = new StrShuffler(session.shuffleDict);
            destPart = shuffler.unshuffle(destPart);
        } catch (_) {
            return null;
        }
    }
    const firstUrl = destPart.split(',')[0].trim();
    return /^https?:\/\//i.test(firstUrl) ? firstUrl : null;
}

/**
 * Map CDN host to main site origin for Referer (Poki CDN blocks proxy Referer).
 */
function getRefererOriginForHost(destOrigin) {
    if (!destOrigin) return null;
    try {
        const host = new URL(destOrigin + '/').hostname.replace(/^www\./, '');
        for (const [re, mainOrigin] of CDN_REFERER_MAP) {
            if (re.test(host)) return mainOrigin;
        }
    } catch (_) {}
    return destOrigin;
}

/**
 * Fallback: infer referer origin from URL path or Referer header when normal detection fails.
 * Handles shuffled URLs where host may appear in plaintext (query, path), or Referer contains hints.
 */
function getRefererOriginFallback(url, referer) {
    const combined = ((url || '') + ' ' + (referer || '')).toLowerCase();
    if (/hdslb\.com|bilivideo|biliapi|bilibili\.com|bilibili\.cn|szbdyd\.com/.test(combined)) return 'https://www.bilibili.com';
    if (/poki-cdn|poki\.com/.test(combined)) return 'https://poki.com';
    if (/googlevideo|ytimg|ggpht|youtube\.com/.test(combined)) return 'https://www.youtube.com';
    if (/douyin|byteimg|bytecdn|iesdouyin/.test(combined)) return 'https://www.douyin.com';
    if (/tiktok|tiktokcdn|musical\.ly/.test(combined)) return 'https://www.tiktok.com';
    if (/discord|discordapp/.test(combined)) return 'https://discord.com';
    if (/twitch|twitchcdn/.test(combined)) return 'https://www.twitch.tv';
    if (/reddit|redditstatic|redditmedia/.test(combined)) return 'https://www.reddit.com';
    if (/twitter\.com|twimg\.com|x\.com/.test(combined)) return 'https://twitter.com';
    if (/instagram|cdninstagram/.test(combined)) return 'https://www.instagram.com';
    if (/facebook|fbcdn\.net|fb\.com/.test(combined)) return 'https://www.facebook.com';
    if (/netflix|nflxvideo|nflxso|nflxext/.test(combined)) return 'https://www.netflix.com';
    if (/spotify|scdn\.co|spotifycdn/.test(combined)) return 'https://open.spotify.com';
    if (/vimeo|vimeocdn/.test(combined)) return 'https://vimeo.com';
    if (/imgur\.com|i\.imgur/.test(combined)) return 'https://imgur.com';
    if (/github|githubassets|githubusercontent/.test(combined)) return 'https://github.com';
    if (/medium\.com|cdn-images.*medium/.test(combined)) return 'https://medium.com';
    if (/pinterest|pinimg/.test(combined)) return 'https://www.pinterest.com';
    if (/linkedin|licdn/.test(combined)) return 'https://www.linkedin.com';
    if (/whatsapp\.net|whatsapp\.com/.test(combined)) return 'https://web.whatsapp.com';
    if (/telegram|t\.me/.test(combined)) return 'https://web.telegram.org';
    if (/steam|steampowered|steamcommunity|steamstatic/.test(combined)) return 'https://store.steampowered.com';
    if (/soundcloud|sndcdn/.test(combined)) return 'https://soundcloud.com';
    if (/vk\.com|vk-cdn|vk\.me/.test(combined)) return 'https://vk.com';
    if (/nicovideo|nimg\.jp/.test(combined)) return 'https://www.nicovideo.jp';
    if (/naver|pstatic\.net|nhncorp/.test(combined)) return 'https://www.naver.com';
    if (/pixiv\.net|i\.pixiv/.test(combined)) return 'https://www.pixiv.net';
    if (/wikipedia|wikimedia|upload\.wikimedia/.test(combined)) return 'https://www.wikipedia.org';
    if (/googleapis|gstatic|googleusercontent|google\.com/.test(combined)) return 'https://www.google.com';
    if (/cloudflare\.com/.test(combined)) return 'https://www.cloudflare.com';
    if (/amazon\.com|ssl-images-amazon|media-amazon|images-amazon/.test(combined)) return 'https://www.amazon.com';
    if (/canva\.com|canva\.cn/.test(combined)) return 'https://www.canva.com';
    if (/slack\.com|slack-edge|slack-imgs|slack-files/.test(combined)) return 'https://slack.com';
    if (/gitlab\.com|gitlab\.net/.test(combined)) return 'https://gitlab.com';
    if (/figma\.com|figmacdn/.test(combined)) return 'https://www.figma.com';
    if (/vercel\.com|vercel\.app|vercel-insights/.test(combined)) return 'https://vercel.com';
    if (/netlify\.com|netlify\.app/.test(combined)) return 'https://www.netlify.com';
    if (/chatgpt\.com|openai\.com|oaistatic|oaiusercontent/.test(combined)) return 'https://chatgpt.com';
    if (/deepseek\.com|deepseek\.ai/.test(combined)) return 'https://chat.deepseek.com';
    if (/claude\.ai|anthropic\.com/.test(combined)) return 'https://claude.ai';
    if (/gemini\.google\.com/.test(combined)) return 'https://gemini.google.com';
    if (/doubao\.com|volccdn|volces\.com|volcengine/.test(combined)) return 'https://www.doubao.com';
    if (/qianwen\.com|tongyi\.aliyun/.test(combined)) return 'https://qianwen.com';
    if (/itch\.io|itch\.zone|hwcdn\.net/.test(combined)) return 'https://itch.io';
    if (/gimkit\.com/.test(combined)) return 'https://www.gimkit.com';
    return null;
}

function isProxiedRequest(req) {
    if (!req?.url) return false;
    return PROXY_REQUEST_RE.test(req.url.split('?')[0]);
}

// Challenge / captcha endpoints validate Referer/Origin against the site-key binding
// (or, in WAF cases, against the issuing origin) and are extremely sensitive to header
// mutation. We preserve whatever the client sent and only enforce Chrome-like ordering
// at the end.
//
// Coverage rationale:
//   - hCaptcha, reCAPTCHA  — classic site-key validation (Referer must match origin
//     where the sitekey was issued).
//   - Cloudflare Turnstile / cdn-cgi challenge platform — Cloudflare's bot-management
//     and Turnstile widget (`challenges.cloudflare.com`, `cdn-cgi/challenge-platform`).
//   - AWS WAF — token exchange (`*.token.awswaf.com`, `captcha.awswaf.com`,
//     `tls.awswaf.com`) and the integration scripts (`*.awswaf.com`).
//   - DataDome — captcha-delivery.com (geo., js., c., img.) + `dd.fcdn.com`.
//   - PerimeterX (now HUMAN) — `*.perimeterx.net`, `*.px-cdn.net`, `*.humansecurity.com`.
//   - Kasada — `*.kpsdk.com` (script + token).
//   - Douyin / TikTok captcha — `verify.douyin.com`, `verify-sg.byteoversea.com`,
//     `verification-va.byteoversea.com`, `vcs.snssdk.com`, `lf-cdn-tos.bytescm.com`
//     (the captcha image CDN).
//
// We DON'T proxy-cleanse Referer/Origin for any of these so the third-party iframe
// receives the original page-origin and validates correctly.
const CAPTCHA_HOST_RE = new RegExp(
    '(^|\\.)(' +
        // hCaptcha
        'hcaptcha\\.com|newassets\\.hcaptcha\\.com|js\\.hcaptcha\\.com|imgs\\.hcaptcha\\.com|' +
        // reCAPTCHA (subdomains; the URL-path check below covers /recaptcha/* on
        // google.com / gstatic.com).
        'recaptcha\\.net|' +
        // Cloudflare Turnstile + bot-management
        'challenges\\.cloudflare\\.com|cloudflareinsights\\.com|' +
        // AWS WAF
        'awswaf\\.com|' +
        // DataDome
        'captcha-delivery\\.com|datadome\\.co|dd\\.fcdn\\.com|' +
        // PerimeterX / HUMAN
        'perimeterx\\.net|px-cdn\\.net|px-cloud\\.net|humansecurity\\.com|' +
        // Kasada
        'kpsdk\\.com|kpsdk\\.io|' +
        // Douyin / TikTok captcha + verification
        'verify\\.douyin\\.com|static-verify\\.douyin\\.com|' +
        'verify-sg\\.byteoversea\\.com|verification-va\\.byteoversea\\.com|' +
        'vcs\\.snssdk\\.com|lf-cdn-tos\\.bytescm\\.com' +
    ')$',
    'i'
);
// URL-path heuristics. Used both for endpoints we can't enumerate by host alone
// (e.g. Cloudflare's `/cdn-cgi/challenge-platform/...` lives on the *protected*
// origin, not on `challenges.cloudflare.com`) and for captcha widgets that use
// path-based segregation (reCAPTCHA on google.com).
const CAPTCHA_PATH_RE = /\/recaptcha\/|\/cdn-cgi\/challenge-platform\/|\/cdn-cgi\/turnstile\/|\/turnstile\/v0\/|\/aws-waf-token|\/captcha\/(?:get|verify)|\/verify\/get_verify\/|\/captcha-delivery\//i;
function _isCaptchaDest(destOrigin, url) {
    try {
        if (destOrigin) {
            const host = new URL(destOrigin + '/').hostname;
            if (CAPTCHA_HOST_RE.test(host)) return true;
        }
    } catch (_) {
        // URL parse may fail on malformed origins — treat as "not captcha".
    }
    if (typeof url === 'string' && CAPTCHA_PATH_RE.test(url)) return true;
    return false;
}

/**
 * @param {http.IncomingMessage} req
 * @param {boolean} isRoute - from pipeline; session proxy requests are false
 * @param {import('../classes/StudyBoardSessionAbstractStore')} [sessionStore] - for unshuffling when URL is shuffled
 */
function injectBrowserLikeHeaders(req, isRoute, sessionStore) {
    if (!req?.headers) return;
    if (!isRoute && !isProxiedRequest(req)) return;

    // CRITICAL: WebSocket upgrade requests must NEVER have their headers rewritten by this
    // function. We force-set `connection: keep-alive` in DOCUMENT_HEADERS, which would
    // overwrite the client's `Connection: Upgrade`, causing the destination server to see
    // a plain HTTP/1.1 GET instead of a WS handshake → silent connection close → every
    // websocket-using site (Twitch chat, Discord gateway, jchat, Douyin, etc.) breaks
    // with "WebSocket connection failed" and no other diagnostic. Detect by either the
    // standard upgrade headers or the hammerhead `!w` URL flag (covers cases where the
    // browser's `Upgrade: websocket` was preserved by Hammerhead's outbound rewriter).
    const upgradeHdr = (req.headers['upgrade'] || '').toLowerCase();
    const connectionHdr = (req.headers['connection'] || '').toLowerCase();
    const isWsUpgrade =
        upgradeHdr === 'websocket' ||
        connectionHdr.split(',').some(p => p.trim() === 'upgrade') ||
        /\/[a-f0-9]{32}!w(?:[!/?]|$)/i.test(req.url || '');
    if (isWsUpgrade) return;

    // Don't overwrite Referer/Origin for hammerhead task scripts — pipeline and hammerhead need the real referer (proxy URL with session id) to warm session and unshuffle
    let pathname = (req.url || '').split('?')[0];
    try {
        pathname = decodeURIComponent(pathname);
    } catch (_) {}
    if (TASK_SCRIPT_PATHS.has(pathname)) return;

    const dest = req.headers['sec-fetch-dest'];
    const mode = req.headers['sec-fetch-mode'];
    const isDoc = !dest || dest === 'document' || mode === 'navigate';

    const destOrigin = getDestinationOrigin(req.url, sessionStore);

    // Compute referer origin early so we can use it for same-site and Accept-Language
    let refererOrigin = null;
    if (isDoc) {
        refererOrigin = destOrigin || getRefererOriginFallback(req.url, req.headers['referer']);
    } else {
        refererOrigin = getRefererOriginFromHeader(req.headers['referer'], sessionStore)
            || getRefererOriginForHost(destOrigin)
            || destOrigin
            || getRefererOriginFallback(req.url, req.headers['referer']);
    }

    const headersToInject = isDoc ? { ...DOCUMENT_HEADERS } : { ...SUBRESOURCE_HEADERS };

    // Destination-aware Accept-Language: Chinese / Japanese / Korean sites
    const originForLang = destOrigin || refererOrigin;
    try {
        if (originForLang) {
            const host = new URL(originForLang + '/').hostname;
            if (ZH_FIRST_HOST_RE.test(host)) {
                headersToInject['accept-language'] = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';
            } else if (JA_FIRST_HOST_RE.test(host)) {
                headersToInject['accept-language'] = 'ja,en-US;q=0.9,en;q=0.8';
            } else if (KO_FIRST_HOST_RE.test(host)) {
                headersToInject['accept-language'] = 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7';
            }
        }
    } catch (_) {}

    // Sites that expect same-origin sec-fetch-site for document requests
    const SAME_ORIGIN_DOC_RE = /\.?bilibili\.(com|cn)$|\.?twitter\.com$|\.?x\.com$|\.?instagram\.com$|\.?facebook\.com$|\.?tiktok\.com$|\.?reddit\.com$|\.?netflix\.com$|\.?discord\.com$|\.?amazon\.(com|co\.\w+)$|\.?linkedin\.com$|\.?canva\.com$|\.?slack\.com$|\.?gitlab\.com$|\.?figma\.com$|\.?youtube\.com$|\.?docs\.google\.com$|\.?vercel\.com$|\.?netlify\.com$|\.?chatgpt\.com$|\.?openai\.com$|\.?deepseek\.com$|\.?claude\.ai$|\.?anthropic\.com$|\.?gemini\.google\.com$|\.?doubao\.com$|\.?qianwen\.com$|\.?poki\.com$|\.?gimkit\.com$/i;
    const docOrigin = destOrigin || getRefererOriginFallback(req.url, req.headers['referer']);
    if (isDoc && docOrigin) {
        try {
            const host = new URL(docOrigin + '/').hostname.replace(/^www\./, '');
            if (SAME_ORIGIN_DOC_RE.test(host)) {
                headersToInject['sec-fetch-site'] = 'same-origin';
            }
        } catch (_) {}
    }

    // For subresources: same-origin when dest matches referer exactly, same-site for CDN subdomains
    if (!isDoc && refererOrigin && destOrigin) {
        if (destOrigin === refererOrigin) {
            headersToInject['sec-fetch-site'] = 'same-origin';
        } else if (getRefererOriginForHost(destOrigin) === refererOrigin) {
            headersToInject['sec-fetch-site'] = 'same-site';
        } else {
            try {
                const destHost = new URL(destOrigin + '/').hostname.replace(/^www\./, '');
                const refHost = new URL(refererOrigin + '/').hostname.replace(/^www\./, '');
                
                // If they share the same root domain (e.g. chatgpt.com and oaiusercontent.com might not, but api.chatgpt.com and chatgpt.com do)
                // This is a simplified check.
                const destParts = destHost.split('.');
                const refParts = refHost.split('.');
                
                if (destParts.length >= 2 && refParts.length >= 2) {
                    const destRoot = destParts.slice(-2).join('.');
                    const refRoot = refParts.slice(-2).join('.');
                    if (destRoot === refRoot) {
                        headersToInject['sec-fetch-site'] = 'same-site';
                    }
                }
            } catch (_) {}
        }
    }

    const origAccept = req.headers['accept'];
    const origContentType = req.headers['content-type'];
    // Snapshot the client-set User-Agent and Client-Hints BEFORE we
    // overwrite them — see the AWS WAF / Cloudflare comment further down.
    const origUserAgent = req.headers['user-agent'];
    const origSecChUa = req.headers['sec-ch-ua'];
    const origSecChUaMobile = req.headers['sec-ch-ua-mobile'];
    const origSecChUaPlatform = req.headers['sec-ch-ua-platform'];
    const origSecChUaFull = req.headers['sec-ch-ua-full-version-list'];
    const origSecChUaArch = req.headers['sec-ch-ua-arch'];
    const origSecChUaBitness = req.headers['sec-ch-ua-bitness'];
    const origSecChUaModel = req.headers['sec-ch-ua-model'];
    const origSecChUaPlatformVersion = req.headers['sec-ch-ua-platform-version'];
    const origSecFetchMode = req.headers['sec-fetch-mode'];
    const origSecFetchDest = req.headers['sec-fetch-dest'];
    const origSecFetchSite = req.headers['sec-fetch-site'];
    
    for (const [name, value] of Object.entries(headersToInject)) {
        const lower = name.toLowerCase();
        req.headers[lower] = value;
    }
    // Preserve client-set Accept/Content-Type (e.g. text/event-stream for SSE, multipart for uploads)
    if (origAccept && origAccept !== '*/*' && origAccept !== 'text/html, */*; q=0.01') {
        req.headers['accept'] = origAccept;
    }
    if (origContentType) {
        req.headers['content-type'] = origContentType;
    }
    if (origSecFetchMode) req.headers['sec-fetch-mode'] = origSecFetchMode;
    if (origSecFetchDest) req.headers['sec-fetch-dest'] = origSecFetchDest;
    // We do NOT preserve origSecFetchSite because the client sends it relative to the proxy domain.
    // The proxy must compute the correct sec-fetch-site based on the upstream origins.
    // CRITICAL: preserve the BROWSER's User-Agent + Client-Hints triplet so
    // anti-bot WAFs (AWS WAF, Cloudflare, hCaptcha, Datadome, …) can verify
    // the tokens they issued. Their challenge.js computes a proof in-browser
    // that includes navigator.userAgent + navigator.userAgentData (sec-ch-ua,
    // sec-ch-ua-platform, etc.) and BINDS the issued token to that exact
    // fingerprint. If the proxy then forwards the verification request with
    // a DIFFERENT UA / sec-ch-ua tuple (e.g. our hardcoded "Windows Chrome
    // 131" while the user is on "macOS Chrome 130"), AWS WAF returns
    // Set-Cookie: aws-waf-token=; expires=1970 (deletion) and the page
    // re-challenges → infinite "Max challenge attempts exceeded" loop on
    // chat.deepseek.com / amazon.com / aws.amazon.com / etc.
    //
    // We only fall back to the spoofed CHROME_UA when:
    //   - no UA was sent (server-to-server health checks)
    //   - the UA is from a known automation tool (HeadlessChrome,
    //     PhantomJS, webdriver) where servers would 403 us anyway.
    if (origUserAgent && /Mozilla\//.test(origUserAgent) && !/HeadlessChrome|PhantomJS|webdriver/i.test(origUserAgent)) {
        req.headers['user-agent'] = origUserAgent;
        // Restore each Client-Hints header that the BROWSER sent. Missing
        // hints stay missing — sending a fake one would break the proof
        // just as badly as overriding the real one.
        if (origSecChUa) req.headers['sec-ch-ua'] = origSecChUa; else delete req.headers['sec-ch-ua'];
        if (origSecChUaMobile) req.headers['sec-ch-ua-mobile'] = origSecChUaMobile; else delete req.headers['sec-ch-ua-mobile'];
        if (origSecChUaPlatform) req.headers['sec-ch-ua-platform'] = origSecChUaPlatform; else delete req.headers['sec-ch-ua-platform'];
        if (origSecChUaFull) req.headers['sec-ch-ua-full-version-list'] = origSecChUaFull; else delete req.headers['sec-ch-ua-full-version-list'];
        if (origSecChUaArch) req.headers['sec-ch-ua-arch'] = origSecChUaArch; else delete req.headers['sec-ch-ua-arch'];
        if (origSecChUaBitness) req.headers['sec-ch-ua-bitness'] = origSecChUaBitness; else delete req.headers['sec-ch-ua-bitness'];
        if (origSecChUaModel) req.headers['sec-ch-ua-model'] = origSecChUaModel; else delete req.headers['sec-ch-ua-model'];
        if (origSecChUaPlatformVersion) req.headers['sec-ch-ua-platform-version'] = origSecChUaPlatformVersion; else delete req.headers['sec-ch-ua-platform-version'];
    }

    // Anti-proxy bypass: spoof Referer/Origin so Poki CDN and similar accept requests.
    // Skip for captcha endpoints — hCaptcha/reCAPTCHA validate Referer against the sitekey
    // binding and will reject the widget if we rewrite an already-correct Referer.
    const isCaptchaDest = _isCaptchaDest(destOrigin, req.url);
    if (refererOrigin && !isCaptchaDest) {
        // Prefer full Referer URL (with path) when available — some CDNs validate page path
        const fullRefererUrl = !isDoc ? getRefererFullUrl(req.headers['referer'], sessionStore) : null;
        const ref = (fullRefererUrl && fullRefererUrl.startsWith(refererOrigin))
            ? (fullRefererUrl.endsWith('/') ? fullRefererUrl : fullRefererUrl + '/')
            : (refererOrigin.endsWith('/') ? refererOrigin : refererOrigin + '/');
        req.headers['referer'] = ref;
        if (!isDoc && req.headers['origin']) {
            req.headers['origin'] = refererOrigin;
        }
    }

    // Request-type-aware Accept + sec-fetch-dest (by URL path) — many CDNs/servers validate these
    if (!isDoc && req.url) {
        const pathAndQuery = (req.url.split('?')[0] || '').toLowerCase();
        const accept = (req.headers['accept'] || '').toLowerCase();
        const looksLikeApi = /\/api\/|\/x\/|\.biliapi\.|api\.bilibili|graphql|\.json/.test(pathAndQuery) || accept.includes('application/json');
        const looksLikeImage = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico|bmp)(\?|$)/.test(pathAndQuery) || /\/img\/|\/image\/|\/images\/|\.ytimg\.|i\.imgur|pbs\.twimg|cdninstagram/.test(pathAndQuery);
        const looksLikeScript = /\.js(\?|$)/.test(pathAndQuery) || /\/script\/|\.min\.js/.test(pathAndQuery);
        const looksLikeStyle = /\.css(\?|$)/.test(pathAndQuery) || /\/style\/|\.min\.css/.test(pathAndQuery);
        const looksLikeFont = /\.(woff2?|ttf|otf|eot)(\?|$)/.test(pathAndQuery);

        if (looksLikeApi) {
            const curAccept = (req.headers['accept'] || '').toLowerCase();
            const isSSE = curAccept.includes('text/event-stream');
            if (!origSecFetchDest) req.headers['sec-fetch-dest'] = 'empty';
            if (!isSSE && curAccept.includes('*/*') && !curAccept.includes('application/json')) {
                req.headers['accept'] = 'application/json, text/plain, */*';
            }
        } else if (looksLikeImage) {
            if (!origSecFetchDest) req.headers['sec-fetch-dest'] = 'image';
            req.headers['accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
        } else if (looksLikeScript) {
            if (!origSecFetchDest) req.headers['sec-fetch-dest'] = 'script';
            req.headers['accept'] = '*/*';
        } else if (looksLikeStyle) {
            if (!origSecFetchDest) req.headers['sec-fetch-dest'] = 'style';
            req.headers['accept'] = 'text/css,*/*;q=0.1';
        } else if (looksLikeFont) {
            if (!origSecFetchDest) req.headers['sec-fetch-dest'] = 'font';
            req.headers['accept'] = 'font/woff2,font/woff,*/*;q=0.9';
        }
    }

    // ChatGPT specific overrides
    if (!isDoc && destOrigin && destOrigin.includes('chatgpt.com')) {
        req.headers['sec-fetch-site'] = 'same-origin';
        if (req.headers['origin']) {
            req.headers['origin'] = destOrigin;
        }
    }

    _reorderHeaders(req.headers, isDoc ? CHROME_DOC_ORDER : CHROME_SUB_ORDER);
    
    if (req.url && (req.url.includes('chatgpt.com') || req.url.includes('openai.com'))) {
        console.log('[UPSTREAM_REQ]', req.url);
        console.log(req.headers);
    }
}

module.exports = {
    injectBrowserLikeHeaders,
    getDestinationOrigin,
    CAPTCHA_HOST_RE,
    CAPTCHA_PATH_RE,
};
