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
let adBlockSuffixSet = null;
let adBlockPathRe = null;
let adBlockSuffixes = null;
let insertScript = null;
let adBlockReady = false;

async function loadAdBlockRules() {
  try {
    const resp = await fetch("/adblock-rules.json");
    if (!resp.ok) {
      console.warn("AdBlock: failed to load rules, status:", resp.status);
      return;
    }
    adBlockRules = await resp.json();
    if (adBlockRules.exactDomains)
      adBlockExactSet = new Set(adBlockRules.exactDomains);
    if (adBlockRules.suffixDomains)
      adBlockSuffixes = adBlockRules.suffixDomains;
    if (adBlockRules.pathReSource)
      adBlockPathRe = new RegExp(adBlockRules.pathReSource, "i");
    adBlockReady = true;
    console.log("AdBlock: rules loaded", {
      exact: adBlockExactSet?.size || 0,
      suffix: adBlockSuffixes?.length || 0,
      path: adBlockPathRe ? "loaded" : "none"
    });
  } catch (e) {
    console.error("AdBlock: failed to load rules:", e);
  }
}

/** Same host allowlist semantics as src/util/adBlocker.js (first-party delicate sites). */
const ALLOWLIST_HOST_RE =
  /(^|\.)(studyboard|jimmyqrg\.github\.io|jimmyq-r-g\.github\.io|indiamonda\.github\.io|turbowarp|scratch|mit\.edu|bloxd|chatgpt|openai|oaistatic|oaiusercontent|claude|anthropic|github|githubusercontent|duckduckgo|deepseek|awswaf\.com|jmail|mk48|widgetapi|statsigapi|featuregates|sentry|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare|auth0|twimg|tiktok|tiktokcdn|byteoversea|byteimg|musical|ibyteimg|bilibili|bilivideo|hdslb|biliimg|youtube|ytimg|googlevideo|ggpht|google|googleapis|wikipedia|wikimedia|wikidata|mediawiki|reddit|redd\.it|redditstatic|redditmedia|stackoverflow|sstatic|stackexchange|askubuntu|medium|mcdn|quora|quoracdn|imgur|pinterest|pinimg|deviantart|wixmp|soundcloud|sndcdn|spotify|scdn|spotifycdn|codepen|cdpn|codepen\.dev|jsfiddle|jshell|replit|repl\.co|repl\.it|glitch|notion|notion-static|trello|trellocdn|figma|figmaassets|jupyter|mybinder|binder|unpkg|jsdelivr|azureedge|digitalocean)(\.|$)/i;

const YOUTUBE_AD_PATH_RE =
  /youtube(?:-nocookie)?\.com\/(api\/stats\/ads|pagead|get_midroll_info|api\/stats\/atr|ptracking|generate_204_simple|api\/stats\/qoe)/i;

function isAllowlistedHost(host) {
  if (!host) return false;
  return ALLOWLIST_HOST_RE.test(host);
}

/** Never block anti-bot / auth-critical paths (false positives on ad regex or CDNs). */
function isAdBlockExempt(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname;
    const hp = h + p;
    // Poki ads - block their ad domains that commonly fail
    if (h.includes("poki.com") || h.includes("poki.io")) {
      // Don't exempt common ad paths on poki
      if (p.includes("/ads/") || p.includes("/ad/") || p.includes("/banner") ||
          p.includes("/video-ad") || p.includes("/interstitial") || p.includes("/rewarded")) {
        return false;
      }
    }
    if (/^challenges\.cloudflare\.com$/i.test(h)) return true;
    if (p.includes("/cdn-cgi/challenge-platform/")) return true;
    if (p.includes("/cdn-cgi/speculation")) return true;
    if (/(^|\.)turnstile\.cloudflare\.com$/i.test(h)) return true;
    if (/(^|\.)chatgpt\.com$/i.test(h) && p.startsWith("/backend-anon/")) return true;
    if (/(^|\.)openai\.com$/i.test(h) && (p.includes("/api/auth") || p.includes("/cdn-cgi/")))
      return true;
    // Discord CDN and auth paths
    if (/(^|\.)(discord|discordapp)\.com$/i.test(h) && /^\/(assets|cdn\/static|login)\//.test(p))
      return true;
    // ChatGPT/CDN paths that get false-positive blocked
    if (/(^|\.)(chatgpt\.com|openai\.com|oaistatic\.com|oaiusercontent\.com)$/i.test(h))
      return true;
    // Cloudflare parallelize for ChatGPT
    if (/^[^/]+\.cloudflare\.com$/i.test(h) && p.includes("/cdn-cgi/")) return true;
    // Gemini Google - don't block any requests to Gemini
    if (/(^|\.)gemini\.google\.com$/i.test(h)) return true;
    // Allowlist all Google domains to prevent breakage
    if (/(^|\.)(google\.com|googleapis\.com|gstatic\.com|googlevideo\.com|ytimg\.com|googlesyndication\.com|doubleclick\.net)$/i.test(h)) return true;
  } catch (_) {}
  return false;
}

