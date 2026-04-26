const http = require('http');
const https = require('https');
const zlib = require('zlib');
const config = require('../config');
const getSessionId = require('../util/getSessionId');
const { injectBrowserLikeHeaders } = require('../util/browserLikeHeaders');
const sessionAffinity = require('../util/sessionAffinity');
const adBlocker = require('../util/adBlocker');
const { NEW_PATHS, OLD_PATHS, PROXY_PATHS } = require('../util/patchServiceRoutes');
const fs = require('fs');
const path = require('path');

// Helper: does a request URL match either the new (/_a/...) path or its legacy
// (/__rh_*/api/shuffleDict/...) alias? We accept both during the transition so
// any cached page or bookmarked link still works.
function _urlMatchesEither(reqUrl, newPath, oldPath) {
    if (!reqUrl) return false;
    if (newPath && reqUrl.indexOf(newPath) !== -1) return true;
    if (oldPath && reqUrl.indexOf(oldPath) !== -1) return true;
    return false;
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, timeout: 60000, rejectUnauthorized: false });

const COMPRESSIBLE_RE = /text|javascript|json|xml|svg|css|html/i;
const BINARY_RE = /font|woff|image|audio|video|octet-stream|wasm|zip|gzip|pdf|protobuf/i;
function compressAndSend(req, res, statusCode, headers, body) {
    const ae = (req.headers['accept-encoding'] || '').toLowerCase();
    const ct = headers['Content-Type'] || headers['content-type'] || '';
    if (ae.includes('gzip') && COMPRESSIBLE_RE.test(ct) && !BINARY_RE.test(ct) && body.length > 1024) {
        body = zlib.gzipSync(body, { level: 6 });
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
    }
    headers['Content-Length'] = body.length;
    try { res.writeHead(statusCode, headers); res.end(body); } catch (_) {}
}

// Headers that leak proxy/reverse-proxy; strip before forwarding to destination so sites don't block
const PROXY_LEAK_HEADERS = [
    'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-protocol',
    'x-real-ip', 'via', 'forwarded', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
    'x-request-id', 'x-vercel-id', 'x-amzn-trace-id', 'x-cloud-trace-context',
    'cdn-loop', 'true-client-ip', 'x-client-ip', 'x-original-url', 'x-rewrite-url'
];

