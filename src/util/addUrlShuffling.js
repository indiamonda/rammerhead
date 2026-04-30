const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context');
const StrShuffler = require('./StrShuffler');
const getSessionId = require('./getSessionId');

// Matches both the new (`_p1`/`_ps`) and legacy (`_rh1`/`_rhs`) shuffler
// indicators. Including the legacy form keeps any old saved/shared proxy
// URL working after the brand-strip rename.
const SHUFFLED_INDICATOR_RE = /(?:_p1|_rh1)[0-9a-f]{5}:|_(?:ps|rhs)/i;

/**
 * Recover the shuffled URL form from a path that may have been re-encoded by an
 * upstream proxy (e.g. Fly's edge turning `://` into `%3A%2F%2F`). Critically,
 * we MUST NOT decode `%XX` triplets that already live inside the shuffled body
 * — StrShuffler's cipher is position-dependent and treats every `%XX` triplet
 * as opaque, so decoding would shift cipher positions and produce a wrong
 * destination URL (e.g. `_Rectangle%201%20(3).svg` -> `_Rectangle 3 (7).wzk`).
 *
 * Strategy: only decode if the URL doesn't already contain a recognizable
 * shuffler indicator. If a single percent-decode pass surfaces the indicator,
 * use the decoded form; otherwise leave the URL untouched.
 */
function safeDecodeUrl(url) {
    if (!url || typeof url !== 'string') return url;

    if (SHUFFLED_INDICATOR_RE.test(url)) {
        return url;
    }

    let decoded;
    try {
        decoded = decodeURIComponent(url);
    } catch (_) {
        return url;
    }

    return SHUFFLED_INDICATOR_RE.test(decoded) ? decoded : url;
}

const replaceUrl = (url, replacer) => {
    // Split "proxy root … /<32hex session>(!meta)*/" from the hammerhead destination.
    // The session id is always exactly 32 hex chars; optional `!…` metadata (e.g.
    // `!s!utf-8`) is attached before the slash that starts the destination.
    //
    // We must allow *multiple* path segments before the session — not a single
    // `/(?:[^/]+)/` — otherwise `/studyboard/<sid>/…`, PATH_STYLE prefixes, or any
    // UI base path leaves `<sid>!meta/…` inside the "destination" capture, the
    // shuffler never sees `_rh1…`, and static chunks (ChatGPT `/cdn/assets/…`,
    // etc.) 404.
    //
    // Use NON-GREEDY `*?` for the path segments so the FIRST 32-hex segment is
    // claimed as the session. Otherwise content-hash directories that real
    // destinations include (Bilibili `/<32hex>/seg.m4s`, Twitch HLS
    // `/<32hex>/playlist.m3u8`, jsDelivr `/npm/foo@1.2.3/<32hex>.js`,
    // webpack chunks, etc.) are mistaken for session ids — the URL gets
    // sliced *after* that hash, the shuffled prefix never reaches the
    // shuffler, and the request 4xx's at the upstream origin.
    return (url || '').replace(
        /^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+)*?\/[a-f0-9]{32}(?:![^/?#]*)*\/)((?:.|\s)+)$/i,
        (_, g1, g2) => g1 + replacer(g2)
    );
};

// unshuffle incoming url //
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');
const _dispatch = RequestPipelineContext.prototype.dispatch;
RequestPipelineContext.prototype.dispatch = function (openSessions) {
    // Conservatively recover URLs where an upstream proxy percent-encoded the
    // shuffler header separator. We never decode `%XX` already inside the
    // shuffled body — StrShuffler is a position-dependent cipher that treats
    // those triplets as opaque, and decoding them shifts cipher positions and
    // produces wrong destination URLs.
    const rawUrl = this.req.url;
    this.req.url = safeDecodeUrl(rawUrl) || rawUrl;
    let sessionId = getSessionId(this.req.url);
    let session = sessionId && openSessions.get(sessionId);
    if (!session) {
        let ref = this.req.headers[BUILTIN_HEADERS.referer];
        if (Array.isArray(ref)) ref = ref[0];
        sessionId = getSessionId(ref);
        session = sessionId && openSessions.get(sessionId);
    }
    if (session && session.shuffleDict) {
        const shuffler = new StrShuffler(session.shuffleDict);
        this.req.url = replaceUrl(this.req.url, (url) => shuffler.unshuffle(url));
        let ref = this.req.headers[BUILTIN_HEADERS.referer];
        if (Array.isArray(ref)) ref = ref[0];
        if (getSessionId(ref) === sessionId) {
            this.req.headers[BUILTIN_HEADERS.referer] = replaceUrl(ref, (url) =>
                shuffler.unshuffle(url)
            );
        }
    }

    return _dispatch.call(this, openSessions);
};

// shuffle rewritten proxy urls //
let disableShuffling = false; // for later use
const _toProxyUrl = RequestPipelineContext.prototype.toProxyUrl;
RequestPipelineContext.prototype.toProxyUrl = function (...args) {
    const proxyUrl = _toProxyUrl.apply(this, args);

    if (!this.session || !this.session.shuffleDict || disableShuffling) return proxyUrl;

    const shuffler = new StrShuffler(this.session.shuffleDict);
    return replaceUrl(proxyUrl, (url) => shuffler.shuffle(url));
};

// unshuffle task.js referer header (avoid 500 when hammerhead parses referer; if session missing, strip referer so hammerhead doesn't throw)
const Proxy = require('testcafe-hammerhead/lib/proxy/index');
const __onTaskScriptRequest = Proxy.prototype._onTaskScriptRequest;
Proxy.prototype._onTaskScriptRequest = async function _onTaskScriptRequest(req, ...args) {
    try {
        let referer = req.headers[BUILTIN_HEADERS.referer];
        if (Array.isArray(referer)) referer = referer[0];
        referer = safeDecodeUrl(referer) || referer;
        const sessionId = getSessionId(referer);
        const session = sessionId && this.openSessions.get(sessionId);
        if (session && session.shuffleDict) {
            const shuffler = new StrShuffler(session.shuffleDict);
            req.headers[BUILTIN_HEADERS.referer] = replaceUrl(referer, (url) => shuffler.unshuffle(url));
        } else if (sessionId && !session) {
            // Session not in memory (e.g. task.js requested before document); remove referer so hammerhead doesn't parse shuffled URL and throw
            delete req.headers[BUILTIN_HEADERS.referer];
        }
        return await __onTaskScriptRequest.call(this, req, ...args);
    } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('(addUrlShuffling) _onTaskScriptRequest error:', err.message);
        }
        throw err;
    }
};

// don't shuffle action urls (because we don't get to control the rewriting when the user submits the form)
const DomProcessor = require('testcafe-hammerhead/lib/processing/dom/index');
const __processUrlAttrs = DomProcessor.prototype._processUrlAttrs;
DomProcessor.prototype._processUrlAttrs = function _processUrlAttrs(el, urlReplacer, pattern) {
    try {
        disableShuffling = pattern.urlAttr?.toLowerCase() === 'action';
        __processUrlAttrs.call(this, el, urlReplacer, pattern);
        disableShuffling = false;
    } catch (e) {
        disableShuffling = false;
        throw e;
    }
};
