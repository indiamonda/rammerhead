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

function isHtmlResponse(response) {
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  return ct.includes("text/html");
}

function isJimmyqrgDest(destUrl) {
  try {
    const h = new URL(destUrl).hostname.toLowerCase();
    return h === "jimmyqrg.github.io" || h === "jimmyq-r-g.github.io";
  } catch (_) {
    return false;
  }
}

/** Injected before bot-shield.js so proxy checks see the real GitHub Pages origin. */
function makeJimmyBypassTag(destUrl) {
  const json = JSON.stringify(destUrl || "");
  return `<script>window.__rhJimmyPage=${json};<\\/script><script src="/jimmyqrg-shield-bypass.js"><\\/script>`;
}

async function injectJimmyBypassIntoHtml(response, destUrl) {
  if (!isHtmlResponse(response)) return response;
  let text = await response.text();
  const tag = makeJimmyBypassTag(destUrl);
  const headMatch = text.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = text.indexOf(headMatch[0]) + headMatch[0].length;
    text = text.slice(0, idx) + tag + text.slice(idx);
  } else {
    text = tag + text;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-security-policy");
  headers.delete("x-frame-options");
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
        const response = await $scramjetController.route(event);
        try {
          const destUrl = decodeProxiedUrl(event.request.url);
          if (
            destUrl &&
            isJimmyqrgDest(destUrl) &&
            isHtmlResponse(response) &&
            event.request.mode === "navigate"
          ) {
            return injectJimmyBypassIntoHtml(response, destUrl);
          }
        } catch (_) {}
        return response;
      })()
    );
  }
});
