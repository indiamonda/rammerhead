/**
 * Browser-like headers to bypass 403 from sites that block non-browser requests.
 * Injected into proxied requests (sessionId + destination URL) before hammerhead.
 *
 * Anti-proxy bypass: spoof Referer/Origin to match destination; use parent page
 * Referer for CDN subresources; map CDN hosts to main site for Referer.
 */

const getSessionId = require('./getSessionId');
const StrShuffler = require('./StrShuffler');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DOCUMENT_HEADERS = {
    'user-agent': CHROME_UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
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
    'accept-encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'dnt': '0',
};

// CDN/subdomain -> main site origin for Referer (sites block proxy Referer)
const CDN_REFERER_MAP = [
    [/poki-cdn\.com$/i, 'https://poki.com'],
    [/\.?poki\.com$/i, 'https://poki.com'],
    [/\.?discord\.com$/i, 'https://discord.com'],
    [/\.?discordapp\.com$/i, 'https://discord.com'],
    [/\.?cloudflare\.com$/i, 'https://www.cloudflare.com'],
    // YouTube
    [/\.?googlevideo\.com$/i, 'https://www.youtube.com'],
    [/\.?youtube\.com$/i, 'https://www.youtube.com'],
    [/\.?ytimg\.com$/i, 'https://www.youtube.com'],
    [/\.?ggpht\.com$/i, 'https://www.youtube.com'],
    // Twitch
    [/\.?twitch\.tv$/i, 'https://www.twitch.tv'],
    [/\.?twitchcdn\.net$/i, 'https://www.twitch.tv'],
    // Douyin (抖音)
    [/\.?douyin\.com$/i, 'https://www.douyin.com'],
    [/\.?douyinpic\.com$/i, 'https://www.douyin.com'],
    [/\.?douyincdn\.com$/i, 'https://www.douyin.com'],
    [/\.?douyinstatic\.com$/i, 'https://www.douyin.com'],
    [/\.?iesdouyin\.com$/i, 'https://www.douyin.com'],
    [/\.?byteimg\.com$/i, 'https://www.douyin.com'],
    [/\.?bytecdn\.cn$/i, 'https://www.douyin.com'],
    [/\.?bytecdn\.com$/i, 'https://www.douyin.com'],
    [/\.?bytegoofy\.com$/i, 'https://www.douyin.com'],
    // Bilibili (哔哩哔哩)
    [/\.?bilibili\.com$/i, 'https://www.bilibili.com'],
    [/\.?bilibili\.cn$/i, 'https://www.bilibili.com'],
    [/\.?bilivideo\.com$/i, 'https://www.bilibili.com'],
    [/\.?bilivideo\.cn$/i, 'https://www.bilibili.com'],
    [/\.?hdslb\.com$/i, 'https://www.bilibili.com'],
    [/\.?biliapi\.net$/i, 'https://www.bilibili.com'],
    [/\.?biliapi\.com$/i, 'https://www.bilibili.com'],
    [/\.?szbdyd\.com$/i, 'https://www.bilibili.com'],
];

// Match both unshuffled (https://...) and shuffled (_rhs~...) proxy URLs
// Support optional base path (e.g. /rammerhead) for reverse-proxy deployments
const PROXY_REQUEST_RE = /^(?:\/rammerhead)?\/[a-z0-9]{32}\/(?:https?:\/\/[^/]+|_rhs~)/i;
const UNSHUFFLED_ORIGIN_RE = /^(?:\/rammerhead)?\/[a-z0-9]{32}\/(https?:\/\/[^/]+)/i;

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

    const destPartMatch = pathOnly.match(new RegExp(`^(?:\\/rammerhead)?\\/[a-z0-9]{32}\\/(.+)$`, 'i'));
    if (!destPartMatch) return null;
    let destPart = destPartMatch[1];
    if (!destPart.startsWith(StrShuffler.shuffledIndicator)) return null;

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
    if (!referer || typeof referer !== 'string') return null;
    const sessionId = getSessionId(referer);
    if (!sessionId || !sessionStore) return null;
    const session = sessionStore.get(sessionId);
    if (!session?.shuffleDict) return null;
    const pathMatch = referer.match(/(?:\/rammerhead)?\/[a-z0-9]{32}\/(.+?)(?:\?|$)/i);
    if (!pathMatch) return null;
    let destPart = pathMatch[1];
    if (destPart.startsWith(StrShuffler.shuffledIndicator)) {
        try {
            const shuffler = new StrShuffler(session.shuffleDict);
            destPart = shuffler.unshuffle(destPart);
        } catch (_) {
            return null;
        }
    }
    const originMatch = destPart.match(/^(https?:\/\/[^/]+)/i);
    return originMatch ? originMatch[1] : null;
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

function isProxiedRequest(req) {
    if (!req?.url) return false;
    return PROXY_REQUEST_RE.test(req.url.split('?')[0]);
}

/**
 * @param {http.IncomingMessage} req
 * @param {boolean} isRoute - from pipeline; session proxy requests are false
 * @param {import('../classes/RammerheadSessionAbstractStore')} [sessionStore] - for unshuffling when URL is shuffled
 */
function injectBrowserLikeHeaders(req, isRoute, sessionStore) {
    if (!req?.headers) return;
    if (!isRoute && !isProxiedRequest(req)) return;

    const dest = req.headers['sec-fetch-dest'];
    const mode = req.headers['sec-fetch-mode'];
    const isDoc = !dest || dest === 'document' || mode === 'navigate';

    const headersToInject = isDoc ? DOCUMENT_HEADERS : SUBRESOURCE_HEADERS;

    for (const [name, value] of Object.entries(headersToInject)) {
        const lower = name.toLowerCase();
        req.headers[lower] = value;
    }

    // Anti-proxy bypass: spoof Referer/Origin so Poki CDN and similar accept requests
    const destOrigin = getDestinationOrigin(req.url, sessionStore);
    let refererOrigin = null;
    if (isDoc) {
        refererOrigin = destOrigin;
    } else {
        // For subresources: prefer parent page from Referer; else map CDN to main site
        refererOrigin = getRefererOriginFromHeader(req.headers['referer'], sessionStore)
            || getRefererOriginForHost(destOrigin)
            || destOrigin;
    }
    if (refererOrigin) {
        const ref = refererOrigin.endsWith('/') ? refererOrigin : refererOrigin + '/';
        req.headers['referer'] = ref;
        if (!isDoc) req.headers['origin'] = refererOrigin;
    }
}

module.exports = { injectBrowserLikeHeaders, getDestinationOrigin };
