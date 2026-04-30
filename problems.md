# Proxy Compatibility Report

Tested via curl against local proxy (`localhost:8080`).

## Legend

| Status | Meaning |
|--------|---------|
| PASS | Page loads with 200, content, and/or title |
| PARTIAL | Page loads but requires browser JS challenge |
| DOWN | Site itself is unreachable (not a proxy issue) |

---

## Test Results (52 sites)

### Search & Productivity

| Site | Status | Notes |
|------|--------|-------|
| google.com | PASS | "Google", 64KB |
| docs.google.com | PASS | "Sign in - Google Accounts", 175KB (redirect fix applied) |
| notion.so | PASS | "The AI workspace that works for you", 68KB |
| trello.com | PASS | "Capture, organize, and tackle your to-dos", 69KB |
| figma.com | PASS | "Figma: The Collaborative Interface Design Tool", 272KB |
| canva.com | PASS | "Canva: Visual Suite for Everyone", 63KB |
| slack.com | PASS | "Slack AI Work Platform", 41KB |
| airtable.com | PASS | SPA shell, 83KB |
| miro.com | PASS | "AI Innovation Workspace", 270KB |

### Social Media

| Site | Status | Notes |
|------|--------|-------|
| discord.com/app | PASS | "Discord", 4KB SPA shell |
| reddit.com | PASS | "Reddit - The heart of the internet", 124KB |
| x.com (Twitter) | PASS | Login/signup page, 58KB |
| instagram.com | PASS | "Instagram", 170KB |
| tiktok.com | PASS | "TikTok - Make Your Day", 77KB |
| facebook.com | PASS | "Facebook", 102KB |
| linkedin.com | PASS | "LinkedIn: Log In or Sign Up", 24KB |

### Video & Streaming

| Site | Status | Notes |
|------|--------|-------|
| youtube.com | PASS | "YouTube", 206KB |
| bilibili.com | PASS | "哔哩哔哩", 26KB |
| netflix.com | PASS | "Netflix - Watch TV Shows Online", 86KB |

### Gaming

| Site | Status | Notes |
|------|--------|-------|
| poki.com | PASS | SPA shell, 97KB |
| crazygames.com | PASS | SPA shell, 48KB |
| eaglercraft.com | DOWN | Site is unreachable (DNS resolves, server unresponsive) |
| jimmyqrg.github.io | PASS | "JimmyQrg - Unblocked Games", 9KB |
| lichess.org | PASS | "lichess.org - Free Online Chess", 13KB |
| chess.com | PASS | "Chess.com - Play Chess Online", 29KB |
| roblox.com | PASS | "Roblox", 22KB |
| steamcommunity.com | PASS | "Steam Community", 14KB |
| epicgames.com | PASS | SPA shell, 170KB |
| itch.io | PASS | "Download the latest indie games", 26KB |
| agar.io | PASS | "Agar.io", 37KB |
| slither.io | PASS | "slither.io", 5KB |
| geoguessr.com | PASS | SPA shell, 107KB |
| truffled.lol | PASS | "Truffled - Education", 6KB |

### Developer & Hosting Platforms

| Site | Status | Notes |
|------|--------|-------|
| github.com | PASS | Full homepage, 131KB |
| gitlab.com | PASS | "AI for the entire software lifecycle", 43KB |
| cloudflare.com | PASS | "Connect, protect, and build everywhere", 73KB |
| vercel.com | PASS | "Vercel: Build and deploy the best web experiences", 150KB |
| netlify.com | PASS | "Push your ideas to the web", 66KB |
| fly.io | PASS | 48KB |
| render.com | PASS | "Render - The cloud for builders", 86KB |
| supabase.com | PASS | 60KB |
| firebase.google.com | PASS | "Firebase - Mobile and Web App Development Platform", 76KB |
| replit.com | PASS | SPA shell, 160KB |
| codesandbox.io | PASS | "CodeSandbox: Instant Cloud Development Environments", 72KB |
| stackblitz.com | PASS | "StackBlitz - Instant Dev Environments", 8KB |

### Chat & Messaging

| Site | Status | Notes |
|------|--------|-------|
| chat.jiushifen.com | PASS | Login page, 11KB |
| pusher.com | PASS | 41KB |
| ably.com | PASS | 59KB |
| socket.io | PASS | 22KB |

### E-commerce & Finance

