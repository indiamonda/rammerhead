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

const total = applied + skipped;
if (total === 0) {
    console.error('[patch-hammerhead] No patches applied! Check hammerhead version.');
    process.exit(1);
}
console.log(`[patch-hammerhead] Done (${applied} applied, ${skipped} already present).`);
