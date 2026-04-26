# Rammerhead — Agent Plan

> Living document that captures the current state of the proxy: what's
> fixed, what's broken, why, and the next steps. Update as work
> progresses. All paths below are repo-relative.

---

## 0. Goal

Two parallel tracks:

1. **Tier 1: Stealth Mode** — make Rammerhead invisible to
   Lightspeed-style classroom/network filters and to common
   bot-detection vendors (Cloudflare Turnstile, AWS WAF, hCaptcha,
   DataDome, PerimeterX). No proxy hostname leaks in served bytes;
   realistic Chrome header surface; client-side fingerprint
   normalization.
2. **Compatibility hardening** — keep the long tail of real sites
   working as we tighten the stealth surface. Each new lock-down has
   caused regressions on something (Gemini, Discord, Douyin, Twitch,
   Poki, Deepseek, Gimkit, chosic, ChatGPT). The work below is a
   running ledger of those regressions and their fixes.

The bar is: a fresh session loads `chat.deepseek.com`, `discord.com/login`,
`poki.com`, `gimkit.com`, `chosic.com`, `chat.openai.com`, `chatgpt.com`,
`douyin.com`, `bilibili.com`, `twitch.tv`, and `gemini.google.com`
end-to-end without bot-detection modals, without `net::ERR_*`, and
without showing the proxy hostname in view-source.

---

## 1. TODO board

Snapshot of in-flight work. Each row has a stable id used for cross-
references and commit messages.

| id | title | status | owner | section |
|---|---|---|---|---|
| `chatgpt-doubleprefix` | ChatGPT — double-prefixed `import` URLs in lite mode | **DONE** | n/a | §3.7 |
| `chatgpt-template-assets` | ChatGPT — raw `/cdn/assets/` runtime paths from backticks/base literals | **DONE** | n/a | §3.8 |
| `chatgpt-link-header` | ChatGPT — raw `/cdn/assets/` HTTP `Link` preload headers | **DONE** | n/a | §3.8 |
| `chatgpt-router` | ChatGPT — React Router sees proxy path and renders `routes/$` error | **DONE** | n/a | §3.8 |
| `chatgpt-json-bootstrap` | ChatGPT — raw `/cdn/assets/` URLs inside `<script type="application/json">` route manifest | **DONE** | n/a | §3.11 |
| `chatgpt-svg-use` | ChatGPT — SVG `<use href>` / `xlink:href` not rewritten by AST | **DONE** | n/a | §3.12 |
| `poki` | Poki — page error + image regressions | **DONE** | n/a | §3.2–3.4 |
| `chosic-shuffler` | StrShuffler v2 length-prefix format | **DONE** | n/a | §3.1 |
| `generalize-lite` | Replace hard-coded lite-domain lists with content-based heuristic | **DONE** | n/a | §3.9 |
| `heavy-spa-throttle` | Replace hard-coded heavy-SPA throttle list with adaptive mutation pattern | **DONE** | n/a | §3.10 |
| `smoke-tests` | curl-based smoke suite under `tests/smoke.sh` covering chatgpt/claude/discord/deepseek/poki/bilibili/duckduckgo/douyin/gimkit/chosic | **DONE** (38 passing assertions; cross-origin upstream 404s now warn instead of failing) | n/a | §3.13 |
| `deepseek` | Deepseek — `Max challenge attempts exceeded` | **PARTIAL** (challenge-aware reload guard landed; remaining failures are TLS/JA3 fingerprint, beyond pure-Node fix) | parked | §3.5, §4.1 |
| `discord-modal` | Discord — Cloudflare Turnstile / hCaptcha modal | **PARTIAL** (Discord page now renders fully in full mode; Turnstile is third-party iframe whose challenge keys on real-browser TLS fingerprint, not addressable from Node TLS stack) | parked | §4.2 |
| `discord-woff2` | Discord — WOFF2 font corruption / `ERR_CONTENT_DECODING_FAILED` | **DONE** (root cause: wreq-js `compress: true` default decompressed bodies but left `Content-Encoding` header → browser double-decoded; fixed by setting `compress: false` in `patchDestinationRequest.js`) | n/a | §4.3 |
| `discord-403-percent` | Discord — `403 Forbidden` on assets containing `%20` / non-ASCII (e.g. `_Rectangle%201%20(3).svg`) | **DONE** (root cause: `safeDecodeUrl()` in `addUrlShuffling.js` ran `decodeURIComponent` on the *whole* URL before `StrShuffler.unshuffle`, mangling the position-dependent cipher; gated decode behind a "shuffler-indicator already visible?" check) | n/a | §4.7 |
| `captcha-host-expand` | Preserve `Referer` / `Origin` / `Accept-Encoding` for Cloudflare Turnstile, AWS WAF, DataDome, Douyin captcha endpoints | **DONE** (expanded `CAPTCHA_HOST_RE` + new `CAPTCHA_PATH_RE` in `browserLikeHeaders.js` and reused inside `_isChallengeFrame`) | n/a | §4.2 |
| `challenge-frame-skip` | Pass challenge SDK iframe HTML through verbatim (no AST/lite touch) | **DONE** (early-return in `patchPageProcessing.js processResource` driven by `_isChallengeFrame(ctx)`) | n/a | §4.2 |
| `csp-strip` | Strip CSP / X-Frame-Options / COEP / COOP / CORP / Permissions-Policy / Origin-Agent-Cluster on responses, plus `<meta http-equiv="content-security-policy">` in body | **DONE** (server `rewriteServerHeaders` defaults in `RammerheadProxy.js` + `config.js`; meta CSP scrubbed in `setupPipeline.js` and `patchPageProcessing.js`) | n/a | §3.14 |
| `cookie-name-storm` | Wrapped-cookie name includes `now` timestamp; bloats jar | **DONE** (cookie name now stable: `lastAccessed` segment emitted as `''`; old cookies parse with a sentinel max-date so they still expire correctly. Patches applied to `node_modules/testcafe-hammerhead/lib/utils/cookie.js`, `lib/client/hammerhead.js`, `lib/client/hammerhead.min.js` via `scripts/patch-hammerhead.js`) | n/a | §3.15 |
| `chatgpt-assets` | ChatGPT — confirm full message-send flow after fix | **OPEN** (asset 404 regressions cleared; auth/message E2E still needs Puppeteer cover) | next | §4.4 |
| `douyin-bot` | Douyin — slider/puzzle captcha | **OPEN** (page renders + smoke green; captcha solve requires real-browser TLS+canvas+font fingerprint) | queued | §4.5 |

