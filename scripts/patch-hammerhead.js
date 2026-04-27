/**
 * Post-install patches for testcafe-hammerhead.
 *
 * These patches are idempotent: each one fingerprints the *result* of the
 * patch and skips itself if already applied. Runs from `npm postinstall`.
 *
 * Currently applied:
 *
 *   1. **null-safe destUrl** — guards an unguarded `.destUrl` access in the
 *      dynamic-import transformer that crashes when `parseProxyUrl` returns
 *      null (e.g. URL shuffling is active).
 *
 *   2. **null-safe script preprocess** — guards `code.substring` in the
 *      script preprocessor against a null `code` (upstream returned an
 *      empty body).
 *
 *   3. **stable sync-cookie name** *(new)* — drops the `lastAccessed`
 *      timestamp segment from the wrapped sync-cookie name (server-side
 *      `lib/utils/cookie.js` and the client bundles
 *      `lib/client/hammerhead.{js,min.js}`).
 *
 *      Hammerhead's wrapped cookies look like
 *        `<syncType>|<sid>|<key>|<domain>|<path>|<expires>|<lastAccessed>|<maxAge>=<value>`
 *      and `lastAccessed` was `Date.now().toString(36)` — a fresh value on
 *      every set. That makes every sync change emit a *new* cookie name
 *      instead of overwriting the existing one, so Discord/Cloudflare
 *      Turnstile/AWS-WAF/DataDome challenge flows (which `document.cookie =`
 *      dozens of times in a single solve) blow past Chrome's
 *      `~180 cookies per origin` cap. The cap is silent — once you cross
 *      it, new cookies are dropped and the upstream sees no session →
 *      cascading 401/403/`ERR_CONTENT_DECODING_FAILED`.
 *
 *      Emitting `''` in that slot keeps the format intact (the parser
 *      still requires exactly 8 `|`-separated segments). For the
 *      transition window where existing browsers still hold a pile of
 *      old-format cookies AND start receiving new-format ones, we patch
 *      the parser to substitute `new Date(8.64e15)` (= JS-max-date) for
 *      an empty `lastAccessed` segment. That guarantees the new-format
 *      cookie is always "newer" than any old-format duplicate, so
 *      `sortByOutdatedAndActual` consistently picks the new-format one
 *      as actual and emits a deletion for the old-format one. Without
 *      this, we'd risk an oscillation in worst-case browser cookie
 *      iteration order (NaN > realDate is false).
 *
 *   4. **optional-chain skip in AST transformers** *(new)* — Hammerhead's
 *      `computed-property-get` and `method-call` transformers wrap
 *      `obj[prop]` / `obj.method(args)` as `__get$(obj, prop, optional)` /
 *      `__call$(obj, 'method', args, optional)`. Both wrappers receive
 *      their property/method/args expressions as *function arguments*,
 *      which JS evaluates *before* the wrapper runs. That breaks native
 *      optional-chain short-circuiting:
 *
 *          // native: t?.messages[s.current % t.messages.length]
 *          //   when `t === undefined` returns undefined and never
 *          //   evaluates `t.messages.length`.
 *          // hammerhead-rewritten:
 *          //   __get$(t?.messages, s.current % t.messages.length, true)
 *          //   evaluates the index expression first → throws because
 *          //   `t.messages.length` reads `.length` on undefined.
 *
 *      That `TypeError: Cannot read properties of undefined (reading
 *      'messages')` was the visible Discord login-page crash. Acorn marks
 *      *every* MemberExpression downstream of a `?.` with `optional:
 *      true`, so we simply skip the transform whenever `node.optional`
 *      (or, for CallExpression, `node.callee.optional`) is set. The chain
 *      stays intact in the emitted code and the browser handles short-
 *      circuiting natively. We only lose Hammerhead instrumentation for
 *      `obj?.[…]` / `obj?.method()` patterns (rare in real code) — far
 *      better than corrupting the host page.
 *
 *   5. **TypeError in runtime _error helpers** *(new)* — Hammerhead's
 *      `__call$` and `__get$` runtime helpers throw `new Error(msg)` when
 *      a method/property is accessed on null/undefined. Native JS throws
 *      `TypeError`. Sites whose error boundaries / promise rejection
 *      handlers do `instanceof TypeError` checks (React, Poki, etc.)
 *      silently swallow native TypeErrors but treat Hammerhead's generic
 *      `Error` as an unhandled exception. Switching to `TypeError`
 *      restores native behavior with zero downside.
 *
 *   6. **null-safe owner access in __call$** *(new)* — when `optional`
 *      flag is set and `owner` is null, the original runtime evaluated
 *      `!isFunction(owner[methName])` *before* checking `optional`, so
 *      it threw on the very property access it was meant to skip. We
 *      now short-circuit to `undefined` immediately when owner is
 *      null/undefined and the call is optional, matching native
 *      `obj?.method()` semantics even on the rare paths that still
 *      reach the wrapper.
 */

