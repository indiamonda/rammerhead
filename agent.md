# StudyBoard Gateway - Remaining Tasks

## 1. TikTok Client-Side Errors

### `ReferenceError: process is not defined`
- **Status:** Attempted fix.
- **Action Taken:** Added a polyfill for `window.process` in `src/util/patchScriptProcessing.js` (`_liteRewriteJs`) and `src/util/patchPageProcessing.js` (`_liteProcess` inline scripts and bridge script).
- **Next Steps:** Need to verify if the polyfill is correctly applied and if it resolves the error on TikTok. If it still fails, we might need to check if Hammerhead's AST rewriter is stripping it or if it needs to be injected differently.

### `Uncaught SyntaxError: Unexpected token '<'` (at `core.js:1:1`)
- **Status:** Pending investigation.
- **Analysis:** This usually means a JavaScript file (like `core.js`) failed to load and the proxy returned an HTML error page (like a 404 or 500 page) instead of JS, which the browser then tried to parse as script.
- **Next Steps:**
    - Check why `core.js` is failing to load (is it a 404? 500?).
    - Verify if `patchHammerheadErrorResponses.js` is correctly identifying these requests as scripts and returning `application/javascript` instead of HTML. The patch checks `ctx.dest.isScript`, but maybe for some dynamic imports or prefetch requests, this flag isn't set correctly.

### `TypeError: Cannot read properties of undefined (reading 'indexOf')`
- **Status:** Attempted fix.
- **Action Taken:** Found a potential cause in `src/util/patchScriptProcessing.js` (`_liteRewriteJs`) and `src/util/patchPageProcessing.js` (`_isAlreadyProxied`) where `indexOf` was called on a variable that might be undefined. Added `if (p && typeof p === 'string')` checks.
- **Next Steps:** Verify if this resolves the error. If not, the error might be originating from TikTok's own code due to some other proxy-induced data corruption.

### `InvalidCharacterError: Failed to execute 'atob' on 'Window': The string to be decoded is not correctly encoded.`
- **Status:** Pending investigation.
- **Analysis:** TikTok's code is calling `atob()` on a string that is not valid base64. This could happen if the proxy modified a base64 string (e.g., by shuffling a URL inside it) or if a network request failed and returned an error message instead of the expected base64 data.
- **Next Steps:** Need to trace where `atob` is called and what data it's trying to decode.

### `XHR failed loading` / `Fetch failed loading`
- **Status:** Pending investigation.
- **Analysis:** These are generic network errors. They could be caused by 404s, 403s (WAF blocks), 500s (proxy errors), or CORS issues.
- **Next Steps:** Look at the specific URLs failing. Are they shuffled correctly? Are they being blocked by a WAF? Are they hitting the `handlePageError` fallback?

## 2. General Unresponsiveness (Gemini, YouTube)
- **Status:** Attempted fix.
- **Action Taken:** Reverted the addition of Google/YouTube domains to `BUILTIN_LITE_HOSTS`. Fixed `handlePageError` in `StudyBoardSession.js` to prevent requests from hanging indefinitely on error.
- **Next Steps:** Verify if Gemini and YouTube are now responsive after the initial load.

## 3. Testing and Deployment
- **Status:** Pending.
- **Next Steps:**
    - Run the proxy locally and test TikTok, Gemini, and YouTube thoroughly.
    - Check the browser console for any remaining errors.
    - If everything works locally, deploy to Fly.io and verify in the production environment.
