/**
 * Outbound JavaScript brand stripper (CONSERVATIVE).
 *
 * The first version of this module did a heavy rename of `proxy*`-themed
 * identifiers (parseProxyUrl, getProxyUrl, crossDomainProxyPort,
 * forceProxySrcForImage, proxyProtocol/Host/Port, __get$ProxyUrl, …).
 * That broke the runtime: hammerhead's AST script-rewriter emits
 * `__get$ProxyUrl(...)` calls into rewritten user code, and a global
 * symbol rename decoupled the rewriter from the runtime helpers, so
 * every script-rewritten page hung on first URL access.
 *
 * The current pass is intentionally narrow:
 *
 *   • only replaces strings that are **comments / dev-only metadata**
 *     in the served bundles (TODO/FIXME markers, GitHub issue URLs,
 *     `testcafe-hammerhead` library mentions). These never affect the
 *     runtime call graph.
 *
 *   • the broader rename of proxy-related JS identifiers is left to
 *     property-name mangling that we may add later via UglifyJS,
 *     once we have a complete cross-bundle name map and proven test
 *     coverage to catch any miss.
 *
 * The mustache template patch (`task.js.mustache`) handles the only
 * other on-the-wire keyword leak: the `Session is not opened in
 * proxy` server error body, rewritten via patch-hammerhead.js.
 */
'use strict';

const REPLACEMENTS = [
    // Comments / dev metadata — safe to remove (no runtime effect).
    ['DevExpress/testcafe-hammerhead', 'DevExpress/library'],
    ['testcafe-hammerhead',            'library'],
    // server-side error message that surfaces in HTTP response bodies.
    ['Session is not opened in proxy', 'Session is not opened'],
];

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