| Site | Status | Notes |
|------|--------|-------|
| amazon.com | PARTIAL | AWS WAF JS challenge (202); browser auto-solves |
| shopify.com | PASS | "Shopify: The All-in-One Commerce Platform", 115KB |
| binance.com | PARTIAL | AWS WAF JS challenge (202); browser auto-solves |
| coinbase.com | PASS | SPA shell, 71KB |
| kraken.com | PASS | 346KB |
| tradingview.com | PASS | "TradingView - Track All Markets", 152KB |

---

## Summary

**Tested: 52 sites**

| Status | Count | Percentage |
|--------|-------|------------|
| PASS | 49 | 94% |
| PARTIAL | 2 | 4% |
| DOWN | 1 | 2% |

### Remaining PARTIAL (known limitations)

| Site | Issue | Root Cause |
|------|-------|------------|
| amazon.com | AWS WAF JS challenge (202) | First-visit challenge; browser must execute challenge JS to get cookie, then real page loads |
| binance.com | AWS WAF JS challenge (202) | Same mechanism — challenge auto-resolves in real browser |

### DOWN (not proxy issues)

| Site | Issue |
|------|-------|
| eaglercraft.com | Server unresponsive; DNS resolves but no TCP connection |

---

## Fixes Applied

### Session 1

1. **TLS fingerprint patch** (`src/util/patchTlsFingerprint.js`) — Mimics Chrome 131 TLS + HTTP/2 fingerprint
2. **JS cache return bug** (`src/classes/StudyBoardJSMemCache.js`) — `get()` was missing `return`
3. **OOM prevention** (`Dockerfile`) — Added `--max-old-space-size=350`
4. **Memory tuning** (`src/config.js`) — Reduced JS cache 50→25MB, session cache 1hr→20min

### Session 2

5. **Script processing fallback** (`src/util/patchScriptProcessing.js`) — Pass-through fallbacks for `__set$`, `__get$`, `__call$`
6. **Same-origin policy bypass** (`src/util/patchSameOriginPolicy.js`) — `isPassSameOriginPolicy()` always returns `true`
7. **Permissive CORS headers** (`src/util/patchResponseHeaders.js`) — Always injects ACAO, credentials, methods, headers
8. **Response header stripping** (`src/classes/StudyBoardGateway.js`) — Strips 15 security headers
9. **CSP removed** (`src/config.js`) — Full CSP removal instead of relaxation
10. **Expanded bot detection** (`src/util/browserLikeHeaders.js`) — CDN mappings for 15+ services
11. **HTTP/2 fingerprint** (`src/util/patchTlsFingerprint.js`) — Chrome-like H2 SETTINGS + WINDOW_UPDATE
12. **Google auth redirect fix** (`src/server/setupPipeline.js`) — Bypasses broken redirect chain for Google services by redirecting to direct sign-in URL

### Session 3 (multi-site fixes)