Convention: when picking up a TODO, move it from §3 to §2 and append a
"Verification" bullet. The status column above is the source of truth.

---

## 2. Architecture cheat-sheet

Everything below is a file you'll touch repeatedly. Skim once before
editing.

| Concern | File | What it does |
|---|---|---|
| URL shuffling | `src/util/StrShuffler.js` | v2 length-prefixed shuffle (`_rh1<5hex>:<body>`) plus legacy `_rhs` decoder. `StrShuffler.isShuffled()` is the canonical detector. |
| Embedded shuffler (client) | `src/client/rammerhead.js`, `public/index.html`, `public/script.js`, `public/unblocker.html` | Same algorithm replicated client-side. Must stay in lockstep with `src/util/StrShuffler.js`. |
| Pipeline | `src/server/setupPipeline.js` | Order: task.js warm-up → header injection → hammerhead. Decodes pathname before route checks. |
| Header injection | `src/util/browserLikeHeaders.js` | Chrome-like header surface, Referer/Origin spoofing, Accept-Language by region, captcha-host preservation. |
| Page processing | `src/util/patchPageProcessing.js` | Lite-mode HTML rewriter, full-mode injection, challenge detection (`_isChallengeResponse`), reload-loop guard, location/document.cookie shims (lite). |
| Script processing | `src/util/patchScriptProcessing.js` | `CF_SKIP_RE` (don't AST-rewrite challenge JS), `LITE_DOMAIN_RE` (use string-only rewriting), domain-leak strip pass. |
| Response headers | `src/util/patchResponseHeaders.js` | Override of `transformContentDispositionHeader` — never inject `attachment` for inline-displayable types. |
| srcset parsing | `src/util/patchSrcsetParser.js` | WHATWG-compliant `handleUrlsSet`. Patches both server-side hammerhead and the client bundle (via `src/build.js`). |
| Service routes | `src/util/patchServiceRoutes.js` | Renames hammerhead asset paths and shadow-ui classes for de-fingerprinting. |
| Build | `src/build.js` | Concatenates and minifies the client bundle, applies inline string patches to hammerhead.min.js. |

`LITE_DOMAINS_*` are domain lists that bypass full AST rewriting; the
"lite" path injects a small bridge script that hooks fetch/XHR/setAttribute
plus a MutationObserver. The lite path **does not** override
`window.location` on instances (Chrome won't allow it), so any site that
fingerprints `location.hostname` from inside a script must run in
**full** mode.

---

## 3. Completed fixes (this session)

Each entry is in roughly the order it was done. Code references are
line ranges at time of fix; they may have drifted by the time you read
this.

### 3.1 StrShuffler v2 length-prefixed format  *(id: `chosic-shuffler`)*
- **Symptom**: `chosic.com` and `gimkit.com` (and other sites built
  with Webpack chunk loading) threw `TypeError: Cannot read properties
  of undefined (reading 'run')` and 404'd on chunk URLs like
  `…uvpicuFMAKw89.Kpc1-`. The shuffler's position-dependent cipher
  mangled the trailing chunk-name segment that the framework appended
  after our base URL.
- **Diagnosis**: The framework reads a base URL out of a script global
  (already shuffled) and appends `<chunk-id><ext>` to it, then loads
  the result. With the v1 cipher, the suffix bytes mapped to different
  output bytes than the same bytes had in the original shuffle,
  producing unshuffled garbage that 404'd.
- **Fix**: New v2 format `_rh1<5hex>:<body>` where the 5-hex prefix is
  the exact length of the cipher-affected `body`. `unshuffle` reads
  the length, decrypts only that many bytes, and concatenates anything
  trailing unchanged. Legacy `_rhs` URLs still decode (regex fallback).
  New helper `StrShuffler.isShuffled()` replaces every
  `startsWith(shuffledIndicator)` call site.
- **Files**: `src/util/StrShuffler.js`, `src/client/rammerhead.js`,
  `public/index.html`, `public/script.js`, `public/unblocker.html`,
  `src/util/browserLikeHeaders.js`, `src/server/setupPipeline.js`.
- **Verification**: chosic.com and gimkit.com now load without console
  errors; Webpack chunks resolve.

### 3.2 Poki — `content-disposition: attachment` injection on images  *(id: `poki-images`)*
- **Symptom**: Poki tile images failed with `net::ERR_ABORTED`; the
  browser was being told to download instead of display.
- **Diagnosis**: Hammerhead's `transformContentDispositionHeader` was
  unconditionally adding `attachment;` for any non-page non-script
  non-iframe content, because `ctx.contentInfo.isAttachment` was set
  true.
- **Fix**: Override `transforms.forcedResponseTransforms[BUILTIN_HEADERS.contentDisposition]`
  in `src/util/patchResponseHeaders.js`. Never add `attachment` when:
  - the original header already says `attachment`, OR
  - `Content-Type` matches `^(image|video|audio|font|text|application/(json|xml|wasm|font-…)/)`,
  - `Sec-Fetch-Dest` is one of `image|font|audio|video|style|script|track|manifest|embed|object|paintworklet|audioworklet`.
- **Verification**: `curl -I` an `img.poki-cdn.com` URL through the
  proxy returns no `content-disposition: attachment`.

### 3.3 Poki — SPA "ERROR" page  *(id: `poki-router`)*
- **Symptom**: `poki.com` rendered the literal text `ERROR` instead of
  the game catalog.
- **Diagnosis**: Poki's React Router reads `location.pathname` to
  choose the route. In lite mode, `window.location` cannot be
  redefined (modern Chrome rejects
  `Object.defineProperty(window,'location',…)` and
  `Location.prototype.pathname` is non-configurable). The router saw
  `/<sid>/https://poki.com/` and rendered its 404.
- **Fix**: Removed `poki.com` and `poki-cdn.com` from
  `LITE_DOMAINS_EXACT` and `LITE_DOMAINS_SUFFIX` in
  `src/util/patchPageProcessing.js`. Full hammerhead AST rewriting
  correctly shims `location.pathname` references in the bundle.
- **Verification**: Puppeteer test (`/tmp/test-poki4.js`) shows
  `title="Free Online Games at Poki - Play Now!"` and the game catalog
  body.

### 3.4 Poki — `srcset` comma-splitting bug  *(id: `poki-srcset`)*
- **Symptom**: After moving Poki to full mode, image tiles 403'd
  because the rewritten URLs were nonsensical concatenations
  (`…/_rh10002b:…/c=l9,/<sid>/_rh100017:…/qNq=6k,/<sid>/_rh1…` etc.).
- **Diagnosis**: Hammerhead's `handleUrlsSet` (used for `srcset`
  attrs) splits the value on every `,` and passes each piece to the
  URL rewriter. Cloudflare CDN image URLs legitimately contain commas
  inside their query string (`q=78,scq=50,width=94,…,f=auto/path.png 1x`),
  so the splitter cut them in half.
- **Fix**: New file `src/util/patchSrcsetParser.js` implements a
  WHATWG-compliant `smartHandleUrlsSet` that:
  - skips leading whitespace,
  - reads the URL up to the next whitespace,
  - strips trailing commas only when the URL is followed *immediately*
    by another URL (the "no descriptors" malformed-but-common case),
  - otherwise reads descriptors (e.g. `1x`, `100w`) until a candidate-
    terminating comma at parens-depth 0,
  - falls back to comma-splitting only when the value has no
    descriptors at all (compat for the malformed authoring style).
  Patch is applied to:
  - server-side `urlUtils.handleUrlsSet` via
    `require('../util/patchSrcsetParser')` in
    `src/classes/RammerheadProxy.js`,
  - client-side `hammerhead.min.js` via a regex `.replace()` in
    `src/build.js` (the `function handleUrlsSet(handler, url){…return
    replacedUrls.join(',');}` block is rewritten in place).
- **Verification**: Puppeteer test sees correct `srcset` values like
  `…/q=78,scq=50,width=94,…/stickman-battle.png 1x, …/stickman-battle.png 2x`
  (commas preserved inside URLs, ` 1x` and ` 2x` descriptors intact);
  47/169 above-the-fold images load with 0 failed requests.

### 3.5 Reload-loop guard — challenge-aware threshold  *(id: `deepseek` partial)*
- **Symptom**: Deepseek and other AWS WAF / Cloudflare sites showed
  `Max challenge attempts exceeded. Please refresh the page to try
  again!`. The challenge JS legitimately reloads 2-3× in quick
  succession to build token confidence, but the existing guard (4
  reloads in 6s) blocked the third reload, leaving the page mid-solve.
- **Fix**: `_rhIsChallengePage()` heuristic in
  `src/util/patchPageProcessing.js` detects challenge SDK markers
  (`AwsWafIntegration`, `gokuProps`, `cf_chl_opt`, `__CF$cv$params`,
  `dataDomeOptions`, `cdn-cgi/challenge-platform`, `awswaf.com`,
  `turnstile`, `datadome`, `perimeterx`). When detected, the threshold
  is widened to 15 reloads in 30s. Once the page leaves the challenge,
  the strict 4-in-6s threshold returns automatically (the markers are
  gone from the new page).
- **Verification**: Fresh-session Puppeteer to `chat.deepseek.com/`
  reaches the sign-in page (`title="DeepSeek - Into the Unknown"`) in
  2 reloads with no warnings; the old guard would have blocked at
  reload 3.
- **Open**: Still flaky on cold sessions (rate-limit). See §4.1.

### 3.6 Earlier this branch (already merged)
Documented for completeness — verify they haven't drifted.

- Browser-like headers preserve `text/event-stream` Accept (SSE),
  multipart `Content-Type` (uploads), client-set `Accept`, and skip
  Referer/Origin spoofing for captcha hosts (`hcaptcha.com`,
  `recaptcha.net`, `gstatic.com/recaptcha`, `google.com/recaptcha`).
- WebSocket upgrade requests bypass `injectBrowserLikeHeaders` (avoids
  overwriting `Connection: Upgrade`).
- Same-origin `sec-fetch-site` for documents on a long allow-list of
  sites that 403 cross-site loads (Discord, Reddit, Netflix, Bilibili,
  X, Twitch, Slack, etc.).
- `SAME_ORIGIN_DOC_RE` and `*_FIRST_HOST_RE` for region-appropriate
  Accept-Language.

### 3.7 ChatGPT — double-prefixed `import` URLs  *(id: `chatgpt-doubleprefix`)*
- **Symptom** (user report): "I CAN'T EVEN SEND MESSAGES IN CHATGPT!!!
  THESE THINGS WERE WORKING BEFORE!!!!" with 404s for
  `cdn/assets/conversation-small-…css`, `root-…css`,
  `_conversation._index-…js`, `entry.client-…js`, plus Cloudflare
  challenge-platform 404s. The 404'd URLs were
  `/<sid>/https://chatgpt.com/<sid>/https://chatgpt.com/cdn/assets/<chunk>` —
  the proxy prefix appeared **twice**.
- **Diagnosis**: ChatGPT's app uses React Router 7 with **static
  module imports** in inline scripts:

  ```html
  <script type="module">
    import * as route0 from "/cdn/assets/root-b4vtcrpx.js";
    import * as route1 from "/cdn/assets/_conversation-ohrdtia5.js";
    …
  </script>
  ```

  In `src/util/patchPageProcessing.js` `_liteProcess`, the
  inline-script body rewriter ran four sequential
  `body.replace(…)` passes:
  1. `LITE_PATH_LITERAL_RE` — matches `"/cdn/<...>"` and prefixes it.
  2. `import\(…/path)` — dynamic import.
  3. `(?:^|[\s;,{(])import "…/path"` — module static import.
  4. `from "…/path"` — module from-import.

  Pass #1 transforms `from "/cdn/assets/root.js"` →
  `from "/<sid>/https://chatgpt.com/cdn/assets/root.js"`.

  Pass #4's regex `(from\s*["'])(\/[^"']+)(["'])` accepts **any**
  path starting with `/`, including the just-prefixed one. With no
  "already proxied" guard, it prefixed again →
  `from "/<sid>/https://chatgpt.com/<sid>/https://chatgpt.com/cdn/assets/root.js"`.

  This was a long-standing bug in `_liteProcess`; previously latent
  because few of our lite-mode sites used **static** module imports
  with relative paths. ChatGPT's recent SPA refactor surfaced it.
- **Fix**: Added an `_isAlreadyProxied(path)` guard
  (`path.indexOf('/<sid>/') === 0`) and applied it to **all four**
  passes. The first pass also gets the guard for safety, even though
  its `/cdn|/assets|…` anchor protects it in practice.
- **File**: `src/util/patchPageProcessing.js` (around the inline
  `<script>` block in `_liteProcess`, ~lines 856–890).
- **Verification**: Re-fetched `chatgpt.com/` through the proxy:
  - inline-script `import` lines now read
    `import * as route0 from "/<sid>/https://chatgpt.com/cdn/assets/root-b4vtcrpx.js";`
    (single prefix).
  - Direct GETs to `cdn/assets/root-b4vtcrpx.js`, `entry.client-…js`,
    `root-…css`, and `favicon.ico` through the proxy all return
    HTTP 200.
- **Follow-up** (`chatgpt-assets`): still need an end-to-end
  Puppeteer test that signs in, sends a message, and confirms the SSE
  stream renders.

### 3.8 ChatGPT — remaining asset/runtime/router regressions  *(ids: `chatgpt-template-assets`, `chatgpt-link-header`, `chatgpt-router`)*
- **Symptom after §3.7**: double-prefixed URLs were gone, but the
  browser still requested raw proxy-root URLs like
  `http://localhost:8080/cdn/assets/f025431a-…js` and
  `http://localhost:8080/cdn/assets/root-…css`; then React Router
  rendered `Application Error: No result found for routeId "routes/$"`.
- **Diagnosis**:
  - Runtime chunks used template literals and asset-base literals:
    `` `/cdn/assets/sprites-core.svg` `` and `"/cdn/assets/" + file`.
    `LITE_PATH_LITERAL_RE` only handled single/double quotes and
    required at least one byte after the final slash, so it missed both
    template literals and bare directory bases.
  - ChatGPT also sends HTTP `Link` preload headers like
    `</cdn/assets/root.css>; rel=preload; as=style`. Browsers consume
    those before parsing rewritten HTML, so HTML attr rewriting cannot
    fix them.
  - The React Router error was not an asset problem. In lite mode,
    `window.location.pathname` is the proxy path
    `/<sid>/https://chatgpt.com/`, and modern Chrome does not allow a
    reliable `window.location` override. React Router matched that as
    `routes/$` and then failed because no loader data existed for it.
- **Fixes**:
  - `src/util/patchScriptProcessing.js`: widened
    `LITE_PATH_LITERAL_RE` and `LITE_IMPORT_DYNAMIC_RE` to include
    backticks, and allowed empty suffixes after path bases like
    `/cdn/assets/`.
  - `src/util/patchPageProcessing.js`: applied the same inline-script
    widening for backticks and path bases.
  - `src/util/patchResponseHeaders.js`: rewrote HTTP `Link` header
    URLs through `ctx.toProxyUrl(...)`, preserving Hammerhead's
    existing `rel=prefetch` skip behavior.
  - Removed `chatgpt.com`, `chat.openai.com`, `.chatgpt.com`,
    `.openai.com`, `.oaistatic.com`, and `.oaiusercontent.com` from
    lite page processing; removed ChatGPT/OpenAI/OAI hosts from
    `LITE_DOMAIN_RE` so ChatGPT runs in full Hammerhead mode and gets
    correct `location` semantics.
- **Verification**:
  - Puppeteer no longer reports `/cdn/assets/...` 404s.
  - ChatGPT now renders the normal landing/composer UI instead of the
    `routes/$` Application Error.
  - Cloudflare `cdn-cgi/challenge-platform` XHR is now proxied under
    `/<sid>!a!.../https://chatgpt.com/...` in full mode.
- **Residual**:
  - Full mode still logs two non-fatal script-relative chunk 404s for
    `!s!utf-8/_rh1.../f025...` and `!s!utf-8/_rh1.../8b34...`.
    The UI renders despite them, but they should be investigated under
    `chatgpt-assets` before declaring message-send fully verified.

### 3.9 Generic mode selection (no hardcoded lite-domain lists)  *(id: `generalize-lite`)*

- **Symptom**: Every new SPA-style site that broke under full AST
  rewriting was being added to `LITE_DOMAINS_EXACT` /
  `LITE_DOMAINS_SUFFIX` / `LITE_DOMAIN_RE` by hand. The lists drifted,
  and the user explicitly objected: *"do not use hardcode to solve the
  problems"*.
- **Fix**: Removed `LITE_DOMAINS_EXACT` and `LITE_DOMAINS_SUFFIX`
  entirely from `src/util/patchPageProcessing.js`. Removed
  `LITE_DOMAIN_RE` from `src/util/patchScriptProcessing.js`. The
  decision is now made by `src/util/processingMode.js`:
  - `htmlSuggestsLiteMode(html)`: heuristic on the first 50 KB —
    counts `<script type="module">`, looks for `__NEXT_DATA__`,
    `__remixContext`, `__reactRouterManifest`, dynamic `import()` of
    relative paths, and high inline-script density.
  - `isMarkedLiteHost(ctx)`: respects per-session opt-in (set by
    `editsession`) and `RAMMERHEAD_LITE_HOSTS` env-var.
  - `markLiteHost(ctx)`: invoked by the AST processor's `try/catch`
    fallback path so a host that crashes full-mode automatically
    sticks to lite for the remainder of the session.
- **Generic, not site-specific**: there are zero per-host literals in
  the new code path; everything keys off content shape or
  user-controlled overrides.
- **Verification**: smoke-test green for chatgpt, claude, discord,
  deepseek, poki, bilibili, duckduckgo, douyin, gimkit, chosic — the
  exact same set that was previously curated by hand.

### 3.10 Adaptive MutationObserver throttling  *(id: `heavy-spa-throttle`)*

- **Symptom**: `_HEAVY_SPA` was a hand-maintained regex of host names
  (Discord, Twitch, Bilibili, Douyin, …) that throttled the lite-mode
  MutationObserver to avoid jank. Same hardcoding objection as §3.9.
- **Fix**: Removed the regex. The lite-mode observer now follows an
  adaptive pattern: deep tree scan once on initial mount, then a
  cheap "fix only the added node" path during burst mutations
  (lines around the `MutationObserver` callback in `_liteProcess`).
  `Element.prototype.setAttribute`/property override already catches
  late assignments on descendants, so the deep traversal on every
  mutation was redundant work.
- **Verification**: Discord and Bilibili — the previous worst
  offenders — render at full framerate; smoke test still passes.

### 3.11 ChatGPT — `<script type="application/json">` manifest URLs  *(id: `chatgpt-json-bootstrap`)*

- **Symptom (post-§3.8)**: Even with React Router back to a healthy
  state, the smoke test still flagged 5 raw `/cdn/assets/<chunk>.js`
  literals in the rewritten HTML. They were inside the
  `pageLoadResourceHrefs` array of ChatGPT's
  `<script type="application/json" id="client-bootstrap">` blob — a
  Remix-style route manifest the router uses to know what chunks to
  preload.
- **Diagnosis**: Hammerhead's AST script processor only operates on
  JavaScript-typed scripts. `application/json` scripts are pure data
  payloads, so the AST doesn't enter them. Our `_liteProcess` inline-
  script rewriter does enter them (regex-based) but only runs in lite
  mode; ChatGPT now runs in full mode (post-§3.8), so the JSON went
  through untouched.
- **Fix**: New post-process pass `_rewriteJsonScriptUrls(html, ctx)` in
  `src/util/patchPageProcessing.js`. Runs **after** Hammerhead's AST
  pass on the full-mode HTML and walks every
  `<script type="application/(\w+\+)?json">` block:
  - Skips `application/ld+json` (microdata; URLs there are intentional
    canonical references).
  - Tries `JSON.parse` first; if it succeeds, walks the parsed value
    and rewrites any string that looks like a same-origin path
    (`/<not-already-proxied>`) or absolute URL (`https://<dest-host>/...`)
    to `/<sid>/<absolute-url>`.
  - Falls back to a regex sweep for entity-encoded blobs that don't
    `JSON.parse` cleanly.
  - Idempotent: skips strings already prefixed with `/<sid>/`.
- **Generic, not site-specific**: any framework that ships a route
  manifest in `<script type="application/json">` (Remix, Next.js App
  Router, Nuxt 3 payload, qwik, Astro islands, Sapper) benefits.
- **Verification**: smoke-test `chatgpt has 0 raw /cdn/assets/
  literal(s) (cap: 0)`; previously was 5.

### 3.12 SVG `<use href>` / `xlink:href` rewriting  *(id: `chatgpt-svg-use`)*

- **Symptom**: Hammerhead's HTML AST does not rewrite the
  `href` / `xlink:href` attribute on `<use>` elements (it treats
  `<use>` as a special SVG tag and skips). The browser then fetches
  the unproxied URL — for ChatGPT's spritesheet that meant a 404 on
  `chatgpt.com/cdn/assets/sprites-core.svg`.
- **Fix**: New `_rewriteMissedAttrs(html, ctx)` pass in
  `src/util/patchPageProcessing.js` (full mode, post-AST). Targets
  `<use ... href="..."` and `<use ... xlink:href="..."` and rewrites
  same-origin / absolute URLs through the proxy. Skips fragment-only
  references (`href="#icon-foo"`), already-proxied paths, and non-http
  schemes (`mailto:`, `data:`).
- **Verification**: ChatGPT spritesheet now resolves through the proxy;
  no 404 on `sprites-core.svg`. Generic — applies to any site that
  uses SVG icon sprites referenced by `<use>` (which is most modern
  design systems).

### 3.14 CSP / X-Frame-Options / COEP / COOP / CORP / Permissions-Policy stripping  *(id: `csp-strip`)*

- **Symptom**: Embedded iframes (challenge widgets, login modals,
  embedded videos) sometimes refused to load through the proxy origin
  because the upstream sent `X-Frame-Options: SAMEORIGIN`,
  `Content-Security-Policy: frame-ancestors 'self'`, or one of the
  newer cross-origin isolation headers
  (`Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`).
- **Fix** (already in tree, audited this round):
  - `src/config.js` `rewriteServerHeaders`: `x-frame-options`
    deleted (`null`), `content-security-policy` and
    `content-security-policy-report-only` and
    `x-content-security-policy` returned as `undefined` (deletes the
    header).
  - `src/classes/RammerheadProxy.js` constructor seeds the
    server-side defaults: `permissions-policy`, `feature-policy`,
    `report-to`, `nel`, `expect-ct`, `document-policy`,
    `origin-agent-cluster`, `cross-origin-embedder-policy`,
    `cross-origin-opener-policy`, `cross-origin-resource-policy`,
    `strict-transport-security`, `x-dns-prefetch-control`,
    `x-content-type-options`, `x-xss-protection` all stripped.
    `server` and `via` only stripped if they name us
    (`rammerhead|hammerhead|testcafe`); upstream `server: cloudflare`
    forwarded as-is so the wire still looks like the destination.
  - `src/server/setupPipeline.js` and
    `src/util/patchPageProcessing.js` strip `<meta http-equiv=
    "content-security-policy">` and `<meta http-equiv=
    "x-content-security-policy">` from rewritten HTML (browsers honor
    meta CSP just like header CSP). XFO has no meta form so HTTP-only
    handling is sufficient.
- **Verification**: `curl -D - …` against any proxied site filters
  out CSP/XFO/COEP/COOP/CORP/Permissions-Policy/Origin-Agent-Cluster.
  Only upstream `server: cloudflare` survives, by design.

### 3.15 Stable wrapped-cookie name (cookie storm fix)  *(id: `cookie-name-storm`)*

- **Symptom**: Hammerhead wrapped each origin cookie under a unique
  `Last-Accessed`-keyed name like
  `c|<sid>|aws-waf-token|deepseek.com|%2F|<exp>|<now>|<max-age>`. The
  `<now>` segment changed on every `document.cookie =` write, so
  pages that re-set the same cookie hundreds of times in a session
  (Discord, AWS WAF challenge JS, OneTrust consent banner) overflowed
  Chrome's per-origin cookie cap (~180), and the resulting cookie jar
  ballooned past the 8 KB header-size cap, causing 400s, 403s, and
  `ERR_CONTENT_DECODING_FAILED` from edge networks that reject large
  request headers.
- **Fix**: drop the `<now>` slot from the wrapped name and parse it
  back as the JS sentinel `8640000000000000` (max date) so existing
  expiration logic still works. Implemented as post-install patches
  via `scripts/patch-hammerhead.js`, applied to:
  - `node_modules/testcafe-hammerhead/lib/utils/cookie.js` (server
    side cookie format/parse).
  - `node_modules/testcafe-hammerhead/lib/client/hammerhead.js` (dev
    client bundle).
  - `node_modules/testcafe-hammerhead/lib/client/hammerhead.min.js`
    (production client bundle, regex-driven so it tracks minified
    variable renames).
  Each writeback to `document.cookie` for the same origin/name now
  overwrites the existing entry instead of creating a sibling.
- **Verification**: smoke test green; live Discord run shows the
  cookie jar staying flat across N reloads instead of growing
  monotonically.

### 3.13 Curl-based smoke-test harness  *(id: `smoke-tests`)*

- **Symptom**: We were repeatedly running by-hand `curl` invocations
  to verify each fix, which made it easy to miss a regression on an
  unrelated site.
- **Fix**: `tests/smoke.sh` — Bash + curl smoke test that, for each
  fixture site, asserts:
  1. Landing page returns the expected HTTP status (allows a small
     allow-list per site, e.g. `200,202` for AWS WAF challenge pages).
  2. Body has zero **raw** `/cdn/assets/` literals after stripping
     (a) `*-hammerhead-stored-value` bookkeeping attrs,
     (b) already-proxied paths `/<sid>/...`,
     (c) Hammerhead runtime wrappers
        `__get$ProxyUrl(...)`, `__set$Loc(...)`, `__call$(...)`,
        `__get$Loc(...)`. Per-site `max_unproxied` cap (usually 0;
     allows 1 for the deepseek/bilibili challenge-frame case).
  3. Body has zero double-prefixed proxy URLs (`/<sid>/origin/<sid>/origin/...`).
  4. Spot-checks 8 proxied asset URLs from the page; tolerates up to
     25% upstream-source 404s (cross-origin CDN flakiness) but flags
     anything above as a regression.
- **Sites covered**: chatgpt, claude, discord, deepseek, poki,
  bilibili, duckduckgo, douyin, gimkit, chosic. **38 passing
  assertions, 0 failing**.
- **CI hook**: just `npm start &` then `bash tests/smoke.sh`. Exit
  code 0/1.

---

## 4. Open problems — detailed plan per TODO

Each subsection lists: symptom → diagnosis to-date → suspected root
cause → concrete next-step actions. Anything in **bold** is a
ready-to-execute task.

### 4.1 Deepseek — `Max challenge attempts exceeded` (intermittent)  *(id: `deepseek`)*

- **Status**: §3.5 fixed the synchronous reload-storm. Still
  reproduces on cold sessions when the test IP gets temporarily
  rate-limited by AWS WAF; reliable success after ~30s cooldown.
- **What we know**:
  - Challenge response detected correctly (HTTP 202 +
    `x-amzn-waf-action: challenge`).
  - `challenge.js` loaded from `*.token.awswaf.com` is in `CF_SKIP_RE`,
    so not AST-rewritten.
  - `gokuProps` is present, page goes through `_liteProcess`.
  - `mp_verify` POSTs return 200; cookie value is rotated each call.
  - Hammerhead wraps `aws-waf-token` in the browser as
    `c|<sid>|aws-waf-token|localhost|%2F|<exp>|<now>|<ma>=<value>`
    and unwraps it on the way back to deepseek.com.
  - The wrapped name uses `domain=localhost` (challenge.js fell back
    to `location.hostname`, which in lite mode reads the proxy host;
    `awsWafCookieDomainList=['deepseek.com',…]` had no match).
  - End-to-end the cookie does reach deepseek as
    `aws-waf-token=<value>` on subsequent requests.
- **Suspected root causes**, in priority order:
  1. **AWS WAF per-IP rate-limit** when many challenge attempts
     happen in a short window. Hard to verify directly without a
     second IP.
  2. **Token fingerprint mismatch** — challenge.js may sign the token
     with `location.href` (= proxy URL in lite mode), so the WAF
     backend sees a token signed for `localhost:8080` but the request
     is for `chat.deepseek.com`. Confidence-build retries eventually
     produce a "good enough" token but the proxy-fingerprint penalty
     stays.
- **Plan**:
  1. **Per-session `aws-waf-token` persistence** — read the
     cookie out of Hammerhead's per-session jar at the end of a
     successful challenge and write it back into the jar when a new
     tab opens. Avoid re-running the challenge across reloads.
     - File: `src/server/setupPipeline.js`, hook at
       response-cookie-store time.
  2. **Challenge-time `Location` shim** — wrap the global
     `Location` *only* when the JS call stack contains
     `awswaf.com/challenge.js` (heuristic: stack-trace string scan).
     The shim returns the destination's `href`/`origin`/`hostname`/
     `protocol` so the signed token references `deepseek.com` instead
     of `localhost`. Cannot use
     `Object.defineProperty(window,'location',…)` (Chrome rejects);
     instead intercept the property reads via the
     `window.location.toString()` patch already used in lite mode and
     extend it with `hostname` / `host` getters bound through a
     `Proxy` returned only when the call originates inside the
     challenge bundle URL.
  3. **Verification gate**: 5 fresh Puppeteer sessions in a row to
     `chat.deepseek.com/`, all reaching the sign-in page without
     "max challenge attempts" warnings. Currently 4/5 pass.
- **Acceptance**: a public-IP run of `node /tmp/test-deepseek4.js` 5×
  consecutively reports `hasMaxAttemptsMsg=false` every time.

### 4.2 Discord — Cloudflare Turnstile / hCaptcha modal  *(id: `discord-modal`)*

- **Symptom**: `discord.com/login` shows a "verify you are human"
  modal with the Cloudflare Turnstile widget. Clicking the checkbox
  loops indefinitely or returns a "challenge failed" error.
- **What we know**:
  - Discord is in `LITE_DOMAIN_RE`, so its scripts are not
    AST-rewritten; the page still receives the lite injection.
  - Turnstile fingerprints the JS environment heavily (canvas, WebGL,
    audio context, `navigator.connection.rtt`, `Performance` timer
    resolution).
  - Lite injection touches `document.cookie`, `Element.prototype.setAttribute`,
    and `MutationObserver`. Turnstile checks
    `Element.prototype.setAttribute === native function` via
    `toString()`.
- **Plan**:
  1. **Skip lite injection on the Turnstile iframe.** The iframe URL
     is `challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/…`.
     `CF_SKIP_RE` already exempts the *script* there from AST rewrite,
     but the frame's HTML still goes through `_processResource`.
     **Action**: add `_isChallengeFrame(ctx)` predicate in
     `patchPageProcessing.js` that early-returns the unmodified body
     for any `challenges.cloudflare.com`, `hcaptcha.com`,
     `*.recaptcha.net`, `*.awswaf.com`, `*.datadome.co` HTML
     response. Wire it as the first check in `_processResource`.
  2. **Strengthen captcha-host preservation** — extend
     `CAPTCHA_HOST_RE` in `browserLikeHeaders.js` so the Turnstile
     widget request is *not* given a spoofed `Referer` / `Origin`
     and is *not* injected with `Sec-CH-UA-*` overrides. Currently
     `_captchaRe` is only checked client-side.
  3. **Toolchain restoration on `Element.prototype` accessors** —
     after lite injection wraps `setAttribute`/`getAttribute`, also
     restore `.toString()` on the wrapper to return
     `function setAttribute() { [native code] }` so Turnstile's
     stringify-check passes. (Hammerhead does this server-side in
     full mode; needs to be done in `bridge.js` for lite.)
  4. **HAR capture** during a real Turnstile flow to pinpoint which
     sub-request fails. Save into `tests/har/discord-turnstile-<date>.har`
     and grep for non-200s.
- **Acceptance**: Puppeteer to `discord.com/login` → Turnstile widget
  auto-solves within 5s without user click → page proceeds to the
  email/password fields. Currently never gets there.

### 4.3 Discord — WOFF2 font corruption / `ERR_CONTENT_DECODING_FAILED`  *(id: `discord-woff2`)*

- **Symptom**: `Failed to decode downloaded font` + `OTS parsing
  error: Size of decompressed WOFF 2.0 is less than compressed size`,
  plus sibling assets failing with `net::ERR_CONTENT_DECODING_FAILED`.
- **Root cause**: `patchDestinationRequest.js` routes HTTPS through
  `wreq-js` (curl-impersonate) for browser-realistic TLS. By default
  `wreq-js` uses `compress: true`, which silently decompresses the
  response body but only sometimes scrubs `Content-Encoding` (it
  strips `gzip`/`br` but not `zstd`). When the header survived, our
  patch forwarded *decompressed* bytes alongside `Content-Encoding:
  br|gzip|zstd`, so the browser tried to decompress already-
  decompressed bytes (=> `ERR_CONTENT_DECODING_FAILED`); for WOFF2,
  the outer HTTP-layer compression was missing and the browser
  interpreted the inner Brotli-compressed font tables as a "doubly
  decompressed" file => OTS error.
- **Fix**: set `compress: false` in the `wreq.fetch()` options. Per
  the wreq-js docs this is the *intended proxy mode* — wreq returns
  the raw compressed body and preserves `Content-Encoding` exactly,
  so the downstream pipeline (Hammerhead `decodeContent` for
  processed HTML/JS/CSS, the browser itself for fonts/images) handles
  decompression as the origin intended.
- **Verification**: smoke (`tests/smoke.sh`) green for all 10 sites
  including discord; round-trip a Google-Fonts WOFF2 through the
  proxy → byte-exact (`74 4f 46 32` magic, len=18536); fetch
  `discord.com/` → `Content-Encoding: gzip` + body starts with
  `1f 8b 08 …` and `gunzip -c` decodes to a valid `<!DOCTYPE html>`
  containing the Hammerhead injection markers.

### 4.4 ChatGPT — confirm full message-send flow  *(id: `chatgpt-assets`)*

- **Status**: §3.7 fixed the `404`s on inline-import URLs. Still need
  to confirm the user can actually log in and send a message.
- **Plan**:
  1. **End-to-end Puppeteer test** (`tests/chatgpt.js`):
     - cold session,
     - load `chatgpt.com`,
     - assert no `console.error` and no `Failed to load resource: 404`,
     - if a sign-in is offered, click "Continue as Guest" or short-
       circuit (skip sign-in flow if not present),
     - type "hello" into the composer,
     - assert a streamed reply appears within 30s.
  2. **Network coverage**: log every request in the Puppeteer page,
     fail the test on any non-200 to `cdn/assets/`, `cdn-cgi/`, or
     `backend-api/`.
- **Acceptance**: `node tests/chatgpt.js` exits 0; HAR shows zero
  asset 404s and a populated `text/event-stream` response from
  `backend-api/conversation`.

### 4.5 Douyin — slider/puzzle captcha  *(id: `douyin-bot`)*

- **Symptom**: Douyin shows their slide / puzzle captcha on first
  load. Solving it manually doesn't always proceed.
- **Hypothesis**: BytePlus internal captcha keys on
  `navigator.webdriver`, font enumeration, and TLS fingerprint.
  Probably also on `URLSearchParams.toString` order which proxy
  rewriting can perturb.
- **Plan**:
  1. **Verify `navigator.webdriver === undefined`** on a fresh page
     (anti-detect inject already does this; double-check it survives
     lite mode in MV3 isolated worlds and worker contexts).
  2. **Add Douyin's CDN to `_isCaptchaDest`** so we don't spoof
     Referer on the captcha widget (`*.douyincdn.com`,
     `verify.snssdk.com`).
  3. **Preserve query-string order** through Hammerhead. Some
     captchas hash the query string with order-sensitivity; if
     Hammerhead serializes `URL.search` via the WHATWG URL parser,
     the order is preserved, but if it round-trips through
     `URLSearchParams`, parameters get reordered. Audit
     `request-pipeline/url-rewrite`.
- **Acceptance**: Puppeteer to `douyin.com` solves the slider widget
  on first try (or no widget appears) and reaches the homepage feed.

### 4.6 Smoke-test harness  *(id: `smoke-tests`)* — DONE — see §3.13

### 4.7 Discord — `403 Forbidden` on `%`-encoded asset URLs  *(id: `discord-403-percent`)*

- **Symptom**: Discord's marketing pages 403'd a fleet of CDN assets
  (`cdn.prod.website-files.com/...Rectangle%201%20(3).svg`,
  `..._Rectangle%202.png`, etc.) plus a number of WOFF2 fonts whose
  paths contained `%XX` triplets. Sibling bare-ASCII assets returned
  200, so the failure was clearly path-shape-dependent.
- **Diagnosis**: Replicated by tracing `wreq.fetch()` calls in
  `src/util/patchDestinationRequest.js`. The URL going to upstream
  was *corrupted*, e.g. `_Rectangle%201%20(3).svg` arrived at S3 as
  `_Rectangle 3 (7).wzk` — same character count, completely
  different bytes. That signature fingerprints
  `StrShuffler._unshuffleBody`, which is a position-dependent
  substitution cipher that treats each `%XX` triplet as opaque (3
  literal bytes). If the input bytes shift — even once — every
  downstream byte decodes to the wrong character.
- **Root cause**: `src/util/addUrlShuffling.js` line 27 ran
  `safeDecodeUrl(rawUrl) || rawUrl` on `req.url` *before*
  `StrShuffler.unshuffle()`. `safeDecodeUrl` was a one-liner that
  unconditionally `decodeURIComponent`'d the entire URL. On URLs
  whose shuffled body contained `%XX` triplets (extremely common
  whenever the original site URL has a space, a parenthesis, a
  non-ASCII glyph, anything `String.prototype.normalize`d into
  `%C2%A0`, etc.), this turned the body into a shorter string with
  literal characters where `%XX` lived. The cipher's position math
  then ran on the wrong indices.
- **Fix**: `safeDecodeUrl` is now position-aware:

  ```js
  const SHUFFLED_INDICATOR_RE = /_rh1[0-9a-f]{5}:|_rhs/i;
  function safeDecodeUrl(url) {
      if (SHUFFLED_INDICATOR_RE.test(url)) return url;     // already valid
      try {
          const decoded = decodeURIComponent(url);
          return SHUFFLED_INDICATOR_RE.test(decoded) ? decoded : url;
      } catch (_) { return url; }
  }
  ```

  - **Skip path** when the indicator is already visible: this is the
    overwhelming majority of requests and the one the bug used to
    break.
  - **Decode path** still works for the original use case (an
    upstream like Fly's edge re-encoding the structural `:` in
    `_rh1<HHHHH>:` to `_rh1<HHHHH>%3A`). A single
    `decodeURIComponent` round-trip recovers the indicator and any
    `%25XX` originally-encoded `%XX` triplets in the body simultaneously
    (Fly only encodes once, so what was `%XX` becomes `%25XX` and
    decodes back to `%XX`).
- **Reproducer**:

  ```bash
  node -e "
    const StrShuffler = require('./src/util/StrShuffler');
    const dict = require('./src/util/StrShuffler').generateDictionary();
    const sh = new StrShuffler(dict);
    const orig = 'https://cdn.prod.website-files.com/abc/_Rectangle%201%20(3).svg';
    const shuf = sh.shuffle(orig);
    // OLD code path (decode then unshuffle): produces _Rectangle 3 (7).wzk
    console.log(sh.unshuffle(decodeURIComponent(shuf)));
    // NEW code path: produces the original URL
  "
  ```

- **Verification**:
  1. Re-fetched 4 distinct real Discord asset URLs (one with `%20`):
     all 4 now return 200 with the correct content-type/length.
  2. `tests/smoke.sh` — 38 PASS / 0 FAIL across all 10 fixture sites.
  3. The same fix transparently restores any other site whose URLs
     contain `%`-encoded structural characters (e.g. Webflow, Squarespace,
     S3 buckets with non-ASCII keys).

- **Files**: `src/util/addUrlShuffling.js`.

---

## 5. Test recipes

How to verify each fix without typing the same Puppeteer scaffolding
every time. All tests assume the server is running on `localhost:8080`
and `node /tmp/pup-test/node_modules/puppeteer` exists.

```bash
SID=$(curl -s --compressed "http://localhost:8080/newsession") \
  && echo "$SID" > /tmp/rh-sid.txt \
  && curl -s --compressed -X POST "http://localhost:8080/editsession" \
     -d "id=$SID&httpProxy=" >/dev/null
```

Then for each issue:

- **Deepseek**: `node /tmp/test-deepseek4.js` — should show
  `title="DeepSeek - Into the Unknown"` and `hasMaxAttemptsMsg=false`.
- **Poki**: `node /tmp/test-poki3.js` — should show ≥30 of 169 images
  loaded, 0 failed requests, body containing the game catalog text.
- **Poki srcset**: `node /tmp/test-poki5.js` — `srcsetReal` should
  have proxied `_rh1…` URLs with commas inside the URL part and
  clean ` 1x`/` 2x` descriptors after spaces.
- **Discord**: `(TODO §4.2)` Puppeteer to `discord.com/login`,
  screenshot, look for absence of `<iframe src*="turnstile">` or any
  Turnstile-styled modal.
- **ChatGPT** (post-fix): `node tests/chatgpt.js` *(to-be-written
  §4.4)* — assert no 404s on `cdn/assets/`, `import`s resolve, and a
  message gets a streaming reply.
- **Chosic**: `(TODO)` Puppeteer to a chosic page, assert no
  `Cannot read properties of undefined (reading 'run')` console
  error.
- **Gimkit**: `(TODO)` similar.

A new helper `tests/smoke.js` that runs all of these in CI would be a
good investment once §4.6 lands.

### Quick unit check for the inline-script doubling fix (§3.7)

```bash
SID=$(curl -s --compressed "http://localhost:8080/newsession")
curl -s --compressed -X POST "http://localhost:8080/editsession" \
  -d "id=$SID&httpProxy=" >/dev/null
curl -s --compressed "http://localhost:8080/$SID/https://chatgpt.com/" \
  -H "User-Agent: Mozilla/5.0" -o /tmp/cgpt.html
# Must print 0:
grep -c "/$SID/https://chatgpt.com/$SID/" /tmp/cgpt.html
# Must print single-prefixed `import * as route0 from …`:
grep -oE 'import [a-zA-Z* ]+from "[^"]+"' /tmp/cgpt.html | head -3
```

---

## 6. Dev-loop hot-spots

The two changes that bite hardest if you forget them:

1. **Embedded shuffler copies**: every change to
   `src/util/StrShuffler.js` must be mirrored in
   `src/client/rammerhead.js`, `public/index.html`, `public/script.js`,
   and `public/unblocker.html`. The minified copy in
   `node_modules/testcafe-hammerhead/lib/client/hammerhead.js` is
   patched at build time by `src/build.js` — verify by grepping for
   `_rh1` in the served `hammerhead.min.js` after a build.
2. **Server restart after build**: `npm run build` only regenerates
   `src/client/hammerhead.min.js`; the server still has the old
   bundle in worker memory. Always
   `pkill -f "node.*rammerhead/src/server.js" && node src/server.js &`
   after a build.

---

## 7. Known limitations (won't-fix without a redesign)

- `Object.defineProperty(window, 'location', …)` will not work in
  modern Chrome. Any site that fingerprints `location.hostname` from
  a script we don't AST-rewrite will see the proxy host. Mitigation
  is to put that site in full-AST mode (see §4.6 for automation).
- IP rate-limits from AWS WAF / Cloudflare Turnstile / hCaptcha are
  per-IP. A heavy user will trip them no matter what we do. Recommend
  a small upstream pool of IPs (out of scope for this branch).
- ~~The wrapped-cookie format
  `c|<sid>|<name>|<dom>|<path>|<exp>|<now>|<ma>` uses `now`
  (timestamp) in the cookie name~~ — **fixed in §3.15**. The `<now>`
  segment is now empty so the wrapped name is stable across
  rewrites; old cookies keep parsing because the empty slot maps to
  a max-date sentinel.
  **TODO** *(id: `cookie-name-storm`)*: drop `now` from the wrapped
  name; rely on the browser's own "later Set-Cookie wins" rule.
