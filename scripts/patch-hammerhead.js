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

// ---------------------------------------------------------------------------
// Patch 7: brand-strip hammerhead's serialized magic strings.
//
// The proxied page surface leaks the word "hammerhead" in several places that
// content scanners (Lightspeed Smart Agent, Lightspeed Web Filter, GoGuardian,
// Smoothwall, Securly, etc.) string-grep:
//
//   • `window["%hammerhead%"]`    — accessed by 2× `<script class="self-removing-script-…">`
//                                   blocks injected on every proxied page.
//   • `window["%is-hammerhead%"]` — set in our own injectHammerhead client wrap.
//   • `/*hammerhead|stylesheet|start*/` and `…|end*/` — wrapped around every
//                                   processed `<style>` block.
//   • `…-hammerhead-stored-value` — attribute postfix used to mirror original
//                                    URL/source-attr values.
//   • `data-hammerhead-hovered`, `data-hammerhead-focused` — pseudo-class
//                                    proxies left in CSS rules.
//   • `hammerhead|<X>` — internal property keys stored on the global object.
//   • `hammerhead|storage-wrapper|` — virtualised localStorage prefix.
//
// Each of these is a single-pattern string-grep target. We rebrand all of
// them to neutral identifiers ("_d…") so the proxied bytes contain zero
// occurrences of the literal word "hammerhead". Both the server-side
// serializers AND the client bundle (which reads these keys back) must use
// the SAME new value, so we patch every file that references them in a
// single sweep.
//
// This is purely a string substitution at install time; semantics are
// unchanged because the strings are only used as opaque keys/markers.
// ---------------------------------------------------------------------------
const BRAND_REPLACEMENTS = [
    // ---------------------------------------------------------------
    // SECTION 1 — multi-word string markers.
    // ---------------------------------------------------------------
    // CSS processing markers wrapped around every processed <style> block.
    ['/*hammerhead|stylesheet|start*/', '/*_d|css|s*/'],
    ['/*hammerhead|stylesheet|end*/', '/*_d|css|e*/'],
    // Script-processing markers wrapped around every processed <script>.
    // header.js exports these literal strings AND derives HEADER_RE from
    // them, so as long as we rename the source/target literal in the
    // exact same string, both add() and remove() stay consistent.
    // We rebrand these three ahead of the catch-all `hammerhead|` rule
    // so the resulting markers are SHORT and look like generic comments
    // (no `script` word), reducing fingerprint surface.
    ['/*hammerhead|script|processing-header-end*/', '/*_a|h*/'],
    ['/*hammerhead|script|start*/', '/*_a|s*/'],
    ['/*hammerhead|script|end*/', '/*_a|e*/'],
    // Embedded `hammerhead-` substring inside an internal event name.
    ['eval-hammerhead-script', 'eval-_d-script'],
    // document.write begin/end markers (visible in DOM during streaming writes).
    ['hammerhead_write_marker_begin', '_d_wmb'],
    ['hammerhead_write_marker_end', '_d_wme'],
    // ---------------------------------------------------------------
    // SECTION 2 — generic `hammerhead|<something>` internal-property keys.
    // `|` is invalid in JS identifiers, so any literal `hammerhead|` is
    // necessarily inside a string. Safe to rebrand wholesale.
    // ---------------------------------------------------------------
    ['hammerhead|', '_d|'],
    // ---------------------------------------------------------------
    // SECTION 3 — magic window properties + DOM attribute postfixes +
    // pseudo-class proxies + storage virtualization keys.
    // ---------------------------------------------------------------
    ['data-hammerhead-hovered', 'data-_d-hov'],
    ['data-hammerhead-focused', 'data-_d-foc'],
    ['-hammerhead-stored-value', '-_d-sv'],
    ['%is-hammerhead%', '%_isd%'],
    ['%hammerhead%', '%_d%'],
    // ---------------------------------------------------------------
    // SECTION 4 — DEEPER REBRAND
    //
    // The above renames remove every `hammerhead|...` and `%hammerhead%`
    // marker from the bundle, but leave a long tail of identifier-name
    // and string-literal occurrences that survive Uglify minification:
    //
    //   • `INTERNAL_PROPS.hammerhead` — the magic-key indirection used to
    //     access `window['%_d%']`. Property name → not minified.
    //   • `parentHammerhead`, `var hammerhead = window["..."]` — local
    //     variables INSIDE template strings that get serialized into
    //     injected <script> tags on every iframe init / window recreate
    //     event. Strings → not minified.
    //   • `_waitHammerheadSettings`, `waitHammerheadSettings`,
    //     `EVAL_HAMMERHEAD_SCRIPT_EVENT`, `isHammerheadAttr`,
    //     `topSameDomainHammerhead` — instance fields / object keys.
    //     Property names → not minified.
    //   • `sourceURL=hammerhead.js` — DevTools sourceURL pragma in the
    //     iframe-eval string.
    //   • `testcafe-hammerhead:` — console.warn message prefix.
    //
    // Each below is a single, atomic, idempotent string substitution.
    // The replacements do NOT collide because:
    //   1) Property-name renames use the full `<obj>.hammerhead` form,
    //      not the bare keyword, so `hammerhead:` (the key definition)
    //      and `<id>.hammerhead` (the access) are separate patterns.
    //   2) Identifier renames use UNIQUE identifier strings
    //      (parentHammerhead etc.) — they never collide with each other
    //      or with substrings of other patterns.
    //   3) String-literal renames use distinctive long substrings.
    //
    // Order is significant only when one `from` is a substring of another
    // `from`. We guard that by listing more-specific patterns FIRST.
    // ---------------------------------------------------------------
    // 4a) INTERNAL_PROPS.hammerhead — access pattern (most specific first).
    ['INTERNAL_PROPS.hammerhead', 'INTERNAL_PROPS.h0'],
    ['internal_properties_1.default.hammerhead', 'internal_properties_1.default.h0'],
    ['internalProperties.hammerhead', 'internalProperties.h0'],
    // 4b) INTERNAL_PROPS.hammerhead — KEY definition.
    [`hammerhead: '%_d%'`, `h0: '%_d%'`],
    [`hammerhead:"%_d%"`, `h0:"%_d%"`],
    // 4c) Hammerhead-named local variables INSIDE injected <script> templates.
    // Picked unique substrings so we don't accidentally match `var hammerhead`
    // outside a template (the only other source line is `var hammerhead =
    // new Hammerhead();` which Uglify renames anyway, but keeping the rename
    // there is a no-op).
    ['var hammerhead = window[', 'var h_ = window['],
    ['hammerhead && hammerhead.sandbox', 'h_ && h_.sandbox'],
    ['parentHammerhead', 'pH'],
    // 4d) Class-instance / object property names that survive minification.
    ['_waitHammerheadSettings', '_waitS'],
    ['waitHammerheadSettings', 'waitS'],
    ['EVAL_HAMMERHEAD_SCRIPT_EVENT', 'EVAL_S_E'],
    ['isHammerheadAttr', 'isHA'],
    ['topSameDomainHammerhead', 'tSDX'],
    // 4e) String-literal contents.
    ['sourceURL=hammerhead.js', 'sourceURL=app.js'],
    ['testcafe-hammerhead:', 'app:'],
    // ---------------------------------------------------------------
    // SECTION 5 — `proxy` plain-text leaks (CONSERVATIVE).
    //
    // We tried renaming the full proxy-keyword set across hammerhead's
    // entire call-graph and broke the runtime: the AST-rewriter emits
    // calls to `__get$ProxyUrl` etc. in the rewritten user code, and a
    // global rename of those symbols decoupled the rewriter from the
    // runtime helpers, so every script-rewritten page hung on first
    // URL access.
    //
    // Stick to renames that are SAFE to do:
    //   • ServeR-side error messages that go on the wire as response
    //     bodies (don't affect any code paths).
    //   • Internal class methods / marker strings that are set+read
    //     inside the same client bundle and never crossed by an
    //     AST-rewritten user script (which keeps the keyword `proxy`
    //     on the source side).
    //
    // The rest of the rewriting happens at SERVE TIME via
    // `src/util/brandStrip.js`, which only touches the bytes on the
    // wire and never alters the on-disk node_modules files. That keeps
    // hammerhead's call-graph intact and still drops the visible
    // keyword count in the bundles browsers download.
    // ---------------------------------------------------------------
    // server-side error messages that surface in HTTP response bodies.
    ['Session is not opened in proxy', 'Session is not opened'],
];