const fs = require('fs');
const path = require('path');

const HH = path.join(__dirname, '..', 'node_modules', 'testcafe-hammerhead', 'lib');
let applied = 0;
let skipped = 0;

/**
 * Apply a string-replace patch.
 * @param {string} file relative to HH
 * @param {string} before the substring to find
 * @param {string} after the substring to replace it with
 * @param {string} label human-readable name
 */
function patch(file, before, after, label) {
    const filePath = path.join(HH, file);
    try {
        let src = fs.readFileSync(filePath, 'utf8');
        if (src.includes(after)) {
            console.log(`[patch-hammerhead] ${label}: already patched.`);
            skipped++;
            return true;
        }
        if (!src.includes(before)) {
            console.error(`[patch-hammerhead] ${label}: target string not found.`);
            return false;
        }
        src = src.replace(before, after);
        fs.writeFileSync(filePath, src, 'utf8');
        console.log(`[patch-hammerhead] ${label}: OK.`);
        applied++;
        return true;
    } catch (err) {
        console.error(`[patch-hammerhead] ${label}: error - ${err.message}`);
        return false;
    }
}

/**
 * Apply a regex-replace patch. Use when the target text contains
 * minifier-renamed variables that drift between hammerhead releases.
 * @param {string} file relative to HH
 * @param {RegExp} pattern must be /g and capture enough to verify uniqueness
 * @param {string} replacement standard String.replace replacement (with $1,$2)
 * @param {string} sentinel a substring guaranteed to appear in `replacement`
 *   AND nowhere in the original file — used for the idempotency check.
 * @param {string} label
 * @param {number} expectedMatches optional: assert exactly N matches before
 *   replacing. Default 1.
 */
