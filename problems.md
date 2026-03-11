# Proxy Compatibility Report

Tested via browser automation against `rammerhead.fly.dev`.

## Legend

| Status | Meaning |
|--------|---------|
| PASS | Page loads and is functional |
| PARTIAL | Page loads but some features broken |

---

## Remaining Issues

### Bot detection / Cloudflare challenges

| Site | Status | Notes |
|------|--------|-------|
| canva.com | PARTIAL | Blocked by Cloudflare CAPTCHA ("Verify you are human") |
| discord.com/app | PARTIAL | 502 errors, Cloudflare challenge script 404s |
| reddit.com | PARTIAL | Blocked by Reddit network security ("You've been blocked by network security") |

**Cause:** Even with Chrome-like TLS fingerprinting (JA3 patch), these sites use additional detection: Cloudflare Turnstile challenges, IP reputation scoring, behavioral analysis.
**Possible improvements:** Better HTTP/2 fingerprinting, Turnstile challenge passthrough.

### Google services reject proxied requests

| Site | Status | Notes |
|------|--------|-------|
| docs.google.com | PARTIAL | Redirects to accounts.google.com, auth flow breaks |
| firebase.google.com | PARTIAL | Blank page, Google auth validation fails |

**Cause:** Google validates request origins, cookies, and session tokens strictly. The auth redirect chain breaks because the proxy domain doesn't match Google's expected domains.
**Possible improvements:** Difficult — Google's security is deeply integrated.

---

## Not Yet Tested

- discord.com/gg
- truffled.lol (needs 10 sub-page navigations)
- airtable.com
- miro.com
- replit.com
- codesandbox.io
- stackblitz.com
- pusher.com
- ably.com
- socket.io
- shopify.com
- binance.com
- coinbase.com
- kraken.com
- tradingview.com
- lichess.org
- chess.com
- roblox.com
- steamcommunity.com
- epicgames.com
- itch.io
- agar.io
- slither.io
- geoguessr.com

---

## Fixes Applied

### Session 1

1. **TLS fingerprint patch** (`src/util/patchTlsFingerprint.js`) — Mimics Chrome 131 cipher suites, curves, and sigalgs. Fixed poki.com 403s.
2. **JS cache return bug** (`src/classes/RammerheadJSMemCache.js`) — `get()` was missing `return`, so cache never hit. Caused massive memory waste and OOM crashes on Fly.io.
3. **OOM prevention** (`Dockerfile`) — Added `--max-old-space-size=350` for 512MB Fly VM.
4. **Memory tuning** (`src/config.js`) — Reduced JS cache 50MB→25MB, session cache 1hr→20min.

### Session 2

5. **Script processing fallback** (`src/util/patchScriptProcessing.js`) — Patches hammerhead's JS processing header to add pass-through fallbacks for `__set$`, `__get$`, `__call$`, etc. Fixed: vercel.com, netlify.com, figma.com, gitlab.com, facebook.com, linkedin.com, netflix.com, amazon.com.
6. **Same-origin policy bypass** (`src/util/patchSameOriginPolicy.js`) — Overrides `isPassSameOriginPolicy()` to always return `true`. Fixed: youtube.com, tiktok.com, slack.com.
7. **Permissive CORS response headers** (`src/util/patchResponseHeaders.js`) — Always injects `Access-Control-Allow-Origin`, `Allow-Credentials: true`, and permissive method/header/expose headers.
8. **Aggressive response header stripping** (`src/classes/RammerheadProxy.js`) — Strips 15 response headers including HSTS, permissions-policy, document-policy, NEL, COEP, COOP, CORP, etc.
9. **CSP completely removed** (`src/config.js`) — Replaced complex CSP relaxation with full removal.
10. **Expanded bot detection** (`src/util/browserLikeHeaders.js`) — Added CDN/subdomain → origin mappings for Amazon, Netflix, LinkedIn, Canva, Slack, GitLab, Figma, Reddit, Vercel.