const BRAND_FILES = [
    // server-side
    'processing/style.js',
    // header.js holds /*hammerhead|script|start*/ , /*hammerhead|script|end*/
    // and /*hammerhead|script|processing-header-end*/ — these wrap EVERY
    // script the proxy injects and were the most visible brand leak in the
    // proxied response body (visible to keyword filters and to anyone
    // viewing source). The regex constants HEADER_RE / PROCESSING_END_COMMENT_RE
    // are derived from the same string literals so renaming them keeps
    // remove() / add() functioning unchanged.
    'processing/script/header.js',
    // session/command.js — internal `hammerhead|command|*` markers used by
    // the SERVICE-FRAME postMessage protocol (cookie sync, file upload).
    // Visible in iframe service routes and stringified messages.
    'session/command.js',
    // processing/dom/index.js — `hammerhead|element-processed` and
    // `hammerhead|autocomplete-attribute-absence-marker` are stamped on
    // every processed DOM element / attribute.
    'processing/dom/index.js',
    'processing/dom/internal-attributes.js',
    'processing/dom/internal-properties.js',
    'utils/get-storage-key.js',
    'utils/self-removing-scripts.js',
    'proxy/index.js',
    'session/injectables.js',
    // SESSION_IS_NOT_OPENED_ERR & related response-body strings live here
    'session/index.js',
    'processing/dom/index.js',
    // client mustache (re-served as task.js with the new path)
    'client/task.js.mustache',
    // unminified client bundles (consumed by src/build.js)
    'client/hammerhead.js',
    'client/worker-hammerhead.js',
    'client/transport-worker.js',
    // minified bundles too, in case anything reads them directly during
    // testing or fallback paths
    'client/hammerhead.min.js',
    'client/worker-hammerhead.min.js',
    'client/transport-worker.min.js',
];