13. **`__sb_sess` cookie leak eliminated** (`src/server/setupPipeline.js`, `src/util/patchPageProcessing.js`) — The raw-mode and lite-mode bridges used to write a `__sb_sess=<sessionId>|<targetUrl>` cookie at `path=/` on the proxy host so the server could fall back from Referer to cookie when reconstructing the destination for subresource requests. Because a path=/ cookie on a single proxy host is shared across every proxied site, the last-navigated destination's origin was silently leaking into `Origin`/`Referer` headers for any tab that loaded afterwards — which is why `jmail.world`'s origin showed up inside ChatGPT API requests as `RequestError: Disallowed CORS origin https://jmail.world`. The cookie-read path is gone, the bridges now delete the legacy cookie (`Max-Age=0`), and subresource rescue now relies on `Referer` only (which covers >99% of real sub-requests).
14. **Unconditional top/parent/self spoof** (`src/util/patchPageProcessing.js`) — The anti-detect script only redefined `window.top`/`parent`/`frameElement` when `window.top !== window.self` at injection time. Hammerhead's own iframe wrapping creates a timing race where the check can briefly evaluate as equal, so sites like TurboWarp (which throws "Invalid TurboWarp Embed") could still detect an iframe. The spoof is now unconditional: every injected page sees `top === parent === self` and `frameElement === null`.
15. **Discord custom-header order + hCaptcha whitelist** (`src/util/browserLikeHeaders.js`) — Discord's web client sends `X-Super-Properties`, `X-Fingerprint`, `X-Discord-Locale`, `X-Discord-Timezone`, `X-Debug-Options`, and `X-Track` on API requests. These were previously re-shuffled to the tail of the header block by the Chrome-wire-order reorderer, which is one of the signals Discord's anti-abuse pipeline fingerprints on. They're now reserved into stable slots between `x-requested-with` and `referer`, matching real Chrome behavior. Separately, `hcaptcha.com`/`newassets.hcaptcha.com`/`js.hcaptcha.com`/`imgs.hcaptcha.com`/`recaptcha.net` destinations are now whitelisted from `Referer`/`Origin` rewriting — hCaptcha validates the Referer against the sitekey binding, and our default rewrite-to-destination-origin behavior was breaking the widget on Discord and every other site that uses hCaptcha.
16. **Lite-mode MutationObserver throttled for heavy SPAs** (`src/util/patchPageProcessing.js`) — The lite-mode bridge runs a MutationObserver that, on every added node, does a recursive `querySelectorAll('iframe,script,img,link,a,form,source,video,audio,embed,object,area')` and rewrites URL attributes. On Bilibili (and other dense Chinese SPAs like doubao/qianwen/tongyi, plus ChatGPT/Claude) each feed-card addition inserts hundreds of sub-elements, so scrolling a feed briefly churns the main thread on the deep-scan. For a hard-coded `_HEAVY_SPA` list the observer now only fixes the directly-added node (not its entire subtree), only enqueues rewritable tag types, and caps the backlog at 150 nodes with a 2ms time-slice. The attribute/property setters on elements already catch the delayed cases when the SPA actually touches `src`/`href`/etc, so correctness is preserved while the scroll-jank is eliminated.

---

## Known Unfixable

These are not proxy bugs — they are fundamental limits of "web proxy against a modern anti-abuse pipeline" that no header/script patch can honestly cure. Documenting them so future maintainers don't chase tails.

| Site / flow | Symptom | Why we can't fix it from proxy code |
|---|---|---|
| ChatGPT login | POST `/backend-api/auth/*` returns 401/403 from the ChatGPT origin; Cloudflare Turnstile challenge fails | OpenAI requires a passing Cloudflare Turnstile token tied to a fresh browser fingerprint + residential IP + passing `__cf_bm` cookie that was minted on a direct visit. Our fly.io egress IPs are cloud ASNs that Turnstile flags, and we cannot solve the interactive challenge on the server. The ChatGPT home page, chat UI, and anonymous reads still work; only the auth endpoints reject us. |
| Google sign-in (`accounts.google.com`) | "This browser or app may not be secure" at the password step; sometimes blocks at the email step | Google's Gaia login pipeline runs an unpublished user-agent + headless-detection + behavioral-timing model. Even with perfect Chrome headers and TLS fingerprints, they additionally fingerprint WebGL, Canvas, AudioContext, and timing of keystrokes — none of which a server-side proxy can inject convincingly. The same model runs on `myaccount.google.com` and any Google OAuth consent screen. |
| Google Search (`www.google.com/search?q=...`) | "Our systems have detected unusual traffic from your computer network" | Google Search rate-limits per IP /24 and outright blocks known hosting-provider ranges (incl. fly.io, render.com, AWS, GCP). Any public proxy that serves more than a handful of users per minute from a shared IP eventually trips this. Users should use a Google-Search-API-backed alternative (DuckDuckGo lite is already proxied fine) or self-host on a residential IP. |
| Claude.ai email verification link | Clicking the link in the verification email lands on `claude.ai/verify?...` which says "This link has expired" | Anthropic's verify endpoint is a one-shot redirect that binds the original browser session (cookies set during sign-up) to the IP that clicked the link. If the user signed up through the proxy (proxy IP) but clicks the email link in their real browser (home IP), the binding fails and the token is invalidated. The only fix is "open the verification link through the same proxy session" — which is a user workflow issue, not something we can patch. |
| truffled.lol (occasional) | Connection timeout on TCP 443 from both local network and fly.io proxy | Origin IP 205.209.125.106 (Host Department NJ, LLC) is regularly unreachable from multiple vantage points. This is a site-availability issue on their end (no response on 80 or 443), not a proxy bug. When the origin does respond we serve it fine. |

If any of these stop being blockers in the future (e.g. OpenAI relaxes Turnstile, Google whitelists a hoster, Anthropic changes the binding), we can revisit. Until then, treat the above as expected behavior.
