const crypto = require('crypto');

let cacheGet = async (_key) => {
    throw new TypeError('cannot cache get: must initialize cache settings first');
};
let cacheSet = async (_key, _value) => {
    throw new TypeError('cannot cache set: must initialize cache settings first');
};

/**
 * 
 * @param {import('../classes/StudyBoardJSAbstractCache.js')} jsCache 
 */
module.exports = async function (jsCache) {
    const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');

    cacheGet = async (key) => await jsCache.get(md5(key));
    cacheSet = async (key, value) => {
        if (!value) return;
        await jsCache.set(md5(key), value);
    }
};

// patch ScriptResourceProcessor
// https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/processing/resources/script.ts#L21

const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const { processScript } = require('testcafe-hammerhead/lib/processing/script');
const { updateScriptImportUrls } = require('testcafe-hammerhead/lib/utils/url');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');
const dynamicImport = require('testcafe-hammerhead/lib/processing/script/transformers/dynamic-import');
const StrShuffler = require('./StrShuffler');

// ─────────────────────────────────────────────────────────────────────────────
// Cross-session-safe JS cache
//
// Hammerhead's `processScript` rewrites JS sources, replacing every
// destination URL with a proxy URL produced by `toProxyUrl`. We patched
// `toProxyUrl` (see `addUrlShuffling.js`) to ALSO shuffle the destination
// portion using the requesting session's `shuffleDict`, and our
// `_stripProxyOriginFromScript` (see `patchScriptProcessing.js`) collapses
// `<proxy_origin>/<sessionId>/<dest>` down to a domain-relative
// `/<sessionId>/<dest>` so the served bytes don't leak the proxy host.
// The end result is JS that contains URLs of the form:
//
//   /<sessionA>[!meta]/_p1<HHHHH>:<bodyShuffledWithDictA>
//
// Hammerhead's `updateScriptImportUrls` helper substitutes the
// `<sessionId>` segment when serving from cache to a different session B —
// BUT only when the URL still has the proxy origin in front of it
// (matched by an explicit regex including protocol/host/port). We
// stripped that origin, so the helper is a no-op for us, and on top of
// that it doesn't even attempt to touch the shuffled body. Either way,
// session B retrieves URLs containing `<sessionA>` and `_p1` bodies
// shuffled with dict A. The proxy then unshuffles the body using
// session A's dict (because the URL routes to A) but session B's request
// flow → garbage destination → 404, OR if we substituted the session id
// only, body decodes to garbage too.
//
// To keep the cache cross-session-safe we:
//   1. Strip the original session id from cached URLs and record it in a
//      hidden `/*RH_SID:<32hex>*/` header at the top of the cached
//      string. The header is stripped on retrieval, so served bytes
//      never contain it.
//   2. Cache the script with `_p1<HHHHH>:` bodies UN-SHUFFLED, using a
//      `_pu<HHHHH>:` marker that's the same length as `_p1<HHHHH>:` so
//      character offsets are preserved.
// On retrieval we:
//   1. Read the original session id, replace every literal occurrence
//      of it in the cached body with the *current* session id.
//   2. Re-shuffle the bodies with the current session's dict.
// Length is preserved across both transforms (the position-dependent
// cipher is a 1:1 char substitution, with `%XX` triplets passed
// through), so the surrounding script source stays byte-identical
// modulo session-id and shuffle changes.
// ─────────────────────────────────────────────────────────────────────────────

const SHUFFLED_PREFIX = '_p1';
const CACHED_PREFIX = '_pu';
const LEN_DIGITS = 5;
const SID_HEADER_RE = /^\/\*RH_SID:([a-f0-9]{32})\*\/\n/;

function unshuffleBodyChars(dict, body) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
        const ch = body.charAt(i);
        const idx = dict.indexOf(ch);
        if (ch === '%' && body.length - i >= 3) {
            out += ch;
            out += body.charAt(++i);
            out += body.charAt(++i);
        } else if (idx === -1) {
            out += ch;
        } else {
            const baseIdx = ((idx - i) % 64 + 64) % 64;
            out += StrShuffler.baseDictionary.charAt(baseIdx);
        }
    }
    return out;
}

function shuffleBodyChars(dict, body) {
    let out = '';
    for (let i = 0; i < body.length; i++) {
        const ch = body.charAt(i);
        const idx = StrShuffler.baseDictionary.indexOf(ch);
        if (ch === '%' && body.length - i >= 3) {
            out += ch;
            out += body.charAt(++i);
            out += body.charAt(++i);
        } else if (idx === -1) {
            out += ch;
        } else {
            const dictIdx = ((idx + i) % 64 + 64) % 64;
            out += dict.charAt(dictIdx);
        }
    }
    return out;
}

