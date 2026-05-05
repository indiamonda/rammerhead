importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

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
  /(^|\.)(studyboard|turbowarp|scratch|mit\.edu|poki|chatgpt|openai|oaistatic|oaiusercontent|claude|anthropic|github|duckduckgo|deepseek|jmail|mk48|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare|widgetapi|statsigapi|featuregates|sentry|auth0|twimg|tiktok|tiktokcdn|byteoversea|byteimg|musical|ibyteimg|bilibili|bilivideo|hdslb|biliimg|acfun|poki-gdn|youtube|ytimg|googlevideo|ggpht|google|googleapis)\./i;

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

function decodeScramjetUrl(requestUrl) {
  try {
    if (!scramjet.config || !scramjet.config.prefix) return null;
    const origin = self.location.origin;
    const prefix = origin + scramjet.config.prefix;
    if (!requestUrl.startsWith(prefix)) return null;
    const encoded = requestUrl.slice(prefix.length);
    return decodeURIComponent(encoded);
  } catch (_) {
    return null;
  }
}

scramjet.addEventListener("request", (event) => {
  try {
    const url = new URL(event.url);
    const host = url.hostname.toLowerCase();

    if (host.includes("discord") || host.includes("discordapp")) {
      const h = event.requestHeaders;
      if (h.has && h.has("sec-fetch-dest")) {
        h.delete("sec-fetch-dest");
      }
      if (h.has && h.has("sec-fetch-mode")) {
        h.delete("sec-fetch-mode");
      }
      if (h.has && h.has("sec-fetch-site")) {
        h.delete("sec-fetch-site");
      }
    }
  } catch (_) {}
});

scramjet.addEventListener("handleResponse", (event) => {
  try {
    const url = event.url ? event.url.toString() : "";
    const host = new URL(url).hostname.toLowerCase();
    const headers = event.responseHeaders;

    if (
      host.includes("chatgpt") ||
      host.includes("openai") ||
      host.includes("discord") ||
      host.includes("discordapp")
    ) {
      const csp = "content-security-policy";
      const cspRO = "content-security-policy-report-only";
      const xfo = "x-frame-options";
      if (headers[csp]) delete headers[csp];
      if (headers[cspRO]) delete headers[cspRO];
      if (headers[xfo]) delete headers[xfo];
    }
  } catch (_) {}
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "adblock-toggle") {
    adBlockEnabled = !!event.data.enabled;
  }
});

async function handleRequest(event) {
  await scramjet.loadConfig();

  if (!scramjet.route(event)) {
    return fetch(event.request);
  }

  if (adBlockEnabled && adBlockRules) {
    try {
      const destUrl = decodeScramjetUrl(event.request.url);
      if (destUrl && shouldBlockUrl(destUrl)) {
        return new Response("", { status: 204 });
      }
    } catch (_) {}
  }

  return scramjet.fetch(event);
}

loadAdBlockRules();

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