/**
 * Match server-side shouldBlockUrl: allowlisted hosts only get YouTube ad-path blocks;
 * everyone else hits exact + suffix + path lists.
 */
function shouldBlockUrl(url) {
  if (!adBlockEnabled) return false;
  if (!adBlockRules) {
    // Rules not loaded yet - try to load them and don't block
    loadAdBlockRules();
    return false;
  }
  if (isAdBlockExempt(url)) return false;

  // Special handling for pokki ads - block ad paths even on allowlisted hosts
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname;
    if ((h.includes("poki.com") || h.includes("poki.io")) &&
        (p.includes("/ads/") || p.includes("/ad/") || p.includes("/banner") ||
         p.includes("/video-ad") || p.includes("/interstitial") || p.includes("/rewarded") ||
         p.includes("/preroll") || p.includes("/postroll"))) {
      return true;
    }
  } catch (_) {}

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if (isAllowlistedHost(host)) {
    if (YOUTUBE_AD_PATH_RE.test(host + path)) return true;
    if (/(^|\.)youtube(?:-nocookie)?\.com$/i.test(host) && adBlockPathRe && adBlockPathRe.test(path))
      return true;
    return false;
  }

  if (adBlockExactSet && adBlockExactSet.has(host)) return true;

  if (adBlockSuffixes) {
    for (const suffix of adBlockSuffixes) {
      if (!suffix || typeof suffix !== "string" || suffix.length > 80) continue;
      if (!suffix.startsWith(".")) continue;
      if (host.endsWith(suffix)) return true;
    }
  }

  if (adBlockPathRe && adBlockPathRe.test(path)) return true;

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

const PIXEL_GIF = (() => {
  const bin = atob("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==");
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
})();

function blockedStubResponse(request, destUrl) {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  let path = "";
  try {
    path = new URL(destUrl).pathname.toLowerCase();
  } catch (_) {}

  const h = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "public, max-age=86400, immutable",
  };

  if (
    dest === "image" ||
    /\.(gif|png|jpe?g|webp|svg|ico)(\?|$)/.test(path) ||
    accept.includes("image/")
  ) {
    h["Content-Type"] = "image/gif";
    return new Response(PIXEL_GIF, { status: 200, headers: h });
  }
  if (dest === "style" || /\.css(\?|$)/.test(path) || accept.includes("text/css")) {
    h["Content-Type"] = "text/css; charset=utf-8";
    h["Cache-Control"] = "public, max-age=3600";
    return new Response("/* ad-blocked */", { status: 200, headers: h });
  }
  if (dest === "script" || /\.(js|mjs)(\?|$)/.test(path) || accept.includes("javascript")) {
    h["Content-Type"] = "application/javascript; charset=utf-8";
    h["Cache-Control"] = "no-store";
    return new Response("/* ad-blocked */void 0;", { status: 200, headers: h });
  }
  if (dest === "iframe" || dest === "frame" || accept.includes("text/html")) {
    h["Content-Type"] = "text/html; charset=utf-8";
    return new Response("<!doctype html><title></title>", { status: 200, headers: h });
  }
  if (accept.includes("application/json")) {
    h["Content-Type"] = "application/json; charset=utf-8";
    return new Response("{}", { status: 200, headers: h });
  }
  return new Response(null, { status: 204 });
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "adblock-toggle") {
    adBlockEnabled = !!event.data.enabled;
  }
  if (event.data && event.data.type === "update-insert-script") {
    insertScript = event.data.script || null;
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
    return h === "indiamonda.github.io" || h === "jimmyq-r-g.github.io";
  } catch (_) {
    return false;
  }
}

