# Deep audit: bugs found and fixes applied

Audit focused on douyin.com / bilibili.com / task.js 500, session warm-up, URL shuffling, and pipeline order. All fixes below have been applied in code.

---

## Critical (would cause task.js 500 or wrong behavior)

### 1. **injectBrowserLikeHeaders overwrote Referer for task.js**
- **Bug:** For `GET /task.js`, `injectBrowserLikeHeaders` runs after task.js warm-up and replaces `Referer` with the destination origin (e.g. `https://www.douyin.com/`). By the time the request reaches hammerhead and our `_onTaskScriptRequest`, the proxy URL (with session id) is gone, so we couldn’t warm the session or unshuffle, and hammerhead could 500 on a bad/missing referer.
- **Fix:** In `src/util/browserLikeHeaders.js`, at the start of `injectBrowserLikeHeaders`, if the request path (decoded) is `/task.js`, return immediately and do not modify Referer/Origin.

### 2. **task.js path not decoded in pipeline**
- **Bug:** If the request URL was percent-encoded (e.g. `/task%2ejs`), the task.js warm-up used `pathname === '/task.js'` and would never match, so the session was not warmed for that request.
- **Fix:** In `src/server/setupPipeline.js`, decode the pathname with `decodeURIComponent` in a try/catch before comparing to `'/task.js'`.

### 3. **toProxyUrl could throw when `this.session` is null**
- **Bug:** `toProxyUrl` used `this.session.shuffleDict` without checking `this.session`. If the context had no session, this would throw and break the pipeline.
- **Fix:** In `src/util/addUrlShuffling.js`, guard with `if (!this.session || !this.session.shuffleDict || disableShuffling) return proxyUrl;`.

---

## Important (robustness and edge cases)

### 4. **Referer as array**
- **Bug:** In Node, duplicate headers can make `req.headers['referer']` an array. `getSessionId(array)` and `replaceUrl(array, ...)` would get the wrong type and break session lookup / unshuffle.
- **Fix:** In `addUrlShuffling.js`, in both `dispatch` and `_onTaskScriptRequest`, if the referer header is an array, use the first element before decoding and passing to `getSessionId` / `replaceUrl`.

### 5. **styles.css handler could throw or use bad path**
- **Bug:** `req.url.split('?')[0]` throws if `req.url` is undefined. If `config.publicDir` is null, `path.join(null, 'style.css')` is brittle.
- **Fix:** In `src/server/setupPipeline.js`, add `if (!req.url) return false;` at the start of the styles handler, and `if (!config.publicDir) return false;` so we don’t serve styles when publicDir is disabled.

---

## Already correct (verified)

- **Pipeline order:** Task.js warm-up is added with `beginning=true` and runs before `injectBrowserLikeHeaders`, so the session is warmed from the real referer before any header overwrite. The critical fix was to avoid overwriting that referer in the first place.
- **SessionStore.get vs addSerializedSession:** Warm-up uses `sessionStore.get(sessionId)` (which loads and caches), then `addSerializedSession`. The session remains in `cachedSessions`, so later `openSessions.get(sessionId)` in dispatch / task.js sees it.
- **replaceUrl when URL doesn’t match:** If the URL doesn’t match the regex (e.g. `/task.js` with no session segment), `replace` leaves the string unchanged; no incorrect shuffle/unshuffle.
- **getSessionId:** Handles undefined (treats as `''`), and the two regexes correctly extract the 32-char hex from path or full URL.
- **Fallback in loadTabContent:** When getproxiedurl fails, the fallback uses unshuffled URL; dispatch still finds the session and unshuffle is a no-op for non-`_rhs` URLs, so behavior remains correct.

---

## Remaining risks (not changed)

- **Hammerhead internals:** The 500 for task.js could still originate inside testcafe-hammerhead (e.g. when it parses the request or referer). Our changes ensure the referer is either unshuffled or removed when the session is missing, and we don’t overwrite it for `/task.js`; if the 500 persists, the next step is to add logging or inspect hammerhead’s task-script handler.
- **Sticky session / workers:** For multi-worker setups, task.js is hashed by session id from the referer (sticky options), so it should hit the same worker as the document; if the referer is ever wrong or missing, session affinity can’t help.
- **stripClientHeaders:** If `config.stripClientHeaders` were ever non-array, the `for...of` loop would throw; config currently sets it to `[]`, so left as-is.

---

## Files modified

| File | Changes |
|------|--------|
| `src/util/browserLikeHeaders.js` | Skip Referer/Origin overwrite when path is `/task.js` (with decoded pathname check). |
| `src/server/setupPipeline.js` | Decode pathname for task.js warm-up; add `req.url` and `config.publicDir` guards in styles handler. |
| `src/util/addUrlShuffling.js` | Guard `this.session` in `toProxyUrl`; handle array referer in `dispatch` and `_onTaskScriptRequest`. |

All changes are backward-compatible and defensive; no intentional behavior change beyond fixing the bugs above.