const DEV = !!process.env.DEVELOPMENT;
const ANSI = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', white: '\x1b[37m', magenta: '\x1b[35m' };
function devErr(label, err) {
    if (!DEV) return;
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    process.stderr.write(`${ANSI.red}[DEV ERR]${ANSI.reset} ${ANSI.yellow}${label}${ANSI.reset} ${msg}\n`);
}
const LEVEL_STYLE = {
    error: { color: ANSI.red, label: 'ERR' },
    warn:  { color: ANSI.yellow, label: 'WRN' },
    info:  { color: ANSI.cyan, label: 'INF' },
    debug: { color: ANSI.gray, label: 'DBG' },
    log:   { color: ANSI.white, label: 'LOG' }
};

const CTYPE_SHORT = { 'text/html': 'html', 'text/css': 'css', 'text/javascript': 'js', 'application/javascript': 'js',
    'application/json': 'json', 'application/xml': 'xml', 'text/plain': 'txt', 'image/png': 'png',
    'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp',
    'font/woff2': 'woff2', 'font/woff': 'woff', 'application/wasm': 'wasm', 'application/octet-stream': 'bin' };

function shortType(ct) {
    if (!ct) return '';
    const base = ct.split(';')[0].trim().toLowerCase();
    return CTYPE_SHORT[base] || base.replace(/^(application|text)\//, '');
}

function formatBytes(n) {
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(1) + 'KB';
    return (n / 1048576).toFixed(1) + 'MB';
}

function statusColor(code) {
    if (code >= 500) return ANSI.red;
    if (code >= 400) return ANSI.yellow;
    if (code >= 300) return ANSI.cyan;
    if (code >= 200) return ANSI.green;
    return ANSI.gray;
}

function printNetRequest(status, ctype, size, ms, url) {
    let short;
    try { const u = new URL(url); short = u.host + u.pathname + (u.search || ''); } catch (_) { short = url; }
    if (short.length > 90) short = short.substring(0, 87) + '...';
    const sc = statusColor(status);
    const typ = shortType(ctype).padEnd(5);
    const sz = formatBytes(size).padStart(8);
    const time = (ms + 'ms').padStart(7);
    process.stdout.write(`${sc}${status}${ANSI.reset} ${ANSI.gray}${typ}${ANSI.reset} ${sz} ${ANSI.gray}${time}${ANSI.reset}  ${short}\n`);
}

function printConsoleMessage(entry) {
    const s = LEVEL_STYLE[entry.l] || LEVEL_STYLE.log;
    const ts = new Date(entry.t).toLocaleTimeString();
    let src = entry.u || '';
    try { src = new URL(src).host + new URL(src).pathname; } catch (_) {}
    if (src.length > 60) src = src.substring(0, 57) + '...';
    const msg = (entry.a || []).join(' ');
    const line = `${ANSI.gray}${ts}${ANSI.reset} ${s.color}[${s.label}]${ANSI.reset} ${ANSI.gray}${src}${ANSI.reset} ${msg}`;
    if (entry.l === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
}

// Apparatus-style bridge script: lightweight URL interception without JS rewriting.
// Injected into raw-mode pages so fetch/XHR/dynamic elements route through the proxy.
//
// Note: proxyOrigin parameter is intentionally unused now. We derive O from
// location.origin at runtime so the proxy hostname is never embedded as a string
// literal in served HTML (anti-fingerprinting). The arg stays for API stability.
function buildBridgeScript(_proxyOrigin, sessionId, targetUrl) {
    return `<script>(function(){
var O=(typeof location!=='undefined'&&location.origin)||(location.protocol+'//'+location.host);
var S=${JSON.stringify(sessionId)},D=${JSON.stringify(targetUrl || '')};
// Clear any legacy __rh_sess cookie (removed to prevent cross-destination header leaks).
try{document.cookie='__rh_sess=; Max-Age=0; path=/'}catch(e){}
function px(u){return O+'/'+S+'/'+u}
function isExt(u){if(!u||typeof u!=='string')return false;u=u.trim();
return/^https?:\\/\\//i.test(u)&&u.indexOf(O)!==0}
if(D){try{var du=new URL(D);
var _rl=window.location,_rr=_rl.replace.bind(_rl),_ra=_rl.assign.bind(_rl),_rrl=_rl.reload.bind(_rl);
var lp={href:{get:function(){return du.href},set:function(v){_rr(isExt(v)?px(v):v)}},
hostname:{get:function(){return du.hostname}},host:{get:function(){return du.host}},
origin:{get:function(){return du.origin}},protocol:{get:function(){return du.protocol}},
pathname:{get:function(){return du.pathname}},search:{get:function(){return du.search}},
hash:{get:function(){return du.hash},set:function(v){du.hash=v}},
port:{get:function(){return du.port}},
assign:{value:function(u){_ra(isExt(u)?px(u):u)}},
replace:{value:function(u){_rr(isExt(u)?px(u):u)}},
reload:{value:function(){_rrl()}},
toString:{value:function(){return du.href}}};
Object.defineProperty(window,'location',{configurable:true,enumerable:true,
get:function(){var o=Object.create(null);for(var k in lp){try{Object.defineProperty(o,k,lp[k])}catch(e){}}
o[Symbol.toPrimitive]=function(){return du.href};return o}});
}catch(e){}}
var oF=window.fetch;if(oF)window.fetch=function(u,o){
if(typeof u==='string'&&isExt(u))u=px(u);
else if(u&&typeof u==='object'&&u.url&&isExt(u.url)){try{u=new Request(px(u.url),u)}catch(e){}}
return oF.call(this,u,o)};
var XP=XMLHttpRequest.prototype,oX=XP.open;
XP.open=function(m,u){if(typeof u==='string'&&isExt(u))arguments[1]=px(u);return oX.apply(this,arguments)};
if(typeof EventSource!=='undefined'){var oE=EventSource;
window.EventSource=function(u,o){if(isExt(u))u=px(u);return new oE(u,o)};
window.EventSource.prototype=oE.prototype}
var oW=window.open;if(oW)window.open=function(u){
if(typeof u==='string'&&isExt(u))arguments[0]=px(u);return oW.apply(this,arguments)};
function fixEl(el){if(!el||el.nodeType!==1||el.__rhRaw)return;el.__rhRaw=1;
var t=el.tagName;
if((t==='IFRAME'||t==='SCRIPT'||t==='IMG'||t==='SOURCE'||t==='VIDEO'||t==='AUDIO'||t==='EMBED')&&isExt(el.getAttribute('src')))el.setAttribute('src',px(el.getAttribute('src')));
if((t==='LINK'||t==='A'||t==='AREA')&&isExt(el.getAttribute('href')))el.setAttribute('href',px(el.getAttribute('href')));
if(t==='FORM'&&isExt(el.getAttribute('action')))el.setAttribute('action',px(el.getAttribute('action')));
if(t==='OBJECT'&&isExt(el.getAttribute('data')))el.setAttribute('data',px(el.getAttribute('data')))}
function fixTree(n){fixEl(n);try{var els=n.querySelectorAll('iframe,script,img,link,a,form,source,video,audio,embed,object,area');
for(var i=0;i<els.length;i++)fixEl(els[i])}catch(e){}}
function startObs(){var r=document.documentElement;if(!r){document.addEventListener('DOMContentLoaded',startObs);return}
new MutationObserver(function(ml){for(var i=0;i<ml.length;i++){var m=ml[i];
if(m.type==='childList'){for(var j=0;j<m.addedNodes.length;j++)fixTree(m.addedNodes[j])}
else if(m.type==='attributes')fixEl(m.target)}
}).observe(r,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href','action','data']})}
startObs();
document.addEventListener('click',function(e){var a=e.target.closest('a[href]');
if(a&&isExt(a.getAttribute('href'))){a.setAttribute('href',px(a.getAttribute('href')))}},true);
document.addEventListener('submit',function(e){var f=e.target;
if(f&&f.tagName==='FORM'&&isExt(f.getAttribute('action'))){f.setAttribute('action',px(f.getAttribute('action')))}},true);
})()</script>`;
}

// Fetch a URL with browser-like headers, following redirects. Returns {status, headers, body} via callback.
// options.method and options.body allow forwarding POST/PUT/etc from the client.
function rawFetch(url, callback, hops, options) {
    if (typeof hops === 'object' && !options) { options = hops; hops = 0; }
    if (!hops) hops = 0;
    if (!options) options = {};
    if (hops > 5) { devErr('rawFetch', 'too many redirects: ' + url); return callback(new Error('too many redirects')); }
    let parsed;
    try { parsed = new URL(url); } catch (e) { devErr('rawFetch bad url', url); return callback(new Error('bad url')); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const method = (options.method || 'GET').toUpperCase();
    const opts = {
        method: method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        agent: parsed.protocol === 'https:' ? httpsAgent : httpAgent,
        headers: Object.assign({
            'Host': parsed.host,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1',
        }, options.extraHeaders || {}),
        timeout: 15000,
    };
    const req = lib.request(opts, fetchRes => {
        if (fetchRes.statusCode >= 300 && fetchRes.statusCode < 400 && fetchRes.headers.location) {
            try { return rawFetch(new URL(fetchRes.headers.location, url).href, callback, hops + 1, { method: 'GET' }); }
            catch (_) { return callback(new Error('redirect failed')); }
        }
        let stream = fetchRes;
        const enc = (fetchRes.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = fetchRes.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = fetchRes.pipe(zlib.createInflate());
        else if (enc === 'br') stream = fetchRes.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        stream.on('data', c => chunks.push(c));
        stream.on('end', () => callback(null, fetchRes.statusCode, fetchRes.headers, Buffer.concat(chunks)));
        stream.on('error', e => callback(e));
    });
    req.on('error', e => callback(e));
    req.on('timeout', () => { req.destroy(); callback(new Error('timeout')); });
    if (options.body && method !== 'GET' && method !== 'HEAD') req.write(options.body);
    req.end();
}

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
    const stream = require('stream');
    const StrShuffler = require('../util/StrShuffler');

    // ── Pluggable URL path style ─────────────────────────────────────────────
    // When `config.pathStyle` is non-empty (e.g. "cdn-cgi/p"), incoming
    // requests arrive as `/<pathStyle>/<sid>/<dest>`. We strip the prefix at
    // the *very* top of `_onRequest` — BEFORE Hammerhead's `checkIsRoute`,
    // BEFORE every Rammerhead pipeline handler, BEFORE `super._onRequest`.
    // This is critical: many handlers (notably `injectBrowserLikeHeaders` →
    // see `PROXY_REQUEST_RE` in browserLikeHeaders.js) recognise a request as
    // "proxied" only if the path starts with `/<32-hex-sid>/`. If we strip
    // later in the pipeline, those handlers see `/<pathStyle>/...`, decide
    // it's not a proxy URL, and silently leave headers alone — including the
    // client's `Accept: */*` which makes Hammerhead's `isPage()` return false
    // and skip page processing entirely (raw upstream HTML, no antidetect
    // injection, no URL rewriting).
    //
    // Outgoing URLs in HTML/JS/CSS get the prefix re-injected by
    // `_stripProxyOriginFromBody` (in patchPageProcessing.js) and
    // `_stripProxyOriginFromScript` (in patchScriptProcessing.js), so the
    // served bytes refer to `/cdn-cgi/p/<sid>/...` while the server-side
    // pipeline only ever sees `/<sid>/...`. See config.js for full rationale.
    //
    // Edge case: we accept the bare `/<sid>/<dest>` form too. Hammerhead's
    // client-side getProxyUrl can't see the configured prefix and so emits
    // bare URLs in runtime fetch/XHR rewrites; rejecting them would break
    // proxied SPAs. The prefix is therefore a "decorative" stealth feature
    // that wins on initial navigation and rewritten attribute URLs.
    const _pathStyle = (require('../config').pathStyle || '').replace(/^\/+|\/+$/g, '');
    const _pathPrefix = _pathStyle ? '/' + _pathStyle : '';
    if (_pathPrefix) {
        function _stripPrefix(req) {
            const u = req && req.url;
            if (!u) return;
            if (u === _pathPrefix || u.startsWith(_pathPrefix + '/') || u.startsWith(_pathPrefix + '?')) {
                const before = u;
                req.url = u.slice(_pathPrefix.length) || '/';
                if (process.env.PATH_STYLE_DEBUG) console.error('[pathStrip]', before, '→', req.url);
            }
        }
        const _origOnRequest = proxyServer._onRequest.bind(proxyServer);
        proxyServer._onRequest = function (req, res, serverInfo) {
            _stripPrefix(req);
            return _origOnRequest(req, res, serverInfo);
        };
        const _origOnUpgrade = proxyServer._onUpgradeRequest.bind(proxyServer);
        proxyServer._onUpgradeRequest = function (req, socket, head, serverInfo) {
            _stripPrefix(req);
            return _origOnUpgrade(req, socket, head, serverInfo);
        };
    }

    // Extract the real destination URL from a proxied request. Handles unshuffled
    // (`/<sid>/https://...`) and shuffled (`/<sid>!a!1!s*host/_rhs...`) URL forms.
    // Returns null when the URL can't be mapped to a destination.
    const _PROXY_DEST_RE = /^(?:\/rammerhead)?\/([a-f0-9]{32})(?:(?:![^/]+)*)\/(.+?)(?:\?|$)/i;
    function _extractDestForAdBlock(reqUrl) {
        if (!reqUrl) return null;
        const pathOnly = reqUrl.split('?')[0];
        const m = pathOnly.match(_PROXY_DEST_RE);
        if (!m) return null;
        const sessionId = m[1];
        let destPart = m[2];
        const qi = reqUrl.indexOf('?');
        const query = qi === -1 ? '' : reqUrl.slice(qi);

        if (/^https?:\/\//i.test(destPart)) return destPart + query;

        // Shuffled: unshuffle with session's dict
        if (destPart.startsWith(StrShuffler.shuffledIndicator)) {
            const session = sessionStore.get(sessionId) || proxyServer.openSessions.get(sessionId);
            if (session && session.shuffleDict) {
                try {
                    const shuffler = new StrShuffler(session.shuffleDict);
                    const unshuffled = shuffler.unshuffle(destPart);
                    const firstUrl = unshuffled.split(',')[0].trim();
                    if (/^https?:\/\//i.test(firstUrl)) return firstUrl + query;
                } catch (_) {}
            }
        }
        return null;
    }

    // YouTube player-response JSON rewriter. When hammerhead proxies a request that returns
    // YouTube's /youtubei/v1/player JSON, we buffer the body and strip ad placements before
    // sending to the client. Runs BEFORE gzip so we mutate decompressed bytes.
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, _isRoute, isWebsocket) => {
        if (isWebsocket) return false;
        if (res instanceof stream.Duplex) return false;
        if (!adBlocker.isEnabledFor(req)) return false;
        const dest = _extractDestForAdBlock(req.url);
        if (!dest) return false;
        if (!adBlocker.YOUTUBE_PLAYER_RE.test(dest)) return false;

        const origWriteHead = res.writeHead.bind(res);
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        const chunks = [];
        let active = false;
        let savedArgs = null;

        res.writeHead = function (code, reasonOrHeaders, maybeHeaders) {
            const headers = maybeHeaders || (typeof reasonOrHeaders === 'object' ? reasonOrHeaders : {});
            // Look for JSON content-type
            let ct = '';
            if (headers) {
                if (Array.isArray(headers)) {
                    for (let i = 0; i < headers.length - 1; i += 2) {
                        if (headers[i].toLowerCase() === 'content-type') ct = headers[i + 1] || '';
                    }
                } else {
                    for (const k in headers) if (k.toLowerCase() === 'content-type') ct = headers[k] || '';
                }
            }
            if (/application\/json|text\/json/i.test(ct)) {
                active = true;
                savedArgs = [code, reasonOrHeaders, maybeHeaders];
                // Delay real writeHead — need to recompute Content-Length after body rewrite
                return;
            }
            return origWriteHead(code, reasonOrHeaders, maybeHeaders);
        };
        res.write = function (chunk, encoding, cb) {
            if (active && chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
                if (cb) cb();
                return true;
            }
            return origWrite(chunk, encoding, cb);
        };
        res.end = function (chunk, encoding, cb) {
            if (active) {
                if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
                const body = Buffer.concat(chunks);
                const rewritten = adBlocker.rewriteYoutubePlayerJson(body.toString('utf-8'));
                const outBuf = Buffer.from(rewritten, 'utf-8');
                const [code, reasonOrHeaders, maybeHeaders] = savedArgs;
                const headers = maybeHeaders || (typeof reasonOrHeaders === 'object' ? reasonOrHeaders : {});
                if (headers) {
                    if (Array.isArray(headers)) {
                        for (let i = 0; i < headers.length - 1; i += 2) {
                            if (headers[i].toLowerCase() === 'content-length') { headers.splice(i, 2); i -= 2; }
                        }
                        headers.push('Content-Length', String(outBuf.length));
                    } else {
                        for (const k in headers) if (k.toLowerCase() === 'content-length') delete headers[k];
                        headers['Content-Length'] = outBuf.length;
                    }
                }
                try { origWriteHead(code, reasonOrHeaders, maybeHeaders); } catch (_) {}
                return origEnd(outBuf, undefined, cb);
            }
            return origEnd(chunk, encoding, cb);
        };
        return false;
    }, true);

    // Global gzip compression for all non-websocket responses with compressible content
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, _isRoute, isWebsocket) => {
        if (isWebsocket) return false;
        if (res instanceof stream.Duplex) return false;
        const ae = (req.headers['accept-encoding'] || '').toLowerCase();
        if (!ae.includes('gzip')) return false;
        const accept = (req.headers['accept'] || '').toLowerCase();
        if (accept.includes('text/event-stream')) return false;

        const origWriteHead = res.writeHead;
        const origWrite = res.write;
        const origEnd = res.end;
        let gzStream = null;
        let decided = false;
        let shouldCompress = false;

        res.writeHead = function (code, reasonOrHeaders, maybeHeaders) {
            let headers = maybeHeaders || (typeof reasonOrHeaders === 'object' ? reasonOrHeaders : undefined);
            if (!headers) { headers = {}; }

            const findHeader = (name) => {
                if (Array.isArray(headers)) {
                    for (let i = 0; i < headers.length - 1; i += 2) {
                        if (headers[i].toLowerCase() === name) return headers[i + 1];
                    }
                    return undefined;
                }
                for (const k in headers) { if (k.toLowerCase() === name) return headers[k]; }
                return undefined;
            };
            const setHeader = (name, val) => {
                if (Array.isArray(headers)) { headers.push(name, val); return; }
                headers[name] = val;
            };
            const deleteHeader = (name) => {
                if (Array.isArray(headers)) {
                    for (let i = 0; i < headers.length - 1; i += 2) {
                        if (headers[i].toLowerCase() === name) { headers.splice(i, 2); i -= 2; }
                    }
                    return;
                }
                for (const k in headers) { if (k.toLowerCase() === name) delete headers[k]; }
            };

            decided = true;
            const ce = findHeader('content-encoding');
            const ct = (findHeader('content-type') || '').toLowerCase();
            shouldCompress = !ce && COMPRESSIBLE_RE.test(ct) && !ct.includes('event-stream') && !BINARY_RE.test(ct);

            if (shouldCompress) {
                setHeader('Content-Encoding', 'gzip');
                setHeader('Vary', 'Accept-Encoding');
                deleteHeader('content-length');
                gzStream = zlib.createGzip({ level: 6 });
                gzStream.on('data', chunk => origWrite.call(res, chunk));
                gzStream.on('end', () => origEnd.call(res));
            }

            if (maybeHeaders) origWriteHead.call(res, code, reasonOrHeaders, headers);
            else if (typeof reasonOrHeaders === 'object') origWriteHead.call(res, code, headers);
            else if (reasonOrHeaders) origWriteHead.call(res, code, reasonOrHeaders);
            else origWriteHead.call(res, code);
        };

        function _lateDecide() {
            if (decided) return;
            decided = true;
            const ct = (res.getHeader && res.getHeader('content-type') || '').toLowerCase();
            const ce = res.getHeader && res.getHeader('content-encoding');
            if (!ce && COMPRESSIBLE_RE.test(ct) && !ct.includes('event-stream') && !BINARY_RE.test(ct)) {
                shouldCompress = true;
                res.setHeader('content-encoding', 'gzip');
                res.setHeader('vary', 'Accept-Encoding');
                res.removeHeader('content-length');
                gzStream = zlib.createGzip({ level: 6 });
                gzStream.on('data', chunk => origWrite.call(res, chunk));
                gzStream.on('end', () => origEnd.call(res));
            }
        }

        res.write = function (chunk, encoding, cb) {
            _lateDecide();
            if (shouldCompress && gzStream) return gzStream.write(chunk, encoding, cb);
            return origWrite.call(res, chunk, encoding, cb);
        };

        res.end = function (chunk, encoding, cb) {
            _lateDecide();
            if (shouldCompress && gzStream) {
                if (chunk) gzStream.write(chunk, encoding);
                gzStream.end(null, null, cb);
                return;
            }
            return origEnd.call(res, chunk, encoding, cb);
        };

        return false;
    }, true);

    // Relative-path rescue: when Hammerhead fails to process a page (e.g. ChatGPT,
    // Claude), URLs stay as relative paths (/cdn/assets/..., /cdn-cgi/..., etc.).
    // The browser resolves them to http://proxy/path without a session ID.
    // We extract the session from the Referer and rewrite to the correct proxy URL.
    // Match all known proxy-internal paths (both renamed `/_a/...` and legacy
    // `/__rh_*` / `/hammerhead.js` etc.) so the rescue mechanism doesn't try to
    // proxy them to the destination.
    const KNOWN_ROUTE_RE = /^\/(newsession|editsession|deletesession|sessionexists|mainport|needpassword|ensuresession|getproxiedurl|generatelink|health|debug-proxy|syncLocalStorage|api\/shuffleDict|__rh_|_a\/|embedded-styles\.css|styles\.css|style\.css|favicon|manifest\.json|hammerhead\.js|rammerhead\.js|task\.js|iframe-task\.js|transport-worker\.js|worker-hammerhead\.js|messaging|__rh_devtools\.js|[a-f0-9]{32}[\/?!])/i;

    function _extractOriginFromReferer(referer) {
        const sessionId = getSessionId(referer);
        if (!sessionId) return null;

        const session = sessionStore.get(sessionId) || proxyServer.openSessions.get(sessionId);
        if (!session) return null;

        const originMatch = referer.match(/\/[a-z0-9]{32}(?:![^/]*)?\/(https?:\/\/[^/]+)/i);
        if (originMatch) return { sessionId, origin: originMatch[1] };

        if (session.shuffleDict) {
            const pathMatch = referer.match(/\/[a-z0-9]{32}(?:![^/]*)?\/(.+?)(?:\?|$)/i);
            if (pathMatch && pathMatch[1].startsWith(StrShuffler.shuffledIndicator)) {
                try {
                    const shuffler = new StrShuffler(session.shuffleDict);
                    const unshuffled = shuffler.unshuffle(pathMatch[1]);
                    const m2 = unshuffled.match(/^(https?:\/\/[^/]+)/i);
                    if (m2) return { sessionId, origin: m2[1] };
                } catch (_) {}
            }
        }
        return null;
    }

    // NOTE: The previous `_extractFromCookie` fallback was removed. A path=/ cookie on a
    // single proxy host cannot safely encode "which destination this request belongs to"
    // because it's shared across all proxied sites. In practice it caused cross-destination
    // header leaks (e.g. jmail.world's origin bleeding into chatgpt.com requests). The
    // Referer header covers >99% of real subresource rescues; anything without a Referer
    // that we can't identify via URL/Referer now gracefully 404s instead of being mis-routed.

    // Paths handled by setupRoutes' homepage logic (cover page + stealth portal).
    // These must not enter relative-path rescue or they'll be misinterpreted as
    // sub-resources of whatever site the user was last on.
    const _stealthPortal = (require('../config').stealthPortal || '').trim() || null;
    const HOMEPAGE_PATHS = new Set([
        '/', '/index.html', '/index.htm',
        '/rammerhead', '/rammerhead/', '/rammerhead/index.html', '/rammerhead/index.htm',
    ]);
    if (_stealthPortal) {
        HOMEPAGE_PATHS.add('/' + _stealthPortal);
        HOMEPAGE_PATHS.add('/' + _stealthPortal + '/');
        HOMEPAGE_PATHS.add('/rammerhead/' + _stealthPortal);
        HOMEPAGE_PATHS.add('/rammerhead/' + _stealthPortal + '/');
    }

    proxyServer.addToOnRequestPipeline((req, res) => {
        const url = req.url || '';
        if (!url.startsWith('/')) return false;
        if (KNOWN_ROUTE_RE.test(url)) return false;
        const pathOnly = url.split('?')[0];
        if (HOMEPAGE_PATHS.has(pathOnly)) return false;

        const referer = req.headers['referer'] || '';
        const info = _extractOriginFromReferer(referer);
        if (!info) {
            if (process.env.DEVELOPMENT) devErr('rescue-miss ' + url, 'ref=' + referer.substring(0, 80));
            return false;
        }

        const targetUrl = info.origin + url;

        // Ad Blocker rescue-path check: block ad/tracker URLs that resolved via Referer
        if (adBlocker.isEnabledFor(req) && adBlocker.shouldBlockUrl(targetUrl)) {
            if (process.env.DEVELOPMENT) {
                process.stdout.write(`\x1b[90m[AD-BLOCK-RESCUE]\x1b[0m ${targetUrl.substring(0, 120)}\n`);
            }
            adBlocker.writeBlockedResponse(req, res, targetUrl);
            return true;
        }

        // CORS preflight requests don't go to the destination — answer locally so
        // the actual request can proceed with credentials.
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': req.headers['origin'] || '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
                'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Max-Age': '86400',
            });
            res.end();
            return true;
        }

        // Route everything (sub-resources, fetch/XHR, navigation) through Hammerhead's
        // pipeline by rewriting the URL to its proxied form. This is critical for SPAs
        // like ChatGPT/Remix/React-Router where:
        //
        //   1. Cookies must be forwarded so Cloudflare-protected paths (e.g. /cdn-cgi/
        //      challenge-platform endpoints) authenticate. The previous `rawFetch`
        //      shortcut sent no cookies at all.
        //
        //   2. JS responses must hit our `_liteRewriteJs` (in patchScriptProcessing.js)
        //      so that internal `import('/cdn/assets/...')` calls get prefixed with
        //      the proxy origin + session ID. Without this, every nested dynamic
        //      import 404s and React Router throws "No result found for routeId".
        //
        //   3. Set-Cookie headers from the destination get translated into our shared
        //      cookie store, which keeps cf_clearance / __cf_bm valid across the
        //      session.
        //
        // Hammerhead is fast enough now (with our addJSDiskCache layer caching the
        // rewritten JS), and `_liteRewriteJs` is a tiny string-replace pass, so the
        // overhead vs. rawFetch is negligible.
        const proxiedUrl = `/${info.sessionId}/${info.origin}${url}`;
        req.url = proxiedUrl;

        // Re-inject browser-like headers now that the URL is in proxied form. The
        // earlier injectBrowserLikeHeaders handler ran first (both unshift to the
        // head of the pipeline, with the LAST registered ending up at index 0),
        // saw a "naked" `/path` URL with `isProxiedRequest` returning false, and
        // early-returned without setting any headers. Cloudflare-protected sites
        // (ChatGPT) reject requests missing the Chrome-shaped header set with 404
        // on the challenge-platform endpoint, so we redo the injection here. This
        // also ensures Hammerhead's downstream transforms see a coherent header
        // set keyed off the *destination* origin (e.g. https://chatgpt.com) rather
        // than the proxy's own host.
        try { injectBrowserLikeHeaders(req, false, sessionStore); } catch (_) {}
        return false;
    }, true);

    // Raw proxy mode (Apparatus-style): bypasses hammerhead's JS rewriting entirely.
    // URL format: /SESSION!raw/https://example.com/
    // Serves content with a lightweight bridge script that intercepts fetch/XHR/DOM
    // mutations at runtime instead of rewriting all JS at compile time.
    proxyServer.addToOnRequestPipeline((req, res) => {
        const m = (req.url || '').match(/^\/([a-f0-9]{32})!raw\/(https?:\/\/.+)$/i);
        if (!m) return false;
        const sessionId = m[1];
        const targetUrl = m[2];

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
                'Access-Control-Max-Age': '86400',
            });
            res.end();
            return true;
        }

        const serverInfo = proxyServer.getServerInfo(req);
        const proxyOrigin = `${serverInfo.protocol}//${serverInfo.hostname}${serverInfo.port == 443 || serverInfo.port == 80 ? '' : ':' + serverInfo.port}`;

        function doFetch(body) {
            const extraHeaders = {};
            if (req.headers['content-type']) extraHeaders['Content-Type'] = req.headers['content-type'];
            if (req.headers['accept']) extraHeaders['Accept'] = req.headers['accept'];

            rawFetch(targetUrl, (err, status, headers, respBody) => {
                if (err) { devErr('rawFetch ' + targetUrl, err); try { if (!res.headersSent) { res.writeHead(502); res.end('Raw proxy error: ' + err.message); } } catch(_){} return; }
                const ct = (headers['content-type'] || '').toLowerCase();
                const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');

                if (isHtml && req.method === 'GET') {
                    let html = respBody.toString('utf-8');
                    html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi, '');
                    html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
                    html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');
                    const base = `<base href="${targetUrl.replace(/"/g, '&quot;')}">`;
                    const bridge = buildBridgeScript(proxyOrigin, sessionId + '!raw', targetUrl);
                    const inject = base + bridge;
                    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, '$&' + inject);
                    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, '$&<head>' + inject + '</head>');
                    else html = '<head>' + inject + '</head>' + html;
                    compressAndSend(req, res, 200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*',
                    }, Buffer.from(html, 'utf-8'));
                } else {
                    const outHeaders = {};
                    if (headers['content-type']) outHeaders['Content-Type'] = headers['content-type'];
                    if (headers['cache-control']) outHeaders['Cache-Control'] = headers['cache-control'];
                    outHeaders['Access-Control-Allow-Origin'] = '*';
                    compressAndSend(req, res, status || 200, outHeaders, respBody);
                }
            }, 0, { method: req.method, body: body || undefined, extraHeaders: extraHeaders });
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => doFetch(Buffer.concat(chunks)));
        } else {
            doFetch();
        }
        return true;
    }, true);

    // Console capture endpoint — accepts either the new generic path or the legacy /__rh_console.
    proxyServer.addToOnRequestPipeline((req, res) => {
        if (!_urlMatchesEither(req.url, PROXY_PATHS.console, PROXY_PATHS.consoleLegacy)) return false;
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > 65536) body = body.substring(0, 65536); });
            req.on('end', () => {
                try {
                    const batch = JSON.parse(body);
                    (Array.isArray(batch) ? batch : [batch]).forEach(printConsoleMessage);
                } catch (e) { devErr('console parse', e); }
                res.writeHead(204);
                res.end();
            });
        } else {
            res.writeHead(204);
            res.end();
        }
        return true;
    }, true);

    // Source file fetch endpoint for DevTools Sources tab.
    // GET /__rh_sources?url=<encoded-url> → fetches raw content and returns as text.
    // Handles proxy-rewritten URLs by extracting the real target URL.
    const PROXY_URL_RE = /\/[a-z0-9]{32}(?:![a-z]*)?\/(https?:\/\/.+)/i;
    function _extractRealUrl(url) {
        if (!url) return null;
        if (/^raw!/i.test(url)) url = url.slice(4);
        if (/^data:|^blob:|^javascript:/i.test(url)) return null;
        const m = url.match(PROXY_URL_RE);
        if (m) return m[1];
        if (/^https?:\/\//i.test(url)) return url;
        return null;
    }
    proxyServer.addToOnRequestPipeline((req, res) => {
        if (!_urlMatchesEither(req.url, PROXY_PATHS.sources, PROXY_PATHS.sourcesLegacy)) return false;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' });
            res.end();
            return true;
        }
        try {
            const parsed = new URL(req.url, 'http://localhost');
            const rawParam = parsed.searchParams.get('url');
            if (!rawParam) { res.writeHead(400); res.end('Missing url param'); return true; }

            const targetUrl = _extractRealUrl(rawParam);
            if (!targetUrl) { res.writeHead(400); res.end('Non-fetchable URL'); return true; }

            rawFetch(targetUrl, (err, status, headers, body) => {
                if (err) { devErr('sources fetch', err); try { res.writeHead(502); res.end('Fetch failed: ' + err.message); } catch(_){} return; }
                const ct = headers['content-type'] || 'text/plain';
                compressAndSend(req, res, 200, {
                    'Content-Type': ct,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                }, body);
            });
        } catch (e) {
            devErr('sources', e);
            try { res.writeHead(500); res.end('Error: ' + e.message); } catch(_){}
        }
        return true;
    }, true);

    // Raw content proxy for Apparatus-style iframe blob loading.
    // POST { url, session } → fetches raw HTML, injects <base> + bridge script.
    // Used by the IFRAME_PROXY client-side fallback when hammerhead-processed iframes fail.
    proxyServer.addToOnRequestPipeline((req, res) => {
        if (!_urlMatchesEither(req.url, PROXY_PATHS.raw, PROXY_PATHS.rawLegacy)) return false;

        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
            res.end();
            return true;
        }
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }

        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 4096) body = body.substring(0, 4096); });
        req.on('end', () => {
            let targetUrl, sessionId;
            try { const p = JSON.parse(body); targetUrl = p.url; sessionId = p.session; } catch (e) { devErr('raw parse', e); res.writeHead(400); res.end(); return; }
            if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) { res.writeHead(400); res.end(); return; }

            const serverInfo = proxyServer.getServerInfo(req);
            const proxyOrigin = `${serverInfo.protocol}//${serverInfo.hostname}${serverInfo.port == 443 || serverInfo.port == 80 ? '' : ':' + serverInfo.port}`;

            rawFetch(targetUrl, (err, status, headers, buf) => {
                if (err) { devErr('raw fetch ' + targetUrl, err); try { if (!res.headersSent) { res.writeHead(502); res.end(); } } catch(_){} return; }
                let html = buf.toString('utf-8');
                html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi, '');
                html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
                html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');
                const base = `<base href="${targetUrl.replace(/"/g, '&quot;')}">`;
                const bridge = sessionId ? buildBridgeScript(proxyOrigin, sessionId + '!raw', targetUrl) : '';
                const inject = base + bridge;
                if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, '$&' + inject);
                else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, '$&<head>' + inject + '</head>');
                else html = '<head>' + inject + '</head>' + html;
                compressAndSend(req, res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' }, Buffer.from(html, 'utf-8'));
            });
        });
        return true;
    }, true);

    // Network logging — logs every proxied request with status, type, size, time, and original URL
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (isRoute) return false;
        const m = (req.url || '').match(/^\/[a-z0-9]{32}\/(https?:\/\/.+)$/i);
        if (!m) return false;
        const originalUrl = m[1];
        const start = Date.now();
        let status = 0, ctype = '', size = 0;

        const _writeHead = res.writeHead;
        res.writeHead = function (code, reason, headers) {
            status = code;
            const h = typeof reason === 'object' ? reason : headers;
            if (h) {
                for (const k of Object.keys(h)) {
                    if (k.toLowerCase() === 'content-type') ctype = h[k];
                }
            }
            return _writeHead.apply(this, arguments);
        };
        const _write = res.write;
        res.write = function (chunk) {
            if (chunk) size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            return _write.apply(this, arguments);
        };
        const _end = res.end;
        res.end = function (chunk) {
            if (chunk && chunk.length) size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (!ctype && res.getHeader) ctype = res.getHeader('content-type') || '';
            printNetRequest(status, ctype, size, Date.now() - start, originalUrl);
            return _end.apply(this, arguments);
        };
        return false;
    }, true);

    // Fly.io multi-machine: replay proxy requests to the instance that owns the session (optional, needs Redis)
    proxyServer.addToOnRequestPipeline(async (req, res, _serverInfo, isRoute) => {
        if (!sessionAffinity.isEnabled() || isRoute) return false;
        const pathname = (req.url || '').split('?')[0];
        const sessionId = getSessionId(req.url) || (pathname.match(/\/([a-f0-9]{32})(?:\/|$)/) || [])[1];
        if (!sessionId) return false;
        if (sessionStore.get(sessionId)) return false; // we have it, handle normally
        const targetMachine = await sessionAffinity.getMachineForSession(sessionId);
        if (!targetMachine || targetMachine === sessionAffinity.FLY_MACHINE_ID) return false;
        res.writeHead(307, {
            'Fly-Replay': `instance=${targetMachine}`,
            // Cookie name is generic ("affinity routing") so it doesn't broadcast "rammerhead"
            // when a user inspects their cookie jar. Functionally only used for Fly multi-machine
            // sticky routing — never read back by us.
            'Set-Cookie': `_aff=${sessionId}; Path=/; Max-Age=3600; SameSite=Lax`
        });
        res.end();
        return true;
    }, true);

    // Inject browser-like headers on proxied requests to bypass 403 (Discord, Poki, etc.)
    // Pass sessionStore for Referer/Origin spoofing when URL is shuffled
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo, isRoute) => {
        injectBrowserLikeHeaders(req, isRoute, sessionStore);
        return false;
    }, true);

    // Ensure session is in proxy's openSessions so addUrlShuffling dispatch can unshuffle (avoids 400 when document request arrives before or without shuffleDict)
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo, isRoute) => {
        if (isRoute) return false;
        const sessionId = getSessionId(req.url) || getSessionId(req.headers?.referer || '');
        if (!sessionId || !sessionStore.has(sessionId)) return false;
        if (proxyServer.openSessions.get(sessionId)) return false;
        try {
            const session = sessionStore.get(sessionId);
            if (session && typeof session.serializeSession === 'function') {
                proxyServer.openSessions.addSerializedSession(sessionId, session.serializeSession());
            }
        } catch (e) { devErr('session warm-up', e); }
        return false;
    }, true);

    // task.js / iframe-task.js are served as routes (isRoute=true) so the warm-up above is skipped; warm session from Referer so addUrlShuffling can unshuffle and hammerhead doesn't 500
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo) => {
        let pathname = (req.url || '').split('?')[0];
        try {
            pathname = decodeURIComponent(pathname);
        } catch (_) {}
        if (pathname !== '/task.js' && pathname !== '/iframe-task.js') return false;
        const sessionId = getSessionId(req.headers?.referer || '');
        if (!sessionId || !sessionStore.has(sessionId)) return false;
        if (proxyServer.openSessions.get(sessionId)) return false;
        try {
            const session = sessionStore.get(sessionId);
            if (session && typeof session.serializeSession === 'function') {
                proxyServer.openSessions.addSerializedSession(sessionId, session.serializeSession());
            }
        } catch (e) { devErr('task.js session warm-up', e); }
        return false;
    }, true);

    // Ad Blocker (request-level). Short-circuits requests to ad networks and tracker
    // endpoints with an empty stub (1x1 GIF / empty JS / 204). Matches on the real
    // destination host+path extracted from the proxied URL (including shuffled form).
    // Disabled per-request via the `__rh_ab=0` cookie set by the user settings UI.
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (isRoute) return false;
        if (!req.url || !adBlocker.isEnabledFor(req)) return false;
        const targetUrl = _extractDestForAdBlock(req.url);
        if (!targetUrl) return false;
        if (!adBlocker.shouldBlockUrl(targetUrl)) return false;
        if (process.env.DEVELOPMENT) {
            process.stdout.write(`\x1b[90m[AD-BLOCK]\x1b[0m ${targetUrl.substring(0, 120)}\n`);
        }
        adBlocker.writeBlockedResponse(req, res, targetUrl);
        return true;
    }, true);

    // Google services: bypass broken auth redirect chain by rewriting to direct sign-in URL.
    // accounts.google.com's redirect chain fails with 400 because __Host-GAPS cookies and CSRF
    // tokens get lost. Going directly to /v3/signin/identifier with flowName works.
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (!req.url) return false;
        const GOOGLE_SERVICES_RE = /\/([a-z0-9]{32})\/(https?:\/\/(docs|drive|sheets|slides|forms|sites|keep|calendar|meet|chat|mail|groups|gemini)\.google\.com)(\/.*)?$/i;
        const m = req.url.match(GOOGLE_SERVICES_RE);
        if (m) {
            const [, sessionId, origin] = m;
            const continueUrl = encodeURIComponent(origin + '/');
            const signinUrl = `/${sessionId}/https://accounts.google.com/v3/signin/identifier?continue=${continueUrl}&flowName=GlifWebSignIn&flowEntry=ServiceLogin`;
            res.writeHead(302, { location: signinUrl });
            res.end();
            return true;
        }
        return false;
    }, true);

    // Fix WASM MIME type: Hammerhead may serve .wasm with wrong Content-Type,
    // causing WebAssembly.instantiateStreaming to fail.
    const WASM_URL_RE = /\.wasm(?:\?|$)/i;
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (isRoute) return false;
        if (!WASM_URL_RE.test(req.url || '')) return false;
        const _writeHead = res.writeHead;
        res.writeHead = function (code, reason, headers) {
            const h = typeof reason === 'object' ? reason : headers;
            if (h) {
                if (Array.isArray(h)) {
                    for (let i = 0; i < h.length - 1; i += 2) {
                        if (h[i].toLowerCase() === 'content-type') h[i + 1] = 'application/wasm';
                    }
                } else {
                    const ctKey = Object.keys(h).find(k => k.toLowerCase() === 'content-type');
                    if (ctKey) h[ctKey] = 'application/wasm';
                    else h['Content-Type'] = 'application/wasm';
                }
            }
            return _writeHead.apply(this, arguments);
        };
        return false;
    });

    // remove headers defined in config.js
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (isRoute) return; // only strip those that are going to the proxy destination website

        // restrict session to IP if enabled
        if (config.restrictSessionToIP) {
            const sessionId = getSessionId(req.url);
            const session = sessionId && sessionStore.get(sessionId);
            // Never-expiring sessions bypass IP restriction
            if (session && !session.data.neverExpire && session.data.restrictIP && session.data.restrictIP !== config.getIP(req)) {
                res.writeHead(403);
                res.end('Sessions must come from the same IP');
                return true;
            }
        }

        for (const eachHeader of config.stripClientHeaders) {
            delete req.headers[eachHeader];
        }
        for (const name of PROXY_LEAK_HEADERS) {
            delete req.headers[name];
        }
    });
    Object.assign(proxyServer.rewriteServerHeaders, config.rewriteServerHeaders);
};
