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

const ANSI = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', white: '\x1b[37m', magenta: '\x1b[35m' };
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
    'font/woff2': 'woff2', 'font/woff': 'woff', 'application/octet-stream': 'bin' };

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

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
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
                } catch (_) {}
                res.writeHead(204);
                res.end();
            });
        } else {
            res.writeHead(204);
            res.end();
        }
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
        } catch (_) { /* ignore */ }
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
        } catch (_) { /* ignore */ }
        return false;
    }, true);

    // Google services: bypass broken auth redirect chain by rewriting to direct sign-in URL.
    // accounts.google.com's redirect chain fails with 400 because __Host-GAPS cookies and CSRF
    // tokens get lost. Going directly to /v3/signin/identifier with flowName works.
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        if (!req.url) return false;
        const GOOGLE_SERVICES_RE = /\/([a-z0-9]{32})\/(https?:\/\/(docs|drive|sheets|slides|forms|sites|keep|calendar|meet|chat|mail|groups)\.google\.com)(\/.*)?$/i;
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
                // Let other handlers process it
            }
        }
        return false;
    }, true);
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