// Find every `_p1<5hex>:` in the script, take the next `declaredLen` chars as
// the body, unshuffle with `dict`, and rewrite as `_pu<5hex>:<plaintext>`.
// Output length matches input length exactly. Then prepend a hidden
// `/*RH_SID:<sid>*/\n` header so that on retrieval we can replace the original
// session id with the current request's session id.
function rewriteScriptForCache(script, dict, sessionId) {
    if (!script || !dict) return script;
    let out = '';
    let cursor = 0;
    const re = /_p1([0-9a-f]{5}):/gi;
    let m;
    while ((m = re.exec(script)) !== null) {
        const start = m.index;
        const declaredLen = parseInt(m[1], 16);
        const bodyStart = start + m[0].length;
        const bodyEnd = bodyStart + declaredLen;
        if (bodyEnd > script.length) break; // truncated / corrupt — stop
        out += script.substring(cursor, start);
        const body = script.substring(bodyStart, bodyEnd);
        const plaintext = unshuffleBodyChars(dict, body);
        out += CACHED_PREFIX + m[1] + ':' + plaintext;
        cursor = bodyEnd;
        re.lastIndex = bodyEnd;
    }
    out += script.substring(cursor);
    if (sessionId && /^[a-f0-9]{32}$/i.test(sessionId)) {
        return '/*RH_SID:' + sessionId + '*/\n' + out;
    }
    return out;
}

// Inverse of `rewriteScriptForCache`: replace the original session id with
// `currentSessionId`, then turn every `_pu<5hex>:<plaintext>` back into
// `_p1<5hex>:<shuffled-with-dict>`. The hidden `/*RH_SID:*/` header is
// always stripped — served bytes never contain it.
function rewriteScriptForResponse(cached, dict, currentSessionId) {
    if (!cached || !dict) return cached;
    let working = cached;
    const headerMatch = working.match(SID_HEADER_RE);
    if (headerMatch) {
        const origSid = headerMatch[1];
        working = working.slice(headerMatch[0].length);
        if (currentSessionId && currentSessionId !== origSid) {
            working = working.split(origSid).join(currentSessionId);
        }
    }
    let out = '';
    let cursor = 0;
    const re = /_pu([0-9a-f]{5}):/gi;
    let m;
    while ((m = re.exec(working)) !== null) {
        const start = m.index;
        const declaredLen = parseInt(m[1], 16);
        const bodyStart = start + m[0].length;
        const bodyEnd = bodyStart + declaredLen;
        if (bodyEnd > working.length) break;
        out += working.substring(cursor, start);
        const body = working.substring(bodyStart, bodyEnd);
        const shuffled = shuffleBodyChars(dict, body);
        out += SHUFFLED_PREFIX + m[1] + ':' + shuffled;
        cursor = bodyEnd;
        re.lastIndex = bodyEnd;
    }
    out += working.substring(cursor);
    return out;
}

// CRITICAL: this replacement REPLACES whatever processResource sat on the
// prototype before — including the `dynamicImport.baseUrl` fix that
// `patchDynamicImport.js` installed earlier. We must re-apply that fix here
// or every dynamic `import('relative-chunk.js')` in modern Vite/React-Router-v7
// builds (e.g. ChatGPT) will resolve against `document.URL` (the page URL)
// instead of the importing chunk's URL — yielding 404s and the dreaded
// "Content failed to load — Try again" splash. See `patchDynamicImport.js`
// for the full rationale.
scriptProcessor.__proto__.processResource = async function processResource(script, ctx, _charset, urlReplacer) {
    if (!script) return script;

    const sessionDict = ctx && ctx.session && ctx.session.shuffleDict;
    const sessionId = ctx && ctx.session && ctx.session.id;

    let cachedScript = process.env.NO_JS_CACHE ? null : await cacheGet(script);

    if (!cachedScript) {
        const previousBaseUrl = dynamicImport.baseUrl;
        let processedScript;
        try {
            const destUrl = ctx && ctx.dest && ctx.dest.url;
            if (destUrl && typeof destUrl === 'string') {
                let base = destUrl.replace(/[?#].*$/, '');
                const lastSlash = base.lastIndexOf('/');
                if (lastSlash > 'https://'.length) {
                    base = base.slice(0, lastSlash + 1);
                } else {
                    base = base + (base.endsWith('/') ? '' : '/');
                }
                dynamicImport.baseUrl = base;
            }
            processedScript = processScript(
                script,
                true,
                false,
                urlReplacer,
                ctx.destRes.headers[BUILTIN_HEADERS.serviceWorkerAllowed],
                ctx.nativeAutomation
            );
        } finally {
            dynamicImport.baseUrl = previousBaseUrl;
        }

        // Cache the script with the originating session id captured in a
        // hidden header AND `_p1<HHHHH>:` bodies UN-SHUFFLED so the cached
        // form is independent of the requesting session's id and dict.
        // The current request's id/dict are what `processScript` baked
        // in, so they're what we strip here; per-session id/dict is
        // re-applied at retrieval time.
        if (process.env.NO_JS_CACHE) {
            return processedScript;
        }
        const cacheForm = rewriteScriptForCache(processedScript, sessionDict, sessionId);
        await cacheSet(script, cacheForm);
        cachedScript = cacheForm;
    }

    // Re-attach this session's id (replaces the cached header sid) and
    // re-shuffle bodies with this session's dict so the URLs the browser
    // receives are valid for this session. Without this step, every
    // cross-session cache hit returned URLs that the proxy could not
    // decode → 404. We deliberately bypass `updateScriptImportUrls` —
    // its regex requires `<proxy_origin>` which our patches strip out,
    // making the helper a no-op for our cache form.
    return rewriteScriptForResponse(cachedScript, sessionDict, sessionId);
};

module.exports.rewriteScriptForCache = rewriteScriptForCache;
module.exports.rewriteScriptForResponse = rewriteScriptForResponse;
