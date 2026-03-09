const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context');
const StrShuffler = require('./StrShuffler');
const getSessionId = require('./getSessionId');

function safeDecodeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    try {
        return decodeURIComponent(url);
    } catch (_) {
        return url;
    }
}

const replaceUrl = (url, replacer) => {
    //        regex:              https://google.com/    sessionid/   url
    return (url || '').replace(/^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+\/))([^]+)/i, function (_, g1, g2) {
        return g1 + replacer(g2);
    });
};

// unshuffle incoming url //
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');
const _dispatch = RequestPipelineContext.prototype.dispatch;
RequestPipelineContext.prototype.dispatch = function (openSessions) {
    // Decode path so percent-encoded :// (%3A%2F%2F) from Fly/proxies matches shuffled URLs
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