function makeJimmyBypassTag(destUrl) {
  const json = JSON.stringify(destUrl || "");
  return `<script>window.__rhJimmyPage=${json};<\\/script><script src="/jimmyqrg-shield-bypass.js"><\\/script>`;
}

/** Collapse common ad-slot DOM so empty iframes do not reserve layout space. */
const COSMETIC_STYLE = `<style id="__rh-cosmetic-ad" data-rh="1">
iframe[src*="doubleclick.net"],
iframe[src*="googlesyndication"],
iframe[src*="googleads"],
iframe[name^="google_ads"],
iframe[id^="google_ads"],
iframe[class*="google-dfp"],
iframe[class*="ad-container"],
iframe[id*="google_ads"],
iframe[title*="advertisement"],
ins.adsbygoogle,
.adsbygoogle,
[data-ad-module],
[data-ad-unit-path],
[data-ad-client],
[data-ad-slot],
[data-google-ad-resource],
[data-google-ad-format],
[id^="div-gpt-ad"],
[id^="ad-gpt-"],
[id^="google_ads"],
[id^="ad_position"],
[id^="ad-slot"],
[id^="ad-container"],
[id^="adwrapper"],
[id^="ad-wrapper"],
[class*="dfp-ad"],
[class*="adsbygoogle"],
[class*="google-dfp"],
[class*="ad-container"],
[class*="advertisement"],
[class*="ads-container"],
[class*="ad-slot"],
[class*="sponsored"],
[aria-label*="advertisement"],
[aria-label*="Advertisement"],
[aria-label*="Ads"],
[aria-label*="ads"],
aside[class*="ad-"],
div[class*="ad-container"],
div[class*="ads-container"],
div[class*="advertisement"],
div[id*="banner"],
div[class*="banner"],
div[class*="promoted"],
div[class*="sponsor"],
a[href*="clicktrack"],
a[href*="click.ado"],
a[href*="popunder"],
a[href*="ad.php"],
a[href*="banner="],
a[href*="ad/"],
a[href*="ads/"],
a[href*="click壮"],
a[href*="redirect"],
a[href*="click_redirect"],
img[width="728"][height="90"],
img[width="300"][height="250"],
img[width="320"][height="50"],
img[width="160"][height="600"],
img[height="90"][width="728"],
img[height="250"][width="300"],
img[height="50"][width="320"],
img[height="600"][width="160"],
[class*="ad-unit"],
[class*="ad-wrapper"],
[class*="slot-"],
[id*="slot-"],
[id*="adunit"],
[id*="adUnit"],
div[id^="qadv"],
div[class*="quadrant"]
{ display:none!important; visibility:hidden!important; height:0!important; min-height:0!important; max-height:0!important; width:0!important; min-width:0!important; margin:0!important; padding:0!important; border:0!important; overflow:hidden!important; pointer-events:none!important; opacity:0!important; }
</style>

const URL_BAR_HTML = `<div id="__rh-url-bar" data-rh-url-bar="1" style="position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:#1e1e2e!important;color:#cdd6f4!important;font-family:system-ui,-apple-system,sans-serif!important;font-size:13px!important;padding:6px 12px!important;display:flex!important;align-items:center!important;gap:8px!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important;overflow:hidden!important;max-height:40px!important;box-sizing:border-box!important;pointer-events:none!important;">
<span style="font-weight:600!important;color:#89b4fa!important;white-space:nowrap!important;margin-right:4px!important;">Current URL:</span>
<span id="__rh-url-bar-text" style="overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#cdd6f4!important;"></span>
</div>
<script data-rh-url-bar="1">
(function(){
var d=document.getElementById('__rh-url-bar');
var t=document.getElementById('__rh-url-bar-text');
if(d&&t){t.textContent=document.title||window.__rhJimmyPage||location.href;}
})();
<\/script>`;

const URL_BAR_STYLE = `<style id="__rh-url-bar-css" data-rh-url-bar="1">
html body,html head,#__rh-url-bar,[data-rh-url-bar="1"]{display:block!important;visibility:visible!important;height:auto!important;min-height:auto!important;max-height:none!important;width:auto!important;min-width:0!important;margin:0!important;padding:6px 12px!important;border:none!important;overflow:visible!important;pointer-events:none!important;opacity:1!important;z-index:2147483647!important;position:fixed!important;top:0!important;left:0!important;right:0!important;}
</style>`;

function injectAfterHeadOpen(html, inject) {
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = html.indexOf(headMatch[0]) + headMatch[0].length;
    return html.slice(0, idx) + inject + html.slice(idx);
  }
  return inject + html;
}

function injectBeforeHeadClose(html, inject) {
  const i = html.lastIndexOf("</head>");
  if (i !== -1) return html.slice(0, i) + inject + html.slice(i);
  // Also try before </head> with any variation (uppercase, etc)
  const i2 = html.lastIndexOf("</HEAD>");
  if (i2 !== -1) return html.slice(0, i2) + inject + html.slice(i2);
  return inject + html;
}

function injectBeforeBodyClose(html, inject) {
  const i = html.lastIndexOf("</body>");
  if (i !== -1) return html.slice(0, i) + inject + html.slice(i);
  // Also try before </body> with any variation (uppercase, etc)
  const i2 = html.lastIndexOf("</BODY>");
  if (i2 !== -1) return html.slice(0, i2) + inject + html.slice(i2);
  return html + inject;
}

function injectAfterBodyOpen(html, inject) {
  const m = html.match(/<body[^>]*>/i);
  if (m) {
    const idx = html.indexOf(m[0]) + m[0].length;
    return html.slice(0, idx) + inject + html.slice(idx);
  }
  return html;
}

async function processHtmlNavigation(response, destUrl) {
  if (!isHtmlResponse(response)) return response;
  let text = await response.text();
  if (isJimmyqrgDest(destUrl)) {
    text = injectAfterHeadOpen(text, makeJimmyBypassTag(destUrl));
  }
  if (!text.includes('id="__rh-cosmetic-ad"')) {
    text = injectBeforeHeadClose(text, COSMETIC_STYLE);
  }
  // Inject URL bar CSS in <head> and the bar itself right after <body> opens.
  // position:fixed + z-index:2147483647 ensures it stays on top and cannot be hidden by the proxied site.
  if (!text.includes('data-rh-url-bar="1"')) {
    text = injectAfterBodyOpen(text, URL_BAR_HTML);
    text = injectBeforeHeadClose(text, URL_BAR_STYLE);
  }
  if (insertScript) {
    const scriptInject = `<script id="__rh-insert-script" data-rh="1">${insertScript}<\/script>`;
    text = injectBeforeBodyClose(text, scriptInject);
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
        try {
          const destUrl = decodeProxiedUrl(event.request.url);
          if (adBlockEnabled && destUrl && shouldBlockUrl(destUrl)) {
            return blockedStubResponse(event.request, destUrl);
          }
        } catch (_) {}

        const response = await $scramjetController.route(event);
        try {
          const destUrl = decodeProxiedUrl(event.request.url);
          if (destUrl && isHtmlResponse(response) && event.request.mode === "navigate") {
            return processHtmlNavigation(response, destUrl);
          }
        } catch (_) {}
        return response;
      })()
    );
  }
});
