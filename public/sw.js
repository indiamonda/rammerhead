importScripts("/controller/controller.sw.js");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

let adBlockEnabled = true;
let adBlockRules = null;
let adBlockExactSet = null;
let adBlockPathRe = null;

async function loadAdBlockRules() {
  try {
    const resp = await fetch("/adblock-rules.json");
    if (!resp.ok) return;
    adBlockRules = await resp.json();
    if (adBlockRules.exactDomains)
      adBlockExactSet = new Set(adBlockRules.exactDomains);
    if (adBlockRules.pathReSource)
      adBlockPathRe = new RegExp(adBlockRules.pathReSource, "i");
  } catch (_) {}
}

const ALLOW_RE =
  /(^|\.)(studyboard|jimmyqrg\.github\.io|jimmyq-r-g\.github\.io|turbowarp|turbowarp\.org|turbowarp\.xyz|scratch|scratch\.mit\.edu|scratchfoundation|scratchr2|mit\.edu|poki|chatgpt|openai|oaistatic|oaiusercontent|claude|anthropic|github|githubusercontent|duckduckgo|deepseek|awswaf\.com|jmail|mk48|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare|widgetapi|statsigapi|featuregates|sentry|auth0|twimg|tiktok|tiktokcdn|byteoversea|byteimg|musical|ibyteimg|bilibili|bilivideo|hdslb|biliimg|acfun|poki-gdn|youtube|ytimg|googlevideo|ggpht|google|googleapis|wikipedia|wikimedia|wikidata|mediawiki|reddit|redd\.it|redditstatic|redditmedia|stackoverflow|sstatic|stackexchange|askubuntu|medium|mcdn|quora|quoracdn|imgur|pinterest|pinimg|deviantart|wixmp|soundcloud|sndcdn|spotify|scdn|spotifycdn|codepen|cdpn|codepen\.dev|jsfiddle|jshell|replit|repl\.co|repl\.it|glitch|notion|notion-static|trello|trellocdn|figma|figmaassets|jupyter|mybinder|binder)(\.|$)/i;

function shouldBlockUrl(url) {
  if (!adBlockEnabled || !adBlockRules) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();

  if (ALLOW_RE.test(host)) return false;

  if (adBlockExactSet && adBlockExactSet.has(host)) return true;

  if (adBlockRules.suffixDomains) {
    for (const suffix of adBlockRules.suffixDomains) {
      if (host.endsWith(suffix)) return true;
    }
  }

  if (adBlockPathRe && adBlockPathRe.test(parsed.pathname)) return true;

  return false;
}

function decodeProxiedUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    const prefix = "/~/sj/";
    if (!url.pathname.startsWith(prefix)) return null;
    const rest = url.pathname.slice(prefix.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 1) return null;
    const encoded = rest.slice(slashIdx + 1);
    return decodeURIComponent(encoded);
  } catch (_) {
    return null;
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "adblock-toggle") {
    adBlockEnabled = !!event.data.enabled;
  }
});

loadAdBlockRules();

self.addEventListener("fetch", (event) => {
  if ($scramjetController.shouldRoute(event)) {
    event.respondWith(
      (async () => {
        if (adBlockEnabled && adBlockRules) {
          try {
            const destUrl = decodeProxiedUrl(event.request.url);
            if (destUrl && shouldBlockUrl(destUrl)) {
              return new Response("", { status: 204 });
            }
          } catch (_) {}
        }
        return $scramjetController.route(event);
      })()
    );
  }
});
