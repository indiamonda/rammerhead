importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

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
  /(^|\.)(studyboard|turbowarp|turbowarp\.org|turbowarp\.xyz|scratch|scratch\.mit\.edu|scratchfoundation|scratchr2|mit\.edu|poki|chatgpt|openai|oaistatic|oaiusercontent|claude|anthropic|github|githubusercontent|duckduckgo|deepseek|awswaf\.com|jmail|mk48|discord|discordapp|hcaptcha|recaptcha|gstatic|cloudflare|widgetapi|statsigapi|featuregates|sentry|auth0|twimg|tiktok|tiktokcdn|byteoversea|byteimg|musical|ibyteimg|bilibili|bilivideo|hdslb|biliimg|acfun|poki-gdn|youtube|ytimg|googlevideo|ggpht|google|googleapis|wikipedia|wikimedia|wikidata|mediawiki|reddit|redd\.it|redditstatic|redditmedia|stackoverflow|sstatic|stackexchange|askubuntu|medium|mcdn|quora|quoracdn|imgur|pinterest|pinimg|deviantart|wixmp|soundcloud|sndcdn|spotify|scdn|spotifycdn|codepen|cdpn|codepen\.dev|jsfiddle|jshell|replit|repl\.co|repl\.it|glitch|notion|notion-static|trello|trellocdn|figma|figmaassets|jupyter|mybinder|binder)(\.|$)/i;

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
    const h = event.requestHeaders;
    if (!h || !h.has) return;
    const dest = event.destination;
    if (dest === "document" || dest === "iframe") {
      if (h.has("sec-fetch-site")) h.set("sec-fetch-site", "none");
      if (h.has("sec-fetch-user")) h.set("sec-fetch-user", "?1");
    } else {
      // For subresource requests, determine the correct sec-fetch-site value
      // based on the real origins involved. Blindly setting "same-origin"
      // breaks sites that validate this header on cross-origin API calls
      // (e.g. Scratch sign-in, TurboWarp project loading).
      if (h.has("sec-fetch-site")) {
        try {
          const reqUrl = event.url
            ? typeof event.url === "string"
              ? event.url
              : event.url.href
            : "";
          const referer = h.get("referer") || "";
          if (reqUrl && referer) {
            const reqOrigin = new URL(reqUrl).origin;
            const refOrigin = new URL(referer).origin;
            if (reqOrigin === refOrigin) {
              h.set("sec-fetch-site", "same-origin");
            } else if (
              new URL(reqUrl).hostname.endsWith(
                "." + new URL(referer).hostname.split(".").slice(-2).join(".")
              ) ||
              new URL(referer).hostname.endsWith(
                "." + new URL(reqUrl).hostname.split(".").slice(-2).join(".")
              )
            ) {
              h.set("sec-fetch-site", "same-site");
            } else {
              h.set("sec-fetch-site", "cross-site");
            }
          } else {
            h.delete("sec-fetch-site");
          }
        } catch (_) {
          h.delete("sec-fetch-site");
        }
      }
    }
  } catch (_) {}
});

scramjet.addEventListener("handleResponse", (event) => {
  try {
    const headers = event.responseHeaders;

    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    delete headers["x-frame-options"];
    delete headers["cross-origin-opener-policy"];
    delete headers["cross-origin-embedder-policy"];
    delete headers["cross-origin-resource-policy"];

    // Ensure cross-origin API responses (Scratch, TurboWarp, etc.) can
    // include credentials. Set permissive CORS headers if none present.
    if (!headers["access-control-allow-origin"]) {
      headers["access-control-allow-origin"] = "*";
    }
    if (!headers["access-control-allow-credentials"]) {
      headers["access-control-allow-credentials"] = "true";
    }
  } catch (_) {}
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "adblock-toggle") {
    adBlockEnabled = !!event.data.enabled;
  }
});

// Sites using Remix/React Router that need history.state patching so the
// client-side router can match routes correctly after proxy URL rewriting.
const REMIX_HOSTS = /(?:^|\.)chatgpt\.com$|(?:^|\.)deepseek\.com$/i;

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

  const response = await scramjet.fetch(event);

  // For Remix-based sites (ChatGPT, DeepSeek), patch the HTML response to
  // fix the "No result found for routeId" error. The issue is that Remix's
  // client-side router reads window.location during hydration before
  // Scramjet's location hooks intercept it, causing a route mismatch.
  try {
    const destUrl = decodeScramjetUrl(event.request.url);
    if (
      destUrl &&
      response &&
      response.headers &&
      (response.headers.get("content-type") || "").includes("text/html")
    ) {
      const host = new URL(destUrl).hostname;
      if (REMIX_HOSTS.test(host)) {
        const originalBody = await response.text();
        const destPath = new URL(destUrl).pathname + new URL(destUrl).search;

        // Inject a synchronous script before the first <script> (or at
        // the start of <head>) that patches history.state.usr and
        // ensures window.__remixContext has the correct URL
        const patchScript =
          `<script>` +
          `(function(){` +
          `try{` +
          `var u="${destPath.replace(/"/g, '\\"')}";` +
          `if(window.history&&window.history.replaceState){` +
          `var s=window.history.state||{};` +
          `s.usr=s.usr||{};` +
          `window.history.replaceState(s,"",u);` +
          `}` +
          `}catch(e){}` +
          `})();` +
          `</script>`;

        let patched = originalBody;
        if (patched.includes("<head>")) {
          patched = patched.replace("<head>", "<head>" + patchScript);
        } else if (patched.includes("<HEAD>")) {
          patched = patched.replace("<HEAD>", "<HEAD>" + patchScript);
        } else if (patched.includes("<html")) {
          patched = patched.replace(
            /(<html[^>]*>)/i,
            "$1<head>" + patchScript + "</head>"
          );
        }

        return new Response(patched, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    }
  } catch (_) {}

  return response;
}

loadAdBlockRules();

self.addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});