function patchRegex(file, pattern, replacement, sentinel, label, expectedMatches = 1) {
    const filePath = path.join(HH, file);
    try {
        let src = fs.readFileSync(filePath, 'utf8');
        if (sentinel && src.includes(sentinel)) {
            console.log(`[patch-hammerhead] ${label}: already patched.`);
            skipped++;
            return true;
        }
        const matches = src.match(pattern);
        const matchCount = matches ? matches.length : 0;
        if (matchCount === 0) {
            console.error(`[patch-hammerhead] ${label}: pattern not found.`);
            return false;
        }
        if (matchCount !== expectedMatches) {
            console.error(
                `[patch-hammerhead] ${label}: expected ${expectedMatches} match(es), got ${matchCount}; refusing.`
            );
            return false;
        }
        src = src.replace(pattern, replacement);
        fs.writeFileSync(filePath, src, 'utf8');
        console.log(`[patch-hammerhead] ${label}: OK (${matchCount} match).`);
        applied++;
        return true;
    } catch (err) {
        console.error(`[patch-hammerhead] ${label}: error - ${err.message}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Patch 1: null-safe destUrl in dynamic import transformer
// ---------------------------------------------------------------------------
patch(
    'processing/script/transform.js',
    `dynamic_import_1.default.baseUrl = resolver ? (0, url_1.parseProxyUrl)(resolver('./')).destUrl : '';`,
    `dynamic_import_1.default.baseUrl = resolver ? ((0, url_1.parseProxyUrl)(resolver('./')) || {}).destUrl || '' : '';`,
    'null-safe destUrl'
);

// ---------------------------------------------------------------------------
// Patch 2: null-safe code in script preprocessor (prevents .substring crash on null body)
// ---------------------------------------------------------------------------
patch(
    'processing/script/index.js',
    `function preprocess(code) {\n    const bom`,
    `function preprocess(code) {\n    if (code == null) return { bom: null, preprocessed: '' };\n    const bom`,
    'null-safe script preprocess'
);

// ---------------------------------------------------------------------------
// Patch 3a: stable sync-cookie name — server side
// ---------------------------------------------------------------------------
// Sentinel "/* RH: stable name */" doubles as the idempotency marker for the
// format-side change.
patch(
    'utils/cookie.js',
    `const lastAccessed = cookie.lastAccessed.getTime().toString(TIME_RADIX);`,
    `const lastAccessed = ''; /* RH: stable name (was lastAccessed.toString(36)) — prevents cookie pile-up */`,
    'stable sync-cookie name (server, format)'
);

// Parser side: substitute JS-max-date for empty lastAccessed so new-format
// always beats old-format in `sortByOutdatedAndActual`.
patch(
    'utils/cookie.js',
    `lastAccessed: new Date(parseInt(parsedKey[6], TIME_RADIX)),`,
    `lastAccessed: parsedKey[6] ? new Date(parseInt(parsedKey[6], TIME_RADIX)) : new Date(8640000000000000) /* RH: stable name */,`,
    'stable sync-cookie name (server, parse)'
);

// ---------------------------------------------------------------------------
// Patch 3b: stable sync-cookie name — client unminified bundle
// ---------------------------------------------------------------------------
patch(
    'client/hammerhead.js',
    `var lastAccessed = cookie.lastAccessed.getTime().toString(TIME_RADIX);`,
    `var lastAccessed = ''; /* RH: stable name */`,
    'stable sync-cookie name (client, format)'
);
patch(
    'client/hammerhead.js',
    `lastAccessed: new Date(parseInt(parsedKey[6], TIME_RADIX)),`,
    `lastAccessed: parsedKey[6] ? new Date(parseInt(parsedKey[6], TIME_RADIX)) : new Date(8640000000000000) /* RH: stable name */,`,
    'stable sync-cookie name (client, parse)'
);

// ---------------------------------------------------------------------------
// Patch 3c: stable sync-cookie name — client minified bundle
//
// The unminified format pattern is
//   `var lastAccessed = cookie.lastAccessed.getTime().toString(TIME_RADIX)`
// but the minifier renames the variable on the LHS and the `cookie` on the
// RHS to single letters (and `TIME_RADIX` to something like `Qm`). We anchor
// on the only stable text in the expression — `.lastAccessed.getTime().toString(`
// — and rewrite the entire assignment to `<lhsname>=""`.
//
// The same idea applies to the parse side, where the unminified is
//   `lastAccessed: new Date(parseInt(parsedKey[6], TIME_RADIX))`
// and the minified looks like
//   `lastAccessed:new Date(parseInt(o[6],Qm))`
// We capture the array variable (`o`) and the radix variable (`Qm`) and
// emit a ternary that falls back to `new Date(864e13)` when the segment
// is empty.
//
// Each pattern matches once in hammerhead 31.x.
// ---------------------------------------------------------------------------
patchRegex(
    'client/hammerhead.min.js',
    /([a-zA-Z_$][\w$]*)=[a-zA-Z_$][\w$]*\.lastAccessed\.getTime\(\)\.toString\([a-zA-Z_$][\w$]*\)/g,
    '$1=""/* RH: stable name */',
    '/* RH: stable name */',
    'stable sync-cookie name (client.min, format)'
);

patchRegex(
    'client/hammerhead.min.js',
    /lastAccessed:new Date\(parseInt\(([a-zA-Z_$][\w$]*)\[6\],([a-zA-Z_$][\w$]*)\)\)/g,
    'lastAccessed:$1[6]?new Date(parseInt($1[6],$2)):new Date(864e13)/* RH: stable parse */',
    '/* RH: stable parse */',
    'stable sync-cookie name (client.min, parse)'
);

// ---------------------------------------------------------------------------
// Patch 4a: optional-chain skip in computed-property-get (server transformer)
// ---------------------------------------------------------------------------
patch(
    'processing/script/transformers/computed-property-get.js',
    `    condition: (node, parent) => {
        if (!node.computed || !parent)
            return false;
        if (node.property.type === esotope_hammerhead_1.Syntax.Literal && !(0, instrumented_1.shouldInstrumentProperty)(node.property.value))
            return false;`,
    `    condition: (node, parent) => {
        if (!node.computed || !parent)
            return false;
        /* RH: skip optional-chain access — args are evaluated eagerly which breaks short-circuit */
        if (node.optional)
            return false;
        if (node.property.type === esotope_hammerhead_1.Syntax.Literal && !(0, instrumented_1.shouldInstrumentProperty)(node.property.value))
            return false;`,
    'optional-chain skip (computed-property-get, server)'
);

// ---------------------------------------------------------------------------
// Patch 4b: optional-chain skip in method-call (server transformer)
// ---------------------------------------------------------------------------
patch(
    'processing/script/transformers/method-call.js',
    `    condition: node => {
        const callee = node.callee;
        if (callee.type === esotope_hammerhead_1.Syntax.MemberExpression) {
            // Skip: super.meth()
            if (callee.object.type === esotope_hammerhead_1.Syntax.Super)
                return false;
            if (callee.computed)`,
    `    condition: node => {
        const callee = node.callee;
        if (callee.type === esotope_hammerhead_1.Syntax.MemberExpression) {
            // Skip: super.meth()
            if (callee.object.type === esotope_hammerhead_1.Syntax.Super)
                return false;
            /* RH: skip optional-chain call — args are evaluated eagerly which breaks short-circuit */
            if (node.optional || callee.optional)
                return false;
            if (callee.computed)`,
    'optional-chain skip (method-call, server)'
);

// ---------------------------------------------------------------------------
// Patch 4c: optional-chain skip in unminified client bundle
// ---------------------------------------------------------------------------
patch(
    'client/hammerhead.js',
    `    name: 'computed-property-get',
	    nodeReplacementRequireTransform: true,
	    nodeTypes: Syntax_1.MemberExpression,
	    condition: function (node, parent) {
	        if (!node.computed || !parent)
	            return false;
	        if (node.property.type === Syntax_1.Literal && !shouldInstrumentProperty(node.property.value))
	            return false;`,
    `    name: 'computed-property-get',
	    nodeReplacementRequireTransform: true,
	    nodeTypes: Syntax_1.MemberExpression,
	    condition: function (node, parent) {
	        if (!node.computed || !parent)
	            return false;
	        /* RH: skip optional-chain access — args are evaluated eagerly which breaks short-circuit */
	        if (node.optional)
	            return false;
	        if (node.property.type === Syntax_1.Literal && !shouldInstrumentProperty(node.property.value))
	            return false;`,
    'optional-chain skip (computed-property-get, client)'
);

patch(
    'client/hammerhead.js',
    `    name: 'method-call',
	    nodeReplacementRequireTransform: true,
	    nodeTypes: Syntax_1.CallExpression,
	    condition: function (node) {
	        var callee = node.callee;
	        if (callee.type === Syntax_1.MemberExpression) {
	            // Skip: super.meth()
	            if (callee.object.type === Syntax_1.Super)
	                return false;
	            if (callee.computed)`,
    `    name: 'method-call',
	    nodeReplacementRequireTransform: true,
	    nodeTypes: Syntax_1.CallExpression,
	    condition: function (node) {
	        var callee = node.callee;
	        if (callee.type === Syntax_1.MemberExpression) {
	            // Skip: super.meth()
	            if (callee.object.type === Syntax_1.Super)
	                return false;
	            /* RH: skip optional-chain call — args are evaluated eagerly which breaks short-circuit */
	            if (node.optional || callee.optional)
	                return false;
	            if (callee.computed)`,
    'optional-chain skip (method-call, client)'
);

// ---------------------------------------------------------------------------
// Patch 4d: optional-chain skip in minified client bundle
//
// Anchor on the unique `name:"computed-property-get"` / `name:"method-call"`
// strings; the surrounding identifier names (Iu, Fo, Zu, …) drift between
// minifier runs but those literals do not.
// ---------------------------------------------------------------------------
patchRegex(
    'client/hammerhead.min.js',
    /(\{name:"computed-property-get",[^}]*?condition:function\(e,t\)\{return!\(!e\.computed\|\|!t)\)/g,
    '$1||e.optional)/*RH:cpg-skip-optional*/',
    '/*RH:cpg-skip-optional*/',
    'optional-chain skip (computed-property-get, client.min)'
);

patchRegex(
    'client/hammerhead.min.js',
    /(\{name:"method-call",[^}]*?condition:function\(e\)\{var t=e\.callee;return t\.type===[a-zA-Z_$][\w$]*\.MemberExpression&&\(t\.object\.type!==[a-zA-Z_$][\w$]*\.Super)/g,
    '$1&&!e.optional&&!t.optional/*RH:mc-skip-optional*/',
    '/*RH:mc-skip-optional*/',
    'optional-chain skip (method-call, client.min)'
);

// ---------------------------------------------------------------------------
// Patch 5a: TypeError in unminified runtime _error helpers
// ---------------------------------------------------------------------------
patch(
    'client/hammerhead.js',
    `    PropertyAccessorsInstrumentation._error = function (msg) {
	        throw new Error(msg);
	    };`,
    `    PropertyAccessorsInstrumentation._error = function (msg) {
	        /* RH: throw TypeError to match native (sites often catch instanceof TypeError) */
	        throw new TypeError(msg);
	    };`,
    'TypeError _error (PropertyAccessors, client)'
);

patch(
    'client/hammerhead.js',
    `    MethodCallInstrumentation._error = function (msg) {
	        throw new Error(msg);
	    };`,
    `    MethodCallInstrumentation._error = function (msg) {
	        /* RH: throw TypeError to match native (sites often catch instanceof TypeError) */
	        throw new TypeError(msg);
	    };`,
    'TypeError _error (MethodCall, client)'
);

// ---------------------------------------------------------------------------
// Patch 5b: TypeError in minified runtime _error helpers (both instances)
// ---------------------------------------------------------------------------
patchRegex(
    'client/hammerhead.min.js',
    /([a-zA-Z_$][\w$]*\._error=function\(e\)\{throw new )Error(\(e\)\})/g,
    '$1TypeError$2/*RH:typeerror*/',
    '/*RH:typeerror*/',
    'TypeError _error (client.min, both helpers)',
    2
);

// ---------------------------------------------------------------------------
// Patch 6: null-safe owner access in unminified __call$ runtime
// (rebuild the prelude so `owner[methName]` is never read when owner is
//  null/undefined; matches native `obj?.method()` short-circuit on the few
//  paths that still reach the wrapper after Patch 4.)
// ---------------------------------------------------------------------------
patch(
    'client/hammerhead.js',
    `	            value: function (owner, methName, args, optional) {
	                if (optional === void 0) { optional = false; }
	                if (isNullOrUndefined(owner) && !optional)
	                    MethodCallInstrumentation._error("Cannot call method '".concat(methName, "' of ").concat(inaccessibleTypeToStr(owner)));
	                if (!isFunction(owner[methName]) && !optional)
	                    MethodCallInstrumentation._error("'".concat(methName, "' is not a function"));`,
    `	            value: function (owner, methName, args, optional) {
	                if (optional === void 0) { optional = false; }
	                /* RH: short-circuit null receiver before any owner[methName] access (optional chain) */
	                if (isNullOrUndefined(owner)) {
	                    if (!optional)
	                        MethodCallInstrumentation._error("Cannot call method '".concat(methName, "' of ").concat(inaccessibleTypeToStr(owner)));
	                    return void 0;
	                }
	                if (!isFunction(owner[methName]) && !optional)
	                    MethodCallInstrumentation._error("'".concat(methName, "' is not a function"));`,
    'null-safe owner in __call$ (client)'
);

const total = applied + skipped;
if (total === 0) {
    console.error('[patch-hammerhead] No patches applied! Check hammerhead version.');
    process.exit(1);
}
console.log(`[patch-hammerhead] Patching done (${applied} applied, ${skipped} already present).`);

// ---------------------------------------------------------------------------
// IMPORTANT: rebuild the client bundles after patching.
//
// The proxy does NOT serve `node_modules/testcafe-hammerhead/lib/client/hammerhead.{js,min.js}`
// directly. `src/build.js` reads those files, applies extra string-substitution
// fixes (top-frame proxying, srcset parser, Kasada/postMessage workarounds,
// etc.) and writes the result into `src/client/hammerhead.{js,min.js}`. The
// served `/_a/c.js` is the minified copy in `src/client/`. So patching the
// node_modules copy is invisible to browsers until we re-run the build.
//
// We do it inline here (instead of as a separate `&&` in package.json) so:
//   - `npm install` (which runs `postinstall: patch-hammerhead.js`) leaves the
//     repo in a runnable state with patches actually live.
//   - Re-running `node scripts/patch-hammerhead.js` manually also keeps the
//     served bundle in sync, no second command needed.
//
// We require() src/build.js (rather than spawning `npm run build`) to avoid
// depending on npm being on PATH inside the postinstall sandbox.
// ---------------------------------------------------------------------------
try {
    if (process.env.RH_SKIP_BUILD === '1') {
        console.log('[patch-hammerhead] RH_SKIP_BUILD=1 set; skipping client rebuild.');
    } else {
        const buildPath = path.join(__dirname, '..', 'src', 'build.js');
        if (!fs.existsSync(buildPath)) {
            console.warn('[patch-hammerhead] src/build.js not found; skipping rebuild.');
        } else {
            console.log('[patch-hammerhead] Rebuilding src/client/* bundles to propagate patches…');
            require(buildPath);
            console.log('[patch-hammerhead] Client bundles rebuilt.');
        }
    }
} catch (err) {
    // Don't fail the install — patches in node_modules are still applied,
    // and the user can manually re-run `npm run build` if the rebuild here
    // fails for environment-specific reasons.
    console.error(`[patch-hammerhead] Client rebuild failed (run \`npm run build\` manually): ${err && err.stack || err}`);
}
