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

async function loadAdBlockRules() {
  try {
    const resp = await fetch("/adblock-rules.json");
    if (!resp.ok) return;
    adBlockRules = await resp.json();
    if (adBlockRules.exactDomains)
      adBlockExactSet = new Set(adBlockRules.exactDomains);
    if (adBlockRules.suffixDomains)
      adBlockSuffixes = adBlockRules.suffixDomains;
    if (adBlockRules.pathReSource)
      adBlockPathRe = new RegExp(adBlockRules.pathReSource, "i");
  } catch (_) {}
}

/** Same host allowlist semantics as src/util/adBlocker.js (first-party delicate sites). */
const ALLOWLIST_HOST_RE =
  /(^|\.)(studyboard|jimmyqrg\.github\.io|jimmyq-r-g\.github\.io|indiamonda\.github\.io|turbowarp|scratch|mit\.edu|poki|bloxd|chatgpt|openai|oaistatic|oaiusercontent|claude|anthropic|github|githubusercontent|duckduckgo|deepseek|awswaf\.com|jmail|mk48|widgetapi|statsigapi|featuregates|sentry|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare|auth0|twimg|tiktok|tiktokcdn|byteoversea|byteimg|musical|ibyteimg|bilibili|bilivideo|hdslb|biliimg|youtube|ytimg|googlevideo|ggpht|google|googleapis|wikipedia|wikimedia|wikidata|mediawiki|reddit|redd\.it|redditstatic|redditmedia|stackoverflow|sstatic|stackexchange|askubuntu|medium|mcdn|quora|quoracdn|imgur|pinterest|pinimg|deviantart|wixmp|soundcloud|sndcdn|spotify|scdn|spotifycdn|codepen|cdpn|codepen\.dev|jsfiddle|jshell|replit|repl\.co|repl\.it|glitch|notion|notion-static|trello|trellocdn|figma|figmaassets|jupyter|mybinder|binder|unpkg|jsdelivr|azureedge|digitalocean)(\.|$)/i;

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
  if (!adBlockEnabled || !adBlockRules) return false;
  if (isAdBlockExempt(url)) return false;
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
    return h === "jimmyqrg.github.io" || h === "jimmyq-r-g.github.io";
  } catch (_) {
    return false;
  }
}

function makeJimmyBypassTag(destUrl) {
  const json = JSON.stringify(destUrl || "");
  return `<script>window.__rhJimmyPage=${json};<\\/script><script src="/jimmyqrg-shield-bypass.js"><\\/script>`;
}

/** Collapse common ad-slot DOM so empty iframes do not reserve layout space. */
const COSMETIC_STYLE = `<style id="__rh-cosmetic-ad" data-rh="1">iframe[src*="doubleclick.net"],iframe[src*="googlesyndication"],iframe[src*="googleads"],iframe[name^="google_ads"],iframe[id^="google_ads"],div[id^="div-gpt-ad"],div[id^="ad-gpt-"],ins.adsbygoogle,.adsbygoogle,[data-ad-module],[data-ad-unit-path],[id^="ad_position_"],[class*="dfp-ad"],div[id^="ad_container"],div[id^="ad-slot"],aside[id^="ad-"],div[aria-label="Advertisement"],div[aria-label="Ads"]{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important;max-height:0!important;width:0!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;pointer-events:none!important}</style>`;

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

async function processHtmlNavigation(response, destUrl) {
  if (!isHtmlResponse(response)) return response;
  let text = await response.text();
  if (isJimmyqrgDest(destUrl)) {
    text = injectAfterHeadOpen(text, makeJimmyBypassTag(destUrl));
  }
  if (!text.includes('id="__rh-cosmetic-ad"')) {
    text = injectBeforeHeadClose(text, COSMETIC_STYLE);
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
