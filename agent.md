# StudyBoard Gateway — Task Log

## 1. TikTok Client-Side Errors

### `ReferenceError: process is not defined`
- **Status:** Fixed.
- **Root cause:** Earlier polyfill assigned `window.process`, which fails in
  Web Worker / SharedWorker / module scopes (`window` is undefined there) and
  doesn't survive bundlers that read `process` as a bare identifier through
  the lexical chain in strict modules.
- **Fix:**
  - New `POLYFILL_SCRIPT` (in `src/util/patchPageProcessing.js`) installs
    `globalThis.process` and a forgiving `atob` wrapper. It runs FIRST in every
    injection bundle (`INJECT_PROD_*` / `INJECT_DEV_*`).
  - New `PROCESS_POLYFILL` (in `src/util/patchScriptProcessing.js`) is
    prepended via `headerModule.add` to EVERY Hammerhead-rewritten script
    (AST mode + lite mode), so workers + main-thread + module contexts all
    see a populated `process` object.
  - The bridge script (`_liteProcess`) and inline-script rewriter both use
    the same `globalThis`-based polyfill.

### `Uncaught SyntaxError: Unexpected token '<'` (at `core.js:1:1`)
- **Status:** Fixed.
- **Root cause:** Upstream returns HTML (CDN/WAF error page, captcha
  challenge) for a `<script src=...>` request. Hammerhead's AST rewriter
  either failed silently or produced garbage; the browser then tried to
  parse `<!doctype html>` as JavaScript.
- **Fix:**
  - `scriptProcessor.processResource` (in `src/util/patchScriptProcessing.js`)
    now does a pre-flight HTML sniff and returns a `console.error(...)` stub
    instead of feeding HTML to the rewriter.
  - `process` in `src/util/patchAsyncResourceProcessor.js` does the same
    detection for the case where Hammerhead's content-type heuristic
    BYPASSES script processing entirely (response advertised as `text/html`).
    It also overrides the response `content-type` back to JS so the browser
    interprets the stub correctly.
  - `pipelineUtils.error` in `src/util/patchHammerheadErrorResponses.js`
    already returns `application/javascript` for script-typed errors.

### `TypeError: Cannot read properties of undefined (reading 'indexOf')`
- **Status:** Fixed.
- **Root cause:** `_isAlreadyProxied(undefined)` and lite-rewrite regex
  callbacks called `.indexOf` on `undefined` capture groups.
- **Fix:** Defensive `p && typeof p === 'string'` guards added in
  `src/util/patchScriptProcessing.js` and `src/util/patchPageProcessing.js`.
  All other `indexOf` call sites in the repo were audited and already have
  string-type guards or operate on known-string values.

### `InvalidCharacterError: Failed to execute 'atob' on 'Window'`
- **Status:** Fixed.
- **Root cause:** Sites (TikTok, several ad networks) call `atob()` on
  payloads whose URL-encoding flipped `+` → ` ` in transit, or pass invalid
  characters that the native parser rejects.
- **Fix:** The polyfill replaces `globalThis.atob` with a wrapper that
  - first calls native `atob`,
  - on `InvalidCharacterError`, strips all non-base64 chars and pads to a
    length divisible by 4,
  - retries; on hard failure returns `""` instead of throwing.
  Idempotent (`__sb_patched` marker).

### `XHR failed loading` / `Fetch failed loading`
- **Status:** Substantially mitigated.
- **Analysis:** Most reports trace back to (a) script tags whose response
  was HTML — fixed by the `Unexpected token '<'` work above, (b) requests
  to expired sessions — already covered by `respond404` / `respond500`
  patches that emit themed pages, (c) genuine WAF blocks — unchanged but
  no longer crash the page because the polyfill keeps `process`/`atob`
  alive even if other inline scripts throw.

## 2. General Unresponsiveness (Gemini, YouTube)
- **Status:** Fixed.
- **Fix:**
  - `handlePageError` in `src/classes/StudyBoardSession.js` is now
    re-entrancy-safe (`_sb_handled` marker), HTML-escapes the upstream
    error message, sets `cache-control: no-store`, and ALWAYS calls
    `res.end()` so requests can never hang.
  - The earlier `BUILTIN_LITE_HOSTS` Google/YouTube additions were already
    reverted (their full Hammerhead AST rewriting works correctly without
    lite mode).

## 3. Testing
- All edited modules pass `node --check` and load via `require()` without
  runtime errors.
- The polyfill code was independently `eval`'d to confirm:
  - `process` becomes a fully populated object,
  - `atob('valid!!!')` returns `''` (no throw),
  - `atob('aGVsbG8=')` correctly returns `"hello"`.
- Server boots cleanly under `npm start`; `/health` returns HTTP 200.

## 4. Files Changed
- `src/util/patchPageProcessing.js` — new POLYFILL_SCRIPT, integrated into
  inject bundle (first), updated bridge + inline-script polyfills to
  globalThis.
- `src/util/patchScriptProcessing.js` — new PROCESS_POLYFILL constant,
  injected via `headerModule.add` for ALL rewritten scripts; HTML sniffing
  pre-flight in `scriptProcessor.processResource`.
- `src/util/patchAsyncResourceProcessor.js` — defensive HTML→JS stub when
  Hammerhead skips script processing for a script-typed request.
- `src/classes/StudyBoardSession.js` — hardened `handlePageError`
  (re-entrancy guard, HTML-escaped output, always-end semantics).