function applyBrandReplacements() {
    let totalReplacements = 0;
    let filesPatched = 0;
    let filesAlreadyClean = 0;
    for (const rel of BRAND_FILES) {
        const filePath = path.join(HH, rel);
        if (!fs.existsSync(filePath)) continue;
        let src = fs.readFileSync(filePath, 'utf8');
        let fileChanged = 0;
        for (const [from, to] of BRAND_REPLACEMENTS) {
            if (!src.includes(from)) continue;
            const before = src.length;
            src = src.split(from).join(to);
            const replaced = (before - src.length) / Math.max(1, from.length - to.length);
            fileChanged += Math.max(1, Math.round(replaced));
        }
        if (fileChanged > 0) {
            fs.writeFileSync(filePath, src, 'utf8');
            console.log(`[patch-hammerhead] brand-strip: ${rel} (${fileChanged} replacement${fileChanged === 1 ? '' : 's'}).`);
            applied++;
            filesPatched++;
            totalReplacements += fileChanged;
        } else {
            filesAlreadyClean++;
        }
    }
    if (filesPatched === 0) {
        console.log(`[patch-hammerhead] brand-strip: all ${filesAlreadyClean} target files already clean.`);
        skipped++;
    } else {
        console.log(`[patch-hammerhead] brand-strip done (${filesPatched} files, ${totalReplacements} total).`);
    }
}
applyBrandReplacements();

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
