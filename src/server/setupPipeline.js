const http = require('http');
const https = require('https');
const zlib = require('zlib');
const config = require('../config');
const getSessionId = require('../util/getSessionId');
const { injectBrowserLikeHeaders } = require('../util/browserLikeHeaders');
const sessionAffinity = require('../util/sessionAffinity');
const fs = require('fs');
const path = require('path');

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
function buildBridgeScript(proxyOrigin, sessionId, targetUrl) {
    return `<script>(function(){
var O=${JSON.stringify(proxyOrigin)},S=${JSON.stringify(sessionId)},D=${JSON.stringify(targetUrl || '')};
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
        rejectUnauthorized: false,
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
    // Relative-path rescue: when Hammerhead fails to process a page (e.g. ChatGPT,
    // Claude), URLs stay as relative paths (/cdn/assets/..., /cdn-cgi/..., etc.).
    // The browser resolves them to http://proxy/path without a session ID.
    // We extract the session from the Referer and rewrite to the correct proxy URL.
    const KNOWN_ROUTE_RE = /^\/(newsession|editsession|deletesession|sessionexists|mainport|needpassword|ensuresession|getproxiedurl|generatelink|health|debug-proxy|syncLocalStorage|api\/shuffleDict|__rh_|styles\.css|favicon|hammerhead\.js|rammerhead\.js|task\.js|iframe-task\.js|[a-f0-9]{32}[\/?!])/i;
    const StrShuffler = require('../util/StrShuffler');

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

    proxyServer.addToOnRequestPipeline((req, res) => {
        const url = req.url || '';
        if (!url.startsWith('/')) return false;
        if (KNOWN_ROUTE_RE.test(url)) return false;
        if (url === '/' || url === '/rammerhead' || url === '/rammerhead/') return false;

        const referer = req.headers['referer'] || '';
        const info = _extractOriginFromReferer(referer);
        if (!info) return false;

        const proxiedUrl = `/${info.sessionId}/${info.origin}${url}`;

        // For script/style resources, 307 redirect so the browser sees the full
        // proxied URL and uses it as Referer for chained imports (ES modules).
        // For everything else (fetch/XHR/navigation), use in-place rewrite to
        // avoid breaking code that uses redirect:'manual' or similar.
        const dest = (req.headers['sec-fetch-dest'] || '').toLowerCase();
        if (dest === 'script' || dest === 'style' || dest === 'worker') {
            res.writeHead(307, { location: proxiedUrl });
            res.end();
            return true;
        }

        req.url = proxiedUrl;
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
                if (err) { devErr('rawFetch ' + targetUrl, err); res.writeHead(502); res.end('Raw proxy error: ' + err.message); return; }
                const ct = (headers['content-type'] || '').toLowerCase();
                const isHtml = ct.includes('text/html') || ct.includes('application/xhtml');

                if (isHtml && req.method === 'GET') {
                    let html = respBody.toString('utf-8');
                    const base = `<base href="${targetUrl.replace(/"/g, '&quot;')}">`;
                    const bridge = buildBridgeScript(proxyOrigin, sessionId + '!raw', targetUrl);
                    const inject = base + bridge;
                    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, '$&' + inject);
                    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, '$&<head>' + inject + '</head>');
                    else html = '<head>' + inject + '</head>' + html;
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(html);
                } else {
                    const outHeaders = {};
                    if (headers['content-type']) outHeaders['Content-Type'] = headers['content-type'];
                    if (headers['cache-control']) outHeaders['Cache-Control'] = headers['cache-control'];
                    outHeaders['Access-Control-Allow-Origin'] = '*';
                    res.writeHead(status || 200, outHeaders);
                    res.end(respBody);
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

    // Console capture endpoint — intercepts /__rh_console at the end of any proxied URL path
    proxyServer.addToOnRequestPipeline((req, res) => {
        if (!req.url || !req.url.includes('/__rh_console')) return false;
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > 65536) body = body.substring(0, 65536); });
            req.on('end', () => {
                try {
                    const batch = JSON.parse(body);
                    (Array.isArray(batch) ? batch : [batch]).forEach(printConsoleMessage);
                } catch (e) { devErr('/__rh_console parse', e); }
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
        if (!req.url || !req.url.includes('/__rh_sources')) return false;
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
                if (err) { devErr('/__rh_sources fetch', err); try { res.writeHead(502); res.end('Fetch failed: ' + err.message); } catch(_){} return; }
                const ct = headers['content-type'] || 'text/plain';
                res.writeHead(200, {
                    'Content-Type': ct,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-store',
                });
                res.end(body);
            });
        } catch (e) {
            devErr('/__rh_sources', e);
            try { res.writeHead(500); res.end('Error: ' + e.message); } catch(_){}
        }
        return true;
    }, true);

    // Raw content proxy for Apparatus-style iframe blob loading.
    // POST { url, session } → fetches raw HTML, injects <base> + bridge script.
    // Used by the IFRAME_PROXY client-side fallback when hammerhead-processed iframes fail.
    proxyServer.addToOnRequestPipeline((req, res) => {
        if (!req.url || !req.url.includes('/__rh_raw')) return false;

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
            try { const p = JSON.parse(body); targetUrl = p.url; sessionId = p.session; } catch (e) { devErr('/__rh_raw parse', e); res.writeHead(400); res.end(); return; }
            if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) { res.writeHead(400); res.end(); return; }

            const serverInfo = proxyServer.getServerInfo(req);
            const proxyOrigin = `${serverInfo.protocol}//${serverInfo.hostname}${serverInfo.port == 443 || serverInfo.port == 80 ? '' : ':' + serverInfo.port}`;

            rawFetch(targetUrl, (err, status, headers, buf) => {
                if (err) { devErr('/__rh_raw fetch ' + targetUrl, err); res.writeHead(502); res.end(); return; }
                let html = buf.toString('utf-8');
                const base = `<base href="${targetUrl.replace(/"/g, '&quot;')}">`;
                const bridge = sessionId ? buildBridgeScript(proxyOrigin, sessionId + '!raw', targetUrl) : '';
                const inject = base + bridge;
                if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, '$&' + inject);
                else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, '$&<head>' + inject + '</head>');
                else html = '<head>' + inject + '</head>' + html;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
                res.end(html);
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
            'Set-Cookie': `rh_sid=${sessionId}; Path=/; Max-Age=3600; SameSite=Lax`
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

    // Intercept /styles.css requests to bypass hammerhead's static content cache
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (!req.url || !config.publicDir) return false;
        const urlPath = req.url.split('?')[0];
        if (urlPath === '/styles.css' || urlPath.endsWith('/styles.css')) {
            try {
                const stylePath = path.join(config.publicDir, 'style.css');
                if (fs.existsSync(stylePath)) {
                    const content = fs.readFileSync(stylePath);
                    res.writeHead(200, { 
                        'Content-Type': 'text/css',
                        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    });
                    res.end(content);
                    return true;
                }
            } catch (error) {
                devErr('styles.css serve', error);
            }
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
