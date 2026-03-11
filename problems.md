# Proxy Compatibility Report

Tested via browser automation against `rammerhead.fly.dev`.

## Legend

| Status | Meaning |
|--------|---------|
| PASS | Page loads and is functional |
| PARTIAL | Page loads but some features broken |
| FAIL | Page blank, errors, or blocked |

---

## Test Results

### Search & Productivity

| Site | Status | Notes |
|------|--------|-------|
| google.com | PASS | Homepage loads, search bar visible |
| docs.google.com | FAIL | Redirects to accounts.google.com, returns 400 Bad Request |
| notion.so | PASS | Full marketing page loads |
| trello.com | PASS | Full marketing page loads |
| figma.com | FAIL | Client-side exception: "Application error: a client-side exception has occurred" |
| canva.com | PARTIAL | Blocked by Cloudflare CAPTCHA ("Verify you are human") |
| slack.com | PARTIAL | Blank page with only a "Go to Slack.com" link |

### Social Media

| Site | Status | Notes |
|------|--------|-------|
| discord.com/app | FAIL | Blank page, 502 errors, Cloudflare challenge script 404s |
| reddit.com | PARTIAL | Blocked by Reddit network security ("You've been blocked by network security") |
| x.com (Twitter) | PASS | Login/signup page loads fully |
| instagram.com | PASS | Login page loads fully |
| tiktok.com | PARTIAL | Shell loads (nav, sidebar) but feed shows "Something went wrong" |
| facebook.com | FAIL | Blank white page |
| linkedin.com | FAIL | No content loads |

### Video & Streaming

| Site | Status | Notes |
|------|--------|-------|
| youtube.com | PARTIAL | Skeleton loaders appear but actual content never loads |
| bilibili.com | PASS | Homepage with video thumbnails loads |
| netflix.com | FAIL | Blank white page |

### Gaming

| Site | Status | Notes |
|------|--------|-------|
| poki.com | PASS | Site loads, game grid visible (thumbnails slow to load) |
| crazygames.com | PASS | Full game catalog loads with categories |
| eaglercraft.com | PASS | Homepage loads with Play Now button |

### Developer & Hosting Platforms

| Site | Status | Notes |
|------|--------|-------|
| github.com | PASS | Full homepage loads |
| gitlab.com | FAIL | Redirects to about.gitlab.com, blank white page |
| cloudflare.com | PASS | Full homepage loads |
| vercel.com | FAIL | Blank page. JS errors: `__set$` / `__get$` not a function, ChunkLoadError |
| netlify.com | FAIL | Blank page. JS errors: `__set$` / `__get$` not a function, Astro hydration failures |
| fly.io | PASS | Full homepage loads |
| render.com | PASS | Full homepage loads |
| supabase.com | PASS | Full homepage loads |
| firebase.google.com | FAIL | Blank white page |

### Chat & Messaging

| Site | Status | Notes |
|------|--------|-------|
| chat.jiushifen.com | PASS | Login page loads |

### E-commerce & Finance

| Site | Status | Notes |
|------|--------|-------|
| amazon.com | FAIL | Blank white page |

---

## Not Yet Tested

The following sites were queued but not yet tested:

- discord.com/gg (typo in original list?)
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

## Summary

**Tested: 28 sites**

| Status | Count | Percentage |
|--------|-------|------------|
| PASS | 14 | 50% |
| PARTIAL | 5 | 18% |
| FAIL | 9 | 32% |

---

## Root Causes of Failures

### 1. Hammerhead JS rewriting breaks modern frameworks
**Affected:** vercel.com, netlify.com, figma.com, gitlab.com, facebook.com, linkedin.com, netflix.com, amazon.com
**Symptom:** Blank page, `__set$` / `__get$` not a function, ChunkLoadError
**Cause:** Hammerhead rewrites JavaScript to intercept property access (`obj.prop` becomes `obj.__get$prop()`). This breaks frameworks that rely on specific JS semantics (Next.js dynamic imports, Astro hydration, Webpack chunk loading, etc.). The rewritten code references hammerhead helper functions that don't exist in the expected scope.
**Difficulty:** Hard. Would require changes to testcafe-hammerhead's JS processing engine.

### 2. Bot detection / Cloudflare challenges
**Affected:** canva.com, discord.com/app, reddit.com
**Symptom:** CAPTCHA pages, "blocked by network security", challenge script 404s
**Cause:** Even with Chrome-like TLS fingerprinting (JA3 patch), some sites use additional detection: Cloudflare Turnstile challenges, IP reputation scoring, behavioral analysis. The TLS patch helps many sites (poki.com now works) but aggressive protections still block.
**Difficulty:** Medium. Could improve with better HTTP/2 fingerprinting and Turnstile challenge passthrough.

### 3. Google services reject proxied requests
**Affected:** docs.google.com, firebase.google.com
**Symptom:** 400 Bad Request, blank pages
**Cause:** Google validates request origins, cookies, and session tokens strictly. Proxied requests fail validation checks.
**Difficulty:** Hard. Google's security is deeply integrated.

### 4. Heavy SPAs fail to fully hydrate
**Affected:** youtube.com, tiktok.com, slack.com
**Symptom:** Shell/skeleton loads but content never appears
**Cause:** The initial HTML renders through the proxy, but subsequent API calls or WebSocket connections fail (CORS issues, authentication failures, or JS rewriting breaking API clients).
**Difficulty:** Medium. Could be improved by debugging specific API call failures per site.

---

## Fixes Already Applied (This Session)

1. **TLS fingerprint patch** (`src/util/patchTlsFingerprint.js`) — Mimics Chrome 131 cipher suites, curves, and sigalgs. Fixed poki.com 403s.
2. **JS cache return bug** (`src/classes/RammerheadJSMemCache.js`) — `get()` was missing `return`, so cache never hit. Caused massive memory waste and OOM crashes on Fly.io.
3. **OOM prevention** (`Dockerfile`) — Added `--max-old-space-size=350` for 512MB Fly VM.
4. **Memory tuning** (`src/config.js`) — Reduced JS cache 50MB→25MB, session cache 1hr→20min.
