try {
    require('dotenv-flow').config();
} catch (e) {
    // dotenv-flow is a devDependency; in production installs it's missing and
    // that's fine — build doesn't actually need any env vars to produce the
    // src/client/* bundles. Don't fail the postinstall on its absence.
}

const path = require('path');
const fs = require('fs');
const UglifyJS = require('uglify-js');

// modify unmodifable items that cannot be hooked in studyboard.js
fs.writeFileSync(
    path.join(__dirname, './client/hammerhead.js'),
    fs
        .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/hammerhead.js'), 'utf8')
        // part of fix for iframing issue
        // Inject the iframe-aware top/parent/ancestor helpers under
        // brand-stripped names (`__SBRAND__t`, `__SBRAND__p`, `__SBRAND__dt`, `__SBRAND__ao`) so a
        // scanner that walks `Object.keys(window)` no longer sees a
        // literal "studyboard" string. The names need to stay short
        // because the regex replacements below splice them in place
        // of `window.top`/`window.parent` calls inside the minified
        // hammerhead bundle.
        .replace('(function initHammerheadClient () {', '(function initHammerheadClient () {' +
            'if (window["%_isd%"]) throw new TypeError("already ran"); window["%_isd%"] = true;' +
            'window.__SBRAND__t = (function() {var w = window; while (w !== w.top && w.parent["%_d%"]) w = w.parent; return w;})();' +
            'window.__SBRAND__p = window.__SBRAND__t === window ? window : window.parent;' +
            'window.__SBRAND__dt = (function() { var i=0,w=window; while (w !== window.top) {i++;w=w.parent} return i; })();' +
            'window.__SBRAND__ao = Array.from(location.ancestorOrigins).slice(0, -window.__SBRAND__dt);\n')
        // fix iframing proxy issue.
        // we replace window.top comparisons with the most upper window that's still a proxied page
        .replace(
            /(window|win|wnd|instance|opener|activeWindow)\.top/g,
            '$1.__SBRAND__t'
        )
        .replace(
            /window\.parent/g,
            'window.__SBRAND__p'
        )
        .replace(
            /window\.location\.ancestorOrigins/g,
            'window.__SBRAND__ao'
        )
        .replace(
            'isCrossDomainParent = parentLocationWrapper === parentWindow.location',
            'isCrossDomainParent = parentLocationWrapper === parentWindow.location || !parentWindow["%_d%"]'
        )
        .replace(
            '!sameOriginCheck(window1Location, window2Location)',
            '!(sameOriginCheck(window1Location, window2Location) && (!!window1["%_isd%"] === !!window2["%_isd%"]))'
        )
        // return false when unable to convert properties on other windows to booleans (!).
        // Match BOTH the original `%hammerhead%` / `%is-hammerhead%` keys (in case
        // patch-hammerhead.js hasn't run yet) AND the rebranded `%_d%` / `%_isd%`
        // keys (post-patch). The brand-strip patch in `scripts/patch-hammerhead.js`
        // rewrites those literals across hammerhead's lib/ tree.
        .replace(
            /!(parent|parentWindow|window1|window2|window\.top)\[("%(?:is-)?hammerhead%"|"%_(?:is)?d%")\]/g,
            '!(() => { try{ return $1[$2]; }catch(error){ return true } })()'
        )

        // disable saving to localStorage as we are using a completely different implementation
        .replace('saveToNativeStorage = function () {', 'saveToNativeStorage = function () {return;')

        // prevent calls to elements on a closed iframe
        .replace('dispatchEvent: function () {', '$& if (!window) return null;')
        .replace('click: function () {', '$& if (!window) return null;')
        .replace('setSelectionRange: function () {', '$& if (!window) return null;')
        .replace('select: function () {', '$& if (!window) return null;')
        .replace('focus: function () {', '$& if (!window) return null;')
        .replace('blur: function () {', '$& if (!window) return null;')
        .replace('preventDefault: function () {', '$& if (!window) return null;')

        // expose hooks for studyboard.js
        .replace(
            'function parseProxyUrl$1',
            'window.overrideParseProxyUrl = function(rewrite) {parseProxyUrl$$1 = rewrite(parseProxyUrl$$1)}; $&'
        )
        .replace(
            'function getProxyUrl$1',
            'window.overrideGetProxyUrl = function(rewrite) {getProxyUrl$$1 = rewrite(getProxyUrl$$1)}; $&'
        )
        .replace('return window.location.search;', 'return (new URL(get$$2())).search;')
        .replace('return window.location.hash;', 'return (new URL(get$$2())).hash;')
        .replace(
            'setter: function (search) {',
            '$& var url = new URL(get$$2()); url.search = search; window.location = convertToProxyUrl(url.href); return search;'
        )
        .replace(
            'setter: function (hash) {',
            '$& var url = new URL(get$$2()); url.hash = hash; window.location.hash = (new URL(convertToProxyUrl(url.href))).hash; return hash;'
        )
        // sometimes, postMessage doesn't work as expected when
        // postMessage gets run/received in same window without our wrappings.
        // this is to double check we wrapped it.
        // (cloudflare's turnstile threw this error after it tried to postMessage a fail code)
        //
        // NOTE: After the brand-strip patch (scripts/patch-hammerhead.js) the
        // MessageType prefix is `_d|` (replacing the legacy `hammerhead|`).
        // The patch is applied at install time, BEFORE this build runs, so
        // every shipped bundle emits + receives `_d|`-prefixed messages.
        // Checking ONLY for `_d|` keeps the literal string `hammerhead`
        // out of the served minified bundle, removing the last brand
        // signature for content-scanning filters.
        .replace(
            'data.type !== MessageType.Service && isWindow(target)',
            '$& && data.type?.startsWith("_d|")'
        )
        // Make _parseMessageJSONData NEVER throw on non-JSON postMessage payloads.
        //
        // Twitch (Kasada KPSDK), Discord (some preload scripts), Cloudflare Turnstile,
        // bytedance bdms, etc. send postMessage strings that aren't JSON — e.g.
        // "KPSDK:MC:A...". Stock hammerhead only try/catches when nativeAutomation is on,
        // so in our (proxy) case it just calls JSON.parse(str), which throws and propagates
        // as the noisy "Uncaught SyntaxError: Unexpected token 'K', \"KPSDK:MC:A\"... is not
        // valid JSON" flooding the page console and breaking some message handlers downstream.
        // Drop the `if (!nativeAutomation)` early-return so the try/catch fallback (which already
        // exists in the source) always wraps the parse and surfaces the raw string as a User
        // message instead.
        .replace(
            /MessageSandbox\._parseMessageJSONData = function \(str\) \{\s*if \(!settings\$1\.nativeAutomation\)\s*return parse\$1\(str\);\s*try \{/,
            'MessageSandbox._parseMessageJSONData = function (str) {\n        try {'
        )
        // Replace handleUrlsSet (srcset parser) with a WHATWG-compliant version.
        // Stock hammerhead does `url.split(',')` which mangles URLs that legitimately
        // contain commas — e.g. Cloudflare's `/cdn-cgi/image/q=78,scq=50,width=94,...`
        // image-resize URLs that poki.com (and many cf-cached sites) use in srcset.
        // The proper algorithm: a URL is a non-whitespace run; commas inside it are
        // part of the URL. The candidate-terminating comma comes AFTER the optional
        // descriptor (` 1x`, ` 2x`, ` 100w`, etc.).
        .replace(
            /function handleUrlsSet\(handler, url\) \{[\s\S]*?return replacedUrls\.join\(','\);\s*\}/,
            `function handleUrlsSet(handler, url) {
                var args = [];
                for (var _i = 2; _i < arguments.length; _i++) args[_i - 2] = arguments[_i];
                if (!url || typeof url !== 'string') return url;
                var n = url.length, i = 0, candidates = [];
                function _ws(cc){return cc===0x20||cc===0x09||cc===0x0A||cc===0x0C||cc===0x0D}
                while (i < n) {
                    while (i < n && _ws(url.charCodeAt(i))) i++;
                    if (i >= n) break;
                    var us = i;
                    while (i < n && !_ws(url.charCodeAt(i))) i++;
                    var u = url.substring(us, i);
                    var tc = 0;
                    while (u.length && u.charCodeAt(u.length - 1) === 0x2C) { u = u.slice(0, -1); tc++; }
                    if (!u) continue;
                    if (tc > 0) { candidates.push({ u: u, d: '' }); continue; }
                    while (i < n && _ws(url.charCodeAt(i))) i++;
                    var ds = i, depth = 0;
                    while (i < n) {
                        var cc = url.charCodeAt(i);
                        if (cc === 0x28) depth++;
                        else if (cc === 0x29 && depth) depth--;
                        else if (cc === 0x2C && depth === 0) break;
                        i++;
                    }
                    var d = url.substring(ds, i).replace(/^\\s+|\\s+$/g, '');
                    if (!d && u.indexOf(',') !== -1) {
                        var parts = u.split(',');
                        for (var k = 0; k < parts.length; k++) { var t = parts[k].replace(/^\\s+|\\s+$/g, ''); if (t) candidates.push({ u: t, d: '' }); }
                    } else {
                        candidates.push({ u: u, d: d });
                    }
                    if (i < n && url.charCodeAt(i) === 0x2C) i++;
                }
                if (!candidates.length) return url;
                var out = [];
                for (var j = 0; j < candidates.length; j++) {
                    var rep = handler.apply(void 0, [candidates[j].u].concat(args));
                    out.push(candidates[j].d ? rep + ' ' + candidates[j].d : rep);
                }
                return out.join(', ');
            }`
        )
);

// fix the
// worker-hammerhead.js:2434 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at worker-hammerhead.js:2434:35
fs.writeFileSync(
    path.join(__dirname, './client/worker-hammerhead.js'),
    fs
        .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/worker-hammerhead.js'), 'utf8')
        .replace('proxyLocation.port.toString()', 'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)')
);

// fix the
// transport-worker.js:1022 Uncaught TypeError: Cannot read properties of undefined (reading 'toString')
//     at transport-worker.js:1022:38
fs.writeFileSync(
    path.join(__dirname, './client/transport-worker.js'),
    fs
    .readFileSync(path.join(__dirname, '../node_modules/testcafe-hammerhead/lib/client/transport-worker.js'), 'utf8')
    .replace('proxyLocation.port.toString()', 'proxyLocation.port?.toString() || (proxyLocation.protocol === "https:" ? 443 : 80)')
);

const BRAND = (process.env.STUDYBOARD_BRAND || '_a').toLowerCase();
const replaceBrand = (s) => s.replace(/__SBRAND__/g, BRAND + '_');

// Apply brand substitution to already-written intermediate bundles
for (const f of ['hammerhead.js', 'studyboard.js']) {
    const fp = path.join(__dirname, './client', f);
    fs.writeFileSync(fp, replaceBrand(fs.readFileSync(fp, 'utf8')), 'utf8');
}

const minify = (fileName, newFileName) => {
    const minified = UglifyJS.minify(fs.readFileSync(path.join(__dirname, './client', fileName), 'utf8'));
    if (minified.error) {
        throw minified.error;
    }
    fs.writeFileSync(path.join(__dirname, './client', newFileName), minified.code, 'utf8');
};

minify('studyboard.js', 'studyboard.min.js');
minify('hammerhead.js', 'hammerhead.min.js');
minify('worker-hammerhead.js', 'worker-hammerhead.min.js');
minify('transport-worker.js', 'transport-worker.min.js');
