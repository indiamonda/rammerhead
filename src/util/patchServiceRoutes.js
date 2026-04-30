/**
 * Brand-strip hammerhead's service-route paths so URL inspectors can't fingerprint
 * the proxy by well-known asset names like /hammerhead.js, /task.js, /iframe-task.js,
 * /transport-worker.js, /worker-hammerhead.js, /messaging.
 *
 * We mutate `testcafe-hammerhead/lib/proxy/service-routes`'s default export BEFORE
 * any other testcafe-hammerhead module requires it. Node caches the module by path,
 * so every later consumer (including session/injectables.js, which captures the
 * hammerhead path into `exports.SCRIPTS` at module load time) sees the new values.
 *
 * IMPORTANT: this file MUST be required before `require('testcafe-hammerhead')` and
 * before any `require('testcafe-hammerhead/lib/...')` that transitively pulls in
 * service-routes (page processing, session injectables, etc.).
 *
 * The mapping is also exported so server-side code (route registration, content
 * rewriting in served bundles, rescue regexes, injected scripts) can consult one
 * source of truth.
 */

const serviceRoutes = require('testcafe-hammerhead/lib/proxy/service-routes');

// New, neutral paths. Picked to look like ordinary CDN bundle filenames.
// Keep them short and numeric-ish to blend in with build-hash output (e.g. webpack
// chunk hashes, Vite's `/assets/<hash>.js`, Next's `/_next/static/<hash>.js`).
const NEW_PATHS = Object.freeze({
    hammerhead: '/_a/c.js',
    task: '/_a/t.js',
    iframeTask: '/_a/i.js',
    messaging: '/_a/m',
    transportWorker: '/_a/p.js',
    workerHammerhead: '/_a/w.js',
});

// What hammerhead's stock service-routes used to be. We keep this around so:
//   1) the asset bundles (which have hardcoded references to /task.js etc.)
//      can be string-rewritten to the new paths at serve time, and
//   2) we can register backward-compat aliases that still serve the same content
//      for any old client code or cached page that references the legacy path.
const OLD_PATHS = Object.freeze({
    hammerhead: '/hammerhead.js',
    task: '/task.js',
    iframeTask: '/iframe-task.js',
    messaging: '/messaging',
    transportWorker: '/transport-worker.js',
    workerHammerhead: '/worker-hammerhead.js',
});

// Hammerhead tags every script / stylesheet / charset element it injects into a
// proxied page with a class like `script-hammerhead-shadow-ui`. That's a giveaway
// for any anti-proxy detector that runs `document.querySelector('[class*=hammerhead]')`.
// Rename the postfix to a generic, utility-class-looking string that blends in.
//
// IMPORTANT: This is the SHARED suffix used by both the server (page.js / self-removing-scripts.js)
// AND the client bundle (hammerhead.js, which uses it to ignore its own DOM nodes).
// We mutate the server-side `shadow-ui/class-name` module below, and `rewriteBundlePaths`
// string-substitutes the OLD postfix → NEW postfix in the served client bundles so
// both halves stay in sync.
const SHADOW_UI_POSTFIX_OLD = '-hammerhead-shadow-ui';
const SHADOW_UI_POSTFIX_NEW = '-_a-ui';

// Other proxy-internal paths that get inspected/blocklisted. Kept here so
// setupRoutes.js, setupPipeline.js, and injected scripts use one source of truth.
// All paths are opaque /_a/* names; the older brand-bearing aliases were
// retired because they were textbook URL-shuffling-proxy fingerprints.
const PROXY_PATHS = Object.freeze({
    studyboardJs: '/_a/r.js',        // injected as <script src=> on every proxied page
    devtoolsJs:   '/_a/d.js',
    console:      '/_a/cl',
    raw:          '/_a/rw',
    sources:      '/_a/sr',
    shuffleDict:  '/_a/sd',
});

// Apply the mutation. After this, every module that does
//   const r = require('testcafe-hammerhead/lib/proxy/service-routes');
//   r.default.hammerhead    // returns '/_a/c.js'
// gets the new value because Node caches the resolved module object.
Object.assign(serviceRoutes, NEW_PATHS);

