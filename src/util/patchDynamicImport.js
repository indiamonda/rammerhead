/**
 * Fix Hammerhead's dynamic-import baseUrl resolution under URL shuffling.
 *
 * Problem
 * -------
 * For every JS chunk Hammerhead transforms, `transformProgram` lazily computes
 *
 *   dynamic_import.baseUrl = (parseProxyUrl(resolver('./')) || {}).destUrl || ''
 *
 * and emits `import(__get$ProxyUrl(specifier, baseUrl))` for every dynamic
 * `import()` call. The client-side `__get$ProxyUrl(url, baseUrl)` resolves the
 * specifier against `baseUrl` so a chunk imported from
 * `https://chatgpt.com/cdn/assets/manifest.js` correctly loads
 * `https://chatgpt.com/cdn/assets/<chunk>.js`.
 *
 * BUT: rammerhead's `addUrlShuffling` patches `toProxyUrl` to emit shuffled
 * URLs of the form `<sid>!s!utf-8/_p1XXXXX:<shuffled-bytes>`. Hammerhead's
 * `parseProxyUrl` only understands plain `<sid>/<https-destination>` paths, so
 * for shuffled URLs it returns `null` and `baseUrl` collapses to `''`.
 *
 * With an empty baseUrl, the client falls back to resolving against
 * `document.URL` (the page URL, e.g. `https://chatgpt.com/`). The result is
 * that `import('a4295c68-foo.js')` from a chunk under `/cdn/assets/` resolves
 * to `https://chatgpt.com/a4295c68-foo.js` instead of
 * `https://chatgpt.com/cdn/assets/a4295c68-foo.js` — and 404s.
 *
 * Symptom: ChatGPT renders "Content failed to load — Try again", every Vite /
 * React-Router-v7 / Remix shop the same.
 *
 * Fix
 * ---
 * Wrap `ScriptResourceProcessor.prototype.processResource(script, ctx, …)`
 * so that, BEFORE Hammerhead runs `transformProgram`, we compute the directory
 * of `ctx.dest.url` and stash it as `dynamic_import.baseUrl`. The lazy
 * `getBaseUrl()` shim sees the value already set and skips its broken
 * `parseProxyUrl(resolver('./'))` path.
 *
 * We restore the previous `baseUrl` when the upstream `processResource`
 * resolves so concurrent transforms aren't poisoned. Hammerhead also calls
 * `afterTransform()` which clears the field — defence-in-depth.
 *
 * We patch the PROTOTYPE method (not the singleton instance) because
 * `patchScriptProcessing.js` later overrides the instance method and dispatches
 * through `Object.getPrototypeOf(this).processResource.call(this, …)`. Patching
 * the prototype guarantees the baseUrl fix runs regardless.
 */

const dynamicImport = require('testcafe-hammerhead/lib/processing/script/transformers/dynamic-import');
const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');

const proto = Object.getPrototypeOf(scriptProcessor);
console.log('[patchDynamicImport] loading, proto found:', !!proto, 'already patched:', !!(proto && proto._a_dynBase));
if (proto && !proto._a_dynBase) {
    proto._a_dynBase = true;
    const origProcessResource = proto.processResource;
    console.log('[patchDynamicImport] patched processResource on prototype');
    proto.processResource = function patchedProcessResource(script, ctx, charset, urlReplacer) {
        const destUrl = ctx && ctx.dest && ctx.dest.url;
        if (process.env.RH_DEBUG_URL && destUrl && /chatgpt/i.test(destUrl)) {
            process.stdout.write('[DYN_BASE_ENTER] ' + destUrl.slice(-70) + '\n');
        }
        const previous = dynamicImport.baseUrl;
        try {
            if (destUrl && typeof destUrl === 'string') {
                let base = destUrl.replace(/[?#].*$/, '');
                const lastSlash = base.lastIndexOf('/');
                if (lastSlash > 'https://'.length) {
                    base = base.slice(0, lastSlash + 1);
                } else {
                    base = base + (base.endsWith('/') ? '' : '/');
                }
                dynamicImport.baseUrl = base;
                if (process.env.RH_DEBUG_URL && /chatgpt/i.test(destUrl)) {
                    process.stdout.write('[DYN_BASE] ' + destUrl.slice(-70) + ' base=' + base + '\n');
                }
            }
            return origProcessResource.call(this, script, ctx, charset, urlReplacer);
        } finally {
            dynamicImport.baseUrl = previous;
        }
    };
}

module.exports = {};
