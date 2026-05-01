/**
 * Outbound JavaScript brand stripper.
 *
 * Every JS bundle this server emits — hammerhead.min.js, transport-worker,
 * worker-hammerhead, studyboard.min.js, devtools, and the per-session task
 * scripts (/_a/t.js, /_a/i.js) — gets passed through `apply()` before going
 * to the wire. The function does a fixed table of literal-string substitutions
 * so identifiers and embedded marker strings that contain "proxy", "Proxy",
 * "hammerhead", or "testcafe" get rewritten to neutral, learning-platform-
 * themed equivalents.
 *
 * The substitutions are chosen to be self-consistent: every name that the
 * client bundle defines and reads is renamed to the same new name, every
 * name that the server emits into a task script is renamed to the same new
 * name, and any name that our own code (src/util/*, public/*) references
 * via `hammerhead.utils.url.parseProxyUrl` is also rewritten in lockstep
 * (see the `update our source` step done at the same time as this file
 * lands).
 *
 * IMPORTANT: this is a pure string-substitute pass. It MUST run on the JS
 * source after minification (so identifiers are stable) and BEFORE the
 * bytes go on the wire. The result is cached per-bundle, so the cost is
 * paid once per process lifetime per bundle.
 *
 * Order matters: longer keys must be replaced before any shorter key that
 * is a substring of them, otherwise the second replacement chews into the
 * already-rewritten string. The list below is sorted longest-first.
 */
'use strict';

// Sorted longest-first so substring overlaps don't corrupt earlier rewrites.
// Each entry is [literalSource, neutralReplacement].
const REPLACEMENTS = [
    // -- Cross-cutting names that the SERVER emits in /_a/t.js and /_a/i.js
    //    AND the CLIENT bundle reads. Renamed to keep both halves in sync.
    ['crossDomainProxyPort',     'crossDomainGwPort'],
    ['forceProxySrcForImage',    'forceGwSrcForImage'],

    // -- Public methods on `hammerhead.utils.url.*` that our own code (and
    //    the bundle internals) call. Renamed in the bundle AND in our
    //    accessing code. The launcher.html / patchPageProcessing access
    //    them via base64-decoded property names, which were updated to
    //    encode the new names.
    ['overrideParseProxyUrl',    'overrideParseGwUrl'],
    ['overrideGetProxyUrl',      'overrideGetGwUrl'],
    ['parseProxyUrl',            'parseGwUrl'],
    ['getProxyUrl',              'getGwUrl'],

    // -- Property names on the URL config objects the bundle constructs
    //    internally. Hammerhead's bundle defines AND reads these on the
    //    same object, so renaming them on the way out the door is safe.
    ['proxyProtocol',            'gwProto'],
    ['proxyHostname',            'gwHost'],
    ['proxyPort',                'gwPort'],

    // -- Embedded marker strings (e.g. `_d|is-proxy-object|internal-prop-name`)
    //    used as keys for window-level wrapped-object trackers. Set and
    //    read inside the same bundle.
    ['force-proxy-src-flag',     'force-gw-src-flag'],
    ['proxy-handler-flag',       'gw-handler-flag'],
    ['is-proxy-object',          'is-gw-object'],
    ['proxy-object',             'gw-object'],
    ['proxy-table',              'gw-table'],

    // -- The server-side error message that leaks "proxy" plain-text.
    //    Hammerhead returns this body on /_a/t.js when the SID is
    //    unknown. We keep the meaning ("session not started") but drop
    //    the brand word.
    ['Session is not opened in proxy', 'Session is not opened'],

    // -- Misc strings that surface as JSON keys in URL parser output and
    //    appear in error logs. The bundle reads these on the same shape.
    ['"proxy":',                 '"gw":'],
    ["'proxy':",                 "'gw':"],

    // -- Auth header tokens hammerhead inspects in tunneled HTTP. These
    //    are HTTP header NAMES (the wire bytes) — see the Y-suffixed
    //    constants in hammerhead.min.js. We do NOT rename the wire form
    //    (that breaks RFC compliance); we only rewrite the *string
    //    constant* so it doesn't appear plaintext in the bundle.
    //    (Skipping for now — too high-risk; HTTP semantics depend on
    //    exact header names.)

    // -- Comments / TODO / GitHub URLs that mention testcafe/hammerhead
    //    in the dev (non-min) bundle. The min bundles are already
    //    comment-free, so these only matter in DEVELOPMENT=1 mode.
    ['DevExpress/testcafe-hammerhead', 'DevExpress/library'],
    ['testcafe-hammerhead',      'library'],
    ['testcafe',                 'library'],
];

// One regex per replacement, compiled once.
const _COMPILED = REPLACEMENTS.map(([from, to]) => [
    new RegExp(_escapeRegExp(from), 'g'),
    to,
]);

function _escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply the rename table to a JS source string. Returns the rewritten
 * string. Pure (no side effects).
 *
 * @param {string|Buffer} src
 * @returns {string}
 */
function apply(src) {
    if (src == null) return src;
    let out = typeof src === 'string' ? src : Buffer.from(src).toString('utf8');
    for (const [re, rep] of _COMPILED) {
        out = out.replace(re, rep);
    }
    return out;
}

module.exports = {
    apply,
    REPLACEMENTS,
};
