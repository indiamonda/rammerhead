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
2. **JS cache return bug** (`src/classes/RammerheadJSMemCache.js`) — `get()` was missing `return`
3. **OOM prevention** (`Dockerfile`) — Added `--max-old-space-size=350`
4. **Memory tuning** (`src/config.js`) — Reduced JS cache 50→25MB, session cache 1hr→20min

### Session 2

5. **Script processing fallback** (`src/util/patchScriptProcessing.js`) — Pass-through fallbacks for `__set$`, `__get$`, `__call$`
6. **Same-origin policy bypass** (`src/util/patchSameOriginPolicy.js`) — `isPassSameOriginPolicy()` always returns `true`
7. **Permissive CORS headers** (`src/util/patchResponseHeaders.js`) — Always injects ACAO, credentials, methods, headers
8. **Response header stripping** (`src/classes/RammerheadProxy.js`) — Strips 15 security headers
9. **CSP removed** (`src/config.js`) — Full CSP removal instead of relaxation
10. **Expanded bot detection** (`src/util/browserLikeHeaders.js`) — CDN mappings for 15+ services
11. **HTTP/2 fingerprint** (`src/util/patchTlsFingerprint.js`) — Chrome-like H2 SETTINGS + WINDOW_UPDATE
12. **Google auth redirect fix** (`src/server/setupPipeline.js`) — Bypasses broken redirect chain for Google services by redirecting to direct sign-in URL
