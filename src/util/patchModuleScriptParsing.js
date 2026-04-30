/**
 * Patch hammerhead's `acorn-hammerhead` parser so it transparently retries
 * parsing as an ES module when the default (script-mode) parse fails.
 *
 * Why: hammerhead's `processScript` parses every JS resource with
 *
 *   acorn.parse(src, { allowImportExportEverywhere: true, ecmaVersion: 13 })
 *
 * The flag accepts `import`/`export` syntax in script mode, but a true ES
 * module can still trip the script-mode parser on:
 *
 *   • top-level `await` (only valid in modules)
 *   • `import.meta` (only valid in modules)
 *   • duplicate top-level binding names that strict mode rejects
 *   • a few other module-only features
 *
 * When parsing fails, hammerhead silently bails out (`processScript` returns
 * the source unchanged). The script then ships to the browser with its
 * ORIGINAL, un-rewritten static `import "./relative.js"` paths. The browser
 * resolves those paths against the proxied importer's URL — which is a
 * shuffled proxy URL — producing a HALF-shuffled URL that decodes to the
 * right destination on the proxy server (StrShuffler has path-resolution
 * recovery) but is a *different* URL string than the FULLY-shuffled URL we
 * emit when AST processing succeeds.
 *
 * ES module identity is keyed by URL, so the same chunk gets fetched twice:
 * once via the fully-shuffled URL (e.g. from the SSR HTML's modulepreload
 * links and AST-rewritten static imports) and once via the half-shuffled URL
 * (from string-preserved imports inside un-parseable modules). The browser
 * runs both copies as independent module instances, each with its own
 * private bindings.
 *
 * For React-based SPAs that use the module-private `createContext` pattern
 * (StoreScope, MobX stores, …) this means the consumer's `useContext(j6t)`
 * reads from a *different* `j6t` than the provider's `j6t.Provider`, so
 * `useContext` returns null and the page bails out:
 *
 *   "Error: No StoreScope found. Must use RQ within a <StoreScopeProvider>."
 *
 * Live-affected: ChatGPT (root-*.js has `await … export`), and any other
 * Vite/Remix/React-Router build whose entry chunks use top-level await.
 *
 * Fix: try the original parse first (preserves all existing behaviour for
 * scripts and the lenient parser quirks they depend on). If it throws, try
 * again with `sourceType: 'module'`. If THAT throws too, propagate the
 * original error so hammerhead's downstream `try/catch` still treats the
 * source as un-parseable. The fast path (parse succeeds in script mode)
 * stays a single parse with no measurable overhead.
 */
const acorn = require('acorn-hammerhead');

if (!acorn.__sb_module_fallback_patched) {
    const _origParse = acorn.parse;

    acorn.parse = function patchedParse(src, opts) {
        try {
            return _origParse.call(this, src, opts);
        } catch (err) {
            if (typeof src !== 'string') throw err;
            // Cheap pre-check: only retry if the source plausibly contains
            // module-only syntax. Saves a second parse attempt for genuinely
            // broken / truncated scripts.
            if (
                src.indexOf('import') === -1 &&
                src.indexOf('export') === -1 &&
                src.indexOf('await') === -1
            ) {
                throw err;
            }
            const moduleOpts = Object.assign({}, opts || {}, { sourceType: 'module' });
            try {
                return _origParse.call(this, src, moduleOpts);
            } catch (_err2) {
                throw err; // surface the original (script-mode) error
            }
        }
    };

    // Mirror static helpers/constants so consumers that destructure
    // `acorn.tokTypes`, `acorn.Parser`, etc. keep working.
    for (const k of Object.keys(_origParse)) {
        if (!Object.prototype.hasOwnProperty.call(acorn.parse, k)) {
            try { acorn.parse[k] = _origParse[k]; } catch (_) { /* readonly props */ }
        }
    }

    Object.defineProperty(acorn, '__sb_module_fallback_patched', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
    });
}
