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
  /(^|\.)(studyboard|turbowarp|poki|chatgpt|openai|claude|anthropic|github|duckduckgo|deepseek|jmail|mk48|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare)\./i;

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