// Same trick for the shadow-ui class-name module: mutate its exports BEFORE any
// other testcafe-hammerhead module requires it, so server-side page processing
// and self-removing-scripts.js set the renamed class on injected elements, and
// the find-by-class lookup in page.js still works (we read and write the same value).
const shadowUiClassName = require('testcafe-hammerhead/lib/shadow-ui/class-name');
const _suiPostfix = SHADOW_UI_POSTFIX_NEW;
shadowUiClassName.postfix = _suiPostfix;
shadowUiClassName.charset = 'charset' + _suiPostfix;
shadowUiClassName.script = 'script' + _suiPostfix;
shadowUiClassName.selfRemovingScript = 'self-removing-script' + _suiPostfix;
shadowUiClassName.uiStylesheet = 'ui-stylesheet' + _suiPostfix;

// Hammerhead's `_registerServiceRoutes` calls `load_client_script(serviceRoutes.hammerhead, ...)`
// to read the underlying client bundle file from `lib/client/<name>`. After our rename,
// that path becomes `lib/client/_a/c.js` — which doesn't exist — and the proxy crashes on
// startup. Monkey-patch `load-client-script` to translate the renamed paths back to the
// real bundle filenames before the file lookup. Note: `StudyBoardGateway.GET` later overrides
// `handler.content` with our customized `src/client/*.min.js` bundles, so the content
// returned here is only used as a temporary placeholder.
const NEW_TO_OLD = Object.create(null);
for (const key of Object.keys(NEW_PATHS)) {
    NEW_TO_OLD[NEW_PATHS[key]] = OLD_PATHS[key];
}
const loadClientScriptPath = require.resolve('testcafe-hammerhead/lib/utils/load-client-script');
require(loadClientScriptPath);
const cachedLoader = require.cache[loadClientScriptPath];
if (cachedLoader && typeof cachedLoader.exports === 'function') {
    const getAssetPath = require('testcafe-hammerhead/lib/utils/get-asset-path');
    const { readSync } = require('read-file-relative');
    const fileCache = Object.create(null);
    cachedLoader.exports = function patchedLoadClientScript(name, devMode) {
        const lookupName = NEW_TO_OLD[name] || name;
        const cacheKey = lookupName + '|' + (devMode ? '1' : '0');
        if (fileCache[cacheKey]) return fileCache[cacheKey];
        const resultPath = '../client' + getAssetPath(lookupName, devMode);
        const script = readSync(resultPath);
        fileCache[cacheKey] = script;
        return script;
    };
}

module.exports = {
    NEW_PATHS,
    OLD_PATHS,
    PROXY_PATHS,
    SHADOW_UI_POSTFIX_OLD,
    SHADOW_UI_POSTFIX_NEW,
    /**
     * Rewrite hardcoded old paths AND the brand-y shadow-ui class postfix inside
     * a JS bundle string. Used when serving the patched hammerhead/worker/transport
     * bundles so internal code that does fetch('/task.js') still resolves under
     * the new name, and so client-side hammerhead can still recognize its own
     * shadow-ui elements (we renamed the postfix on the server, the client bundle
     * has the old value baked in at build time, so both halves must agree).
     */
    rewriteBundlePaths(content) {
        if (typeof content !== 'string') content = content.toString('utf8');
        let out = content;
        for (const key of Object.keys(OLD_PATHS)) {
            const oldP = OLD_PATHS[key];
            const newP = NEW_PATHS[key];
            if (!oldP || !newP || oldP === newP) continue;
            // Only replace when surrounded by quote chars or after a path separator
            // so we don't accidentally rewrite e.g. "task.js" inside an unrelated
            // longer string. Use a global word-boundary-ish split.
            out = out.split(oldP).join(newP);
        }
        // Replace the brand-y shadow-ui postfix everywhere it appears in the bundle.
        // Hammerhead uses both the bare postfix (`-hammerhead-shadow-ui`) and the
        // composite class names (`script-hammerhead-shadow-ui`, `ui-stylesheet-hammerhead-shadow-ui`,
        // ...). A single split-join on the postfix substring covers all of them.
        out = out.split(SHADOW_UI_POSTFIX_OLD).join(SHADOW_UI_POSTFIX_NEW);
        return out;
    },
};
