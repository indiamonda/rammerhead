const generateId = require('../util/generateId');
const URLPath = require('../util/URLPath');
const httpResponse = require('../util/httpResponse');
const { sendErrorPage } = require('../util/errorPages');
const config = require('../config');
const StrShuffler = require('../util/StrShuffler');
const StudyBoardSession = require('../classes/StudyBoardSession');
const sessionAffinity = require('../util/sessionAffinity');
const { PROXY_PATHS } = require('../util/patchServiceRoutes');
const ZipWriter = require('../util/zipWriter');
const webBuilder = require('../util/webBuilder');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');


/**
 *
 * @param {import('../classes/StudyBoardGateway')} proxyServer
 * @param {import('../classes/StudyBoardSessionAbstractStore')} sessionStore
 * @param {import('../classes/StudyBoardLogging')} logger
 */
module.exports = function setupRoutes(proxyServer, sessionStore, logger) {
    const CORS_HEADERS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    function jsonResponse(res, status, obj) {
        res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS));
        res.end(JSON.stringify(obj));
    }
    const _staticCache = new Map();
    const DEV = !!process.env.DEVELOPMENT;

    // ─────────────────────────────────────────────────────────────────────
    // KEYWORD-FILTER PREVENTION FOR THE LEARNING-PLATFORM UI ITSELF
    // ─────────────────────────────────────────────────────────────────────
    //
    // public/index.html ships with the runtime mangler (`_t`, `_`) defined
    // up top, and most user-visible strings are already routed through it
    // (the keyword leaks are removed at SOURCE rather than at serve time —
    // see the `_(...)` / `_t(...)` calls inside index.html where literal
    // brand strings used to live).
    //
    // At serve time we (a) strip HTML comments and (b) UglifyJS-strip
    // JS comments + collapse whitespace inside every <script> block.
    // UglifyJS with mangle/compress OFF only removes comments + dead
    // whitespace, so identifiers and template-literal contents are
    // preserved untouched — earlier hand-rolled regex attempts mangled
    // regex character classes and HTML attribute values, but the AST
    // path doesn't have that hazard. If minify fails for any reason
    // we fall back to the original block (safe).
    let _kwSanitizedUI = null;
    const _UglifyForUI = require('uglify-js');
    function _stripScriptCommentsForUI(html) {
        return html.replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g, function (_m, attrs, body) {
            try {
                const out = _UglifyForUI.minify(body, {
                    compress: false,
                    mangle: false,
                    output: { comments: false, beautify: false }
                });
                if (out && !out.error && out.code) {
                    return '<script' + (attrs || '') + '>' + out.code + '</script>';
                }
            } catch (_e) { /* fall through */ }
            return '<script' + (attrs || '') + '>' + body + '</script>';
        });
    }
    function _sanitizeUIKeywords(html) {
        if (typeof html !== 'string' || !html) return html;
        // Strip HTML comments.
        let out = html.replace(/<!--[\s\S]*?-->/g, '');
        // Strip JS comments inside <script> blocks via the AST minifier.
        out = _stripScriptCommentsForUI(out);

        // Inject <base href="/"> right after <head> so relative asset paths
        // (favicon.png, embedded-styles.css, manifest.json, ...) resolve from
        // the origin root regardless of the URL the page is served at. This
        // is critical when STEALTH_PORTAL is set — without it, /go/ would
        // try to load /go/embedded-styles.css and break all styling.
        if (!/<base\b[^>]*>/i.test(out)) {
            out = out.replace(/<head(\s[^>]*)?>/i, function (m) { return m + '<base href="/">'; });
        }
        return out;
    }
    const _BR = config.brand + '_';
    const _brandSub = (s) => s.replace(/__SBRAND__/g, _BR);
    function _serveSanitizedUI(res, contents) {
        if (!_kwSanitizedUI) {
            try { _kwSanitizedUI = _brandSub(_sanitizeUIKeywords(contents.toString('utf8'))); }
            catch (_) { _kwSanitizedUI = _brandSub(contents.toString('utf8')); }
        }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
        res.end(_kwSanitizedUI);
    }
    function _getCached(filePath, contentType) {
        let e = _staticCache.get(filePath);
        if (e) return e;
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath);
        const etag = '"' + crypto.createHash('md5').update(raw).digest('hex') + '"';
        const gz = /text|css|json|javascript|xml|svg/i.test(contentType) && raw.length > 512
            ? zlib.gzipSync(raw, { level: 6 }) : null;
        e = { raw, gz, etag, contentType };
        _staticCache.set(filePath, e);
        if (DEV) try { fs.watchFile(filePath, { interval: 2000 }, () => _staticCache.delete(filePath)); } catch(_){}
        return e;
    }
    function serveCached(filename, contentType) {
        const filePath = path.join(config.publicDir, filename);
        return (req, res) => {
            try {
                const entry = _getCached(filePath, contentType);
                if (!entry) { sendErrorPage(req, res, 404, { detail: req.url }); return; }
                if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); res.end(); return; }
                const ae = (req.headers['accept-encoding'] || '').toLowerCase();
                const useGz = ae.includes('gzip') && entry.gz;
                const body = useGz ? entry.gz : entry.raw;
                const hdrs = {
                    'Content-Type': entry.contentType,
                    'Content-Length': body.length,
                    'ETag': entry.etag,
                    'Cache-Control': DEV ? 'no-cache' : 'public, max-age=3600, stale-while-revalidate=86400',
                };
                if (useGz) { hdrs['Content-Encoding'] = 'gzip'; hdrs['Vary'] = 'Accept-Encoding'; }
                res.writeHead(200, hdrs);
                if (req.method !== 'HEAD') res.end(body); else res.end();
            } catch (e) {
                sendErrorPage(req, res, 500, { detail: e && e.message });
            }
        };
    }
    proxyServer.GET('/styles.css', serveCached('style.css', 'text/css'));
    proxyServer.GET('/favicon.png', serveCached('favicon.png', 'image/png'));
    proxyServer.GET('/embedded-styles.css', serveCached('embedded-styles.css', 'text/css'));
    proxyServer.GET('/manifest.json', serveCached('manifest.json', 'application/json'));
    proxyServer.GET('/bot-shield.js', serveCached('bot-shield.js', 'application/javascript'));
    // Devtools script: served under a generic CDN-shaped path only.
    // Brand-substituted so __SBRAND__ tokens become the active brand prefix.
    let _devtoolsCache = null;
    proxyServer.GET(PROXY_PATHS.devtoolsJs, (req, res) => {
        try {
            if (!_devtoolsCache) {
                const fp = path.join(config.publicDir, 'devtools.js');
                _devtoolsCache = _brandSub(fs.readFileSync(fp, 'utf8'));
            }
            const ae = (req.headers['accept-encoding'] || '').toLowerCase();
            const body = Buffer.from(_devtoolsCache, 'utf8');
            if (ae.includes('gzip') && body.length > 512) {
                const gz = zlib.gzipSync(body, { level: 6 });
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Content-Encoding': 'gzip',
                    'Content-Length': gz.length,
                    'Cache-Control': DEV ? 'no-cache' : 'public, max-age=3600',
                    'Vary': 'Accept-Encoding',
                });
                res.end(gz);
            } else {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Content-Length': body.length,
                    'Cache-Control': DEV ? 'no-cache' : 'public, max-age=3600',
                });
                res.end(body);
            }
        } catch (e) {
            sendErrorPage(req, res, 500, { detail: e && e.message });
        }
    });

    // Lightweight health check for Fly.io/Render (avoids loading full index.html)
    proxyServer.GET('/health', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
    });

    // Debug: check if session exists (helps verify Fly single-machine / session lookup)
    proxyServer.GET('/debug-status', (req, res) => {
        const id = (new URLPath(req.url).getParams().id || '').trim().slice(0, 32);
        const hasSession = id && id.length === 32 && sessionStore.has(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            sessionId: id || null,
            hasSession: !!hasSession,
            sessionCount: sessionStore.keys().length
        }));
    });

    const isNotAuthorized = (req, res) => {
        if (!config.password) return;
        const { pwd } = new URLPath(req.url).getParams();
        if (config.password !== pwd) {
            httpResponse.accessForbidden(logger, req, res, config.getIP(req), 'bad password');
            return true;
        }
        return false;
    };
    if (process.env.DEVELOPMENT) {
        proxyServer.GET('/garbageCollect', (req, res) => {
            global.gc();
            res.end('Ok');
        });
    }
    proxyServer.GET('/needpassword', (req, res) => {
        res.end(config.password ? 'true' : 'false');
    });
    proxyServer.GET('/newsession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        const id = generateId();
        const session = new StudyBoardSession();
        session.data.restrictIP = config.getIP(req);

        sessionStore.addSerializedSession(id, session.serializeSession());
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, CORS_HEADERS));
        res.end(id);
    });
    proxyServer.GET('/editsession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        let { id, httpProxy, enableShuffling } = new URLPath(req.url).getParams();

        if (!id || !sessionStore.has(id)) {
            return httpResponse.notFound(logger, req, res, config.getIP(req), 'session not found');
        }

        const session = sessionStore.get(id);

        if (httpProxy) {
            if (httpProxy.startsWith('http://')) {
                httpProxy = httpProxy.slice(7);
            }
            session.setExternalProxySettings(httpProxy);
        } else {
            session.externalProxySettings = null;
        }
        if (enableShuffling === '1' && !session.shuffleDict) {
            session.shuffleDict = StrShuffler.generateDictionary();
        }
        if (enableShuffling === '0') {
            session.shuffleDict = null;
        }

        res.end('Success');
    });
    proxyServer.GET('/deletesession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        const { id } = new URLPath(req.url).getParams();

        if (!id || !sessionStore.has(id)) {
            return httpResponse.notFound(logger, req, res, config.getIP(req), 'session not found');
        }

        sessionStore.delete(id);
        res.end('Success');
    });
    proxyServer.GET('/sessionexists', (req, res) => {
        const id = new URLPath(req.url).get('id');
        if (!id) {
            httpResponse.badRequest(logger, req, res, config.getIP(req), 'Must specify id parameter');
        } else {
            res.end(sessionStore.has(id) ? 'exists' : 'not found');
        }
    });
    proxyServer.GET('/mainport', (req, res) => {
        const serverInfo = config.getServerInfo(req);
        res.end((serverInfo.port || '').toString());
    });
    
    // Helper function to get base path from request
    const getBasePath = (req) => {
        const path = req.url.split('?')[0]; // Get path without query params
        if (path.startsWith('/studyboard')) {
            return '/studyboard';
        }
        return '';
    };

    // Pluggable URL path style. When `config.pathStyle` is configured (e.g.
    // "cdn-cgi/p"), every URL we emit for a new/proxied session must include
    // the prefix so the user-visible URL bar (and any URL-pattern filter)
    // sees a CDN-shaped path instead of `/<sid>/<destination>`. See
    // src/server/setupPipeline.js for the matching incoming-strip logic.
    const _pathStyle = (config.pathStyle || '').replace(/^\/+|\/+$/g, '');
    const _pathPrefix = _pathStyle ? '/' + _pathStyle : '';
    
    // ── Homepage stealth-mode ──────────────────────────────────────────────
    // When config.stealthPortal (or env STEALTH_PORTAL) is set, the bare origin
    // and well-known landing paths return a generic "service is up" cover page
    // so that scanners crawling https://<host>/ see nothing identifiable. The
    // real proxy UI is reachable only at /<token> (and /studyboard/<token>).
    // Existing /<sessionId>/<destination> share links are unaffected because
    // session IDs (32-char hex) are routed by hammerhead's session pipeline,
    // not by this handler.
    // Accept the portal token either as "portal42" or "/portal42" — we strip
    // surrounding slashes so the route registration below never produces
    // "//portal42" (which would 404 because `req.url` is single-slash).
    const _stealthPortal = ((config.stealthPortal || '').trim().replace(/^\/+|\/+$/g, '')) || null;
    // Pure-HTML cover page. No JS, no fonts, no external resources, no proxy/
    // unblock/session keywords. Looks like a brand-new domain placeholder
    // for an early-stage learning project.
    // The cover page has a discreet "Continue" link that takes real users to
    // the configured stealth portal. Since the link target is the portal token
    // (which the operator chose), bots/filters scanning the page see only a
    // generic relative href like "/go" — no proxy/session/unblock keywords.
    const _portalHref = _stealthPortal ? '/' + _stealthPortal + '/' : '/';
    const COVER_HTML = [
        '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="robots" content="noindex,nofollow">',
        '<title>Welcome</title>',
        '<style>',
        ':root{--bg:#fafafa;--fg:#1a1a1a;--mu:#666;--ac:#2563eb}',
        '@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#e5e5e5;--mu:#888;--ac:#60a5fa}}',
        '*{box-sizing:border-box}',
        'html,body{margin:0;padding:0;height:100%}',
        'body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg)}',
        'main{min-height:100vh;display:grid;place-items:center;padding:24px}',
        '.c{max-width:480px;text-align:center}',
        'h1{font-size:32px;margin:0 0 12px;font-weight:600}',
        'p{color:var(--mu);margin:0 0 16px}',
        '.dot{display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;margin-right:8px;vertical-align:middle}',
        'a{color:var(--ac);text-decoration:none;font-weight:500}',
        'a:hover{text-decoration:underline}',
        '</style></head><body>',
        '<main><section class="c">',
        '<h1>Welcome</h1>',
        '<p><span class="dot"></span> Service is available.</p>',
        '<p><a href="' + _portalHref + '">Continue &rarr;</a></p>',
        '</section></main></body></html>',
    ].join('');

    function _serveCover(res) {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(COVER_HTML),
            'Cache-Control': 'public, max-age=3600',
            'X-Robots-Tag': 'noindex, nofollow',
        });
        res.end(COVER_HTML);
    }

    function _serveRealUI(req, res) {
        if (!config.publicDir) { sendErrorPage(req, res, 404, { detail: req.url }); return; }
        const indexPath = path.join(config.publicDir, 'index.html');
        if (!fs.existsSync(indexPath)) { sendErrorPage(req, res, 404, { detail: req.url }); return; }
        _serveSanitizedUI(res, fs.readFileSync(indexPath));
    }

    // Hosts the real proxy UI under /<token> (and base-path-prefixed equivalents).
    // We use exact path matching against the configured token so a typo doesn't
    // leak the cover page through.
    function _isPortalPath(pathname) {
        if (!_stealthPortal) return false;
        const t = _stealthPortal;
        return (
            pathname === '/' + t ||
            pathname === '/' + t + '/' ||
            pathname === '/studyboard/' + t ||
            pathname === '/studyboard/' + t + '/'
        );
    }

    // Paths that should serve the cover page (instead of the real UI) when
    // stealth-mode is enabled. Covers both the bare origin and the
    // well-known landing paths an indexer might probe.
    const STEALTH_COVERED_PATHS = new Set([
        '/', '/index.html', '/index.htm',
        '/studyboard', '/studyboard/', '/studyboard/index.html', '/studyboard/index.htm',
    ]);

    // Route handler — serves cover OR real UI depending on stealth-mode + path.
    const handleRoot = (req, res) => {
        try {
            const pathname = req.url.split('?')[0];

            if (_stealthPortal) {
                if (_isPortalPath(pathname)) { _serveRealUI(req, res); return; }
                if (STEALTH_COVERED_PATHS.has(pathname)) { _serveCover(res); return; }
                return; // not ours; let pipeline / other handlers see it
            }

            // Stealth disabled: original behaviour — bare origin + base-path
            // alias serve the proxy UI directly.
            if (pathname !== '/' && pathname !== '/studyboard' && pathname !== '/studyboard/') {
                return;
            }
            if (config.publicDir) {
                const indexPath = path.join(config.publicDir, 'index.html');
                if (fs.existsSync(indexPath)) {
                    logger.debug(`(handleRoot) Serving public index.html`);
                    _serveSanitizedUI(res, fs.readFileSync(indexPath));
                    return;
                }
            }
        } catch (error) {
            logger.error(`(handleRoot) Error: ${error.message}`);
            logger.error(error.stack);
        }
    };
    
    // Route to ensure/create a session (called by client when needed)
    const handleEnsureSession = (req, res) => {
        try {
            const { id } = new URLPath(req.url).getParams();
            
            if (!id) {
                return jsonResponse(res, 400, { error: 'Session ID required' });
            }
            
            // Check if session exists, create if it doesn't
            if (!sessionStore.has(id)) {
                logger.debug(`(ensureSession) Creating session: ${id}`);
                const session = new StudyBoardSession();
                session.data.restrictIP = null;
                session.data.neverExpire = true;
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
                sessionAffinity.registerSessionMachineSync(id);
            } else {
                const session = sessionStore.get(id);
                if (session) {
                    let changed = false;
                    if (!session.data.neverExpire) { session.data.neverExpire = true; changed = true; }
                    if (session.data.restrictIP) { session.data.restrictIP = null; changed = true; }
                    if (changed) sessionStore.addSerializedSession(id, session.serializeSession());
                }
            }
            
            jsonResponse(res, 200, { success: true, sessionId: id });
        } catch (error) {
            logger.error(`(ensureSession) Error: ${error.message}`);
            jsonResponse(res, 500, { error: error.message });
        }
    };
    
    // Normalize root URLs with trailing slash (helps YouTube, Bilibili, Douyin, Twitch)
    const normalizeTargetUrl = (raw) => {
        if (!raw || typeof raw !== 'string') return raw;
        try {
            const u = new URL(raw.trim());
            if (u.pathname === '' || u.pathname === '/') return u.origin + '/' + (u.search || '') + (u.hash || '');
        } catch (_) {}
        return raw;
    };

    // Route to get proxied URL with proper shuffling
    const handleGetProxiedUrl = (req, res) => {
        try {
            const { id, url: targetUrl } = new URLPath(req.url).getParams();
            const basePath = getBasePath(req);
            const normalizedTarget = normalizeTargetUrl(targetUrl);
            
            if (!id || !normalizedTarget) {
                return jsonResponse(res, 400, { error: 'Session ID and URL required' });
            }
            
            // Ensure session exists
            if (!sessionStore.has(id)) {
                const session = new StudyBoardSession();
                session.data.restrictIP = null;
                session.data.neverExpire = true;
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
                sessionAffinity.registerSessionMachineSync(id);
            }

            const session = sessionStore.get(id);
            let changed = false;
            if (!session.data.neverExpire) { session.data.neverExpire = true; changed = true; }
            if (session.data.restrictIP) { session.data.restrictIP = null; changed = true; }
            if (!session.shuffleDict) { session.shuffleDict = StrShuffler.generateDictionary(); changed = true; }
            if (changed) sessionStore.addSerializedSession(id, session.serializeSession());

            const shuffler = new StrShuffler(session.shuffleDict);
            const shuffledUrl = shuffler.shuffle(normalizedTarget);
            const proxiedUrl = (basePath || '') + _pathPrefix + '/' + id + '/' + shuffledUrl;
            
            jsonResponse(res, 200, { proxiedUrl, sessionId: id });
        } catch (error) {
            logger.error(`(getProxiedUrl) Error: ${error.message}`);
            jsonResponse(res, 500, { error: error.message });
        }
    };
    
    // Register routes - these will handle / and serve index.html
    proxyServer.GET('/', handleRoot);
    proxyServer.GET('/studyboard', handleRoot);
    proxyServer.GET('/studyboard/', handleRoot);

    // When stealth-mode is on, override the well-known landing paths
    // (/index.html, /studyboard/index.html, ...) so addStaticDirToProxy's
    // automatic /index.html route can't leak the real UI, and register the
    // secret portal path that DOES serve the real UI.
    if (_stealthPortal) {
        proxyServer.GET('/index.html', handleRoot);
        proxyServer.GET('/index.htm', handleRoot);
        proxyServer.GET('/studyboard/index.html', handleRoot);
        proxyServer.GET('/studyboard/index.htm', handleRoot);
        proxyServer.GET('/' + _stealthPortal, handleRoot);
        proxyServer.GET('/' + _stealthPortal + '/', handleRoot);
        proxyServer.GET('/studyboard/' + _stealthPortal, handleRoot);
        proxyServer.GET('/studyboard/' + _stealthPortal + '/', handleRoot);
        logger.info(`Stealth-mode portal enabled. Real UI: /${_stealthPortal}`);
    }
    
    // Route to ensure/create session
    proxyServer.GET('/ensuresession', handleEnsureSession);
    proxyServer.GET('/studyboard/ensuresession', handleEnsureSession);
    
    // Route to get proxied URL
    proxyServer.GET('/getresourceurl', handleGetProxiedUrl);
    proxyServer.GET('/studyboard/getresourceurl', handleGetProxiedUrl);
    
    // Generate never-expire link route - handle both /generatelink and /studyboard/generatelink
    const handleGenerateLink = (req, res) => {
        try {
            const { url: targetUrl } = new URLPath(req.url).getParams();
            const normalizedTarget = normalizeTargetUrl(targetUrl);
            
            if (!normalizedTarget) {
                logger.error(`(generatelink) ${config.getIP(req)} ${req.url} Must provide url parameter`);
                return jsonResponse(res, 400, { error: 'Must provide url parameter' });
            }
            
            const id = generateId();
            const session = new StudyBoardSession();
            // Don't restrict IP for never-expiring links so they work from anywhere
            session.data.restrictIP = null;
            session.data.neverExpire = true; // Mark as never-expiring
            
            // Enable shuffling by default for better compatibility
            session.shuffleDict = StrShuffler.generateDictionary();
            
            sessionStore.addSerializedSession(id, session.serializeSession());
            sessionAffinity.registerSessionMachineSync(id);
            
            // Generate the proxied URL
            const shuffler = new StrShuffler(session.shuffleDict);
            const shuffledUrl = shuffler.shuffle(normalizedTarget);
            const basePath = getBasePath(req);
            const proxiedUrl = (basePath || '') + _pathPrefix + '/' + id + '/' + shuffledUrl;
            
            jsonResponse(res, 200, { url: proxiedUrl, sessionId: id });
        } catch (error) {
            logger.error(`(generatelink) ${config.getIP(req)} ${req.url} Error: ${error.message}`);
            jsonResponse(res, 500, { error: error.message || 'Internal server error' });
        }
    };
    
    proxyServer.GET('/generatelink', handleGenerateLink);
    proxyServer.GET('/studyboard/generatelink', handleGenerateLink);

    // ── Stealth route aliases ────────────────────────────────────────────
    // Short, CDN-looking aliases for every API route. These look like
    // static asset or analytics endpoints, making URL-pattern filters
    // unable to fingerprint them. The canonical names above still work
    // (for backward compat), but the client UI should prefer these.
    proxyServer.GET('/_a/ns', (req, res) => { // newsession
        if (isNotAuthorized(req, res)) return;
        const id = generateId();
        const session = new StudyBoardSession();
        session.data.restrictIP = config.getIP(req);
        sessionStore.addSerializedSession(id, session.serializeSession());
        res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, CORS_HEADERS));
        res.end(id);
    });
    proxyServer.GET('/_a/es', handleEnsureSession);       // ensuresession
    proxyServer.GET('/_a/ru', handleGetProxiedUrl);        // getresourceurl
    proxyServer.GET('/_a/gl', handleGenerateLink);         // generatelink
    proxyServer.GET('/_a/se', (req, res) => {              // sessionexists
        const id = new URLPath(req.url).get('id');
        if (!id) {
            httpResponse.badRequest(logger, req, res, config.getIP(req), 'Must specify id parameter');
        } else {
            res.end(sessionStore.has(id) ? 'exists' : 'not found');
        }
    });
    proxyServer.GET('/_a/np', (req, res) => {              // needpassword
        res.end(config.password ? 'true' : 'false');
    });
    proxyServer.GET('/_a/mp', (req, res) => {              // mainport
        const serverInfo = config.getServerInfo(req);
        res.end((serverInfo.port || '').toString());
    });

    // ── Web-build-files export ──────────────────────────────────────────
    // Two-phase API:
    //   GET /buildwebfiles?url=…&probe=1   – validate the URL only; returns
    //                                        JSON {ok,...} or {ok:false,reason}.
    //                                        The UI uses this to drive the
    //                                        "invalid link" shake/glow.
    //   GET /buildwebfiles?url=…           – stream a .zip back. Decides on
    //                                        STATIC (external crawl) vs
    //                                        LOCAL (this server's source
    //                                        tree) based on whether the URL
    //                                        host matches our own host.
    //
    // The whole feature lives entirely behind GET so it works unchanged
    // through any ingress/CDN that doesn't permit POST.
    function _selfHosts(req) {
        const set = new Set();
        try {
            const info = config.getServerInfo(req);
            if (info && info.hostname) {
                set.add(String(info.hostname).toLowerCase());
                if (info.port) set.add((info.hostname + ':' + info.port).toLowerCase());
            }
        } catch (_) { /* getServerInfo may throw before headers are ready */ }
        const hostHeader = (req.headers && req.headers.host || '').toLowerCase();
        if (hostHeader) {
            set.add(hostHeader);
            const i = hostHeader.indexOf(':');
            if (i > 0) set.add(hostHeader.slice(0, i));
        }
        // Local development always counts as "self".
        set.add('localhost');
        set.add('127.0.0.1');
        set.add('0.0.0.0');
        return set;
    }

    function _isSelfUrl(absoluteUrl, req) {
        try {
            const u = new URL(absoluteUrl);
            const selves = _selfHosts(req);
            return selves.has(u.host.toLowerCase()) || selves.has(u.hostname.toLowerCase());
        } catch (_) {
            return false;
        }
    }

    function _normalizeTargetForBuild(raw) {
        if (!raw || typeof raw !== 'string') return null;
        let value = raw.trim();
        if (value.startsWith('raw!')) value = value.slice(4);
        if (!/^https?:\/\//i.test(value)) {
            // Heuristic: bare host like "example.com" -> https
            if (/^[a-z0-9][a-z0-9-]{0,61}(\.[a-z0-9-]+)+([/?#].*)?$/i.test(value)) {
                value = 'https://' + value;
            } else if (/^localhost(:\d+)?([/?#].*)?$/i.test(value)) {
                value = 'http://' + value;
            } else {
                return null;
            }
        }
        try {
            const u = new URL(value);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
            return u.href;
        } catch (_) { return null; }
    }

    function _safeFilename(s) {
        return String(s || 'site').replace(/[^a-z0-9\-_.]+/gi, '_').slice(0, 64) || 'site';
    }

    const handleBuildWebFiles = (req, res) => {
        const params = new URLPath(req.url).getParams();
        const targetUrl = _normalizeTargetForBuild(params.url);
        const isProbe = params.probe === '1' || params.probe === 'true';
        const forceMode = (params.mode || '').toLowerCase(); // optional override: 'static'|'local'
        // Modal flags. All are coerced to boolean here so downstream
        // builders don't have to defensively re-parse strings.
        const useServer = params.useServer === '1' || params.useServer === 'true';
        const noLimit   = params.noLimit   === '1' || params.noLimit   === 'true';
        const single    = params.single    === '1' || params.single    === 'true';
        const customFilename = _safeFilename(params.filename || '');

        if (!targetUrl) {
            return jsonResponse(res, 400, {
                ok: false,
                code: 'INVALID_URL',
                reason: 'The link entered is not a valid URL. Please enter a URL like https://example.com/.'
            });
        }

        // Probe phase: only verify reachability, no zip — the UI uses
        // this to play the shake animation before committing to a
        // download.
        if (isProbe) {
            (async () => {
                try {
                    if (_isSelfUrl(targetUrl, req)) {
                        return jsonResponse(res, 200, { ok: true, mode: forceMode === 'static' ? 'static' : 'local', url: targetUrl });
                    }
                    const result = await webBuilder.probeUrl(targetUrl);
                    if (result.statusCode >= 400) {
                        return jsonResponse(res, 200, {
                            ok: false,
                            code: 'NOT_FOUND',
                            statusCode: result.statusCode,
                            reason: 'The page at that URL responded with HTTP ' + result.statusCode + '. Please check the link and try again.'
                        });
                    }
                    return jsonResponse(res, 200, { ok: true, mode: forceMode === 'local' ? 'local' : 'static', url: targetUrl });
                } catch (e) {
                    logger.warn(`(buildwebfiles probe) ${config.getIP(req)} ${targetUrl} ${e && e.message}`);
                    return jsonResponse(res, 200, {
                        ok: false,
                        code: 'UNREACHABLE',
                        reason: 'The link entered is invalid or unreachable: ' + (e && e.message ? e.message : 'unknown error')
                    });
                }
            })();
            return;
        }

        // Build phase — we stream the response directly to the client.
        // Errors partway through can't change the response code (we've
        // already sent 200), so for a bad URL we 400 *first*, before
        // any bytes go out, by reusing the probe.
        (async () => {
            const isSelf = _isSelfUrl(targetUrl, req);
            const mode = forceMode === 'static' ? 'static'
                : forceMode === 'local' ? 'local'
                : isSelf ? 'local' : 'static';
            // Single-file build is static-only.
            const singleFile = single && mode === 'static';

            if (mode === 'static') {
                try {
                    const probe = await webBuilder.probeUrl(targetUrl);
                    if (probe.statusCode >= 400) {
                        return jsonResponse(res, 400, {
                            ok: false,
                            code: 'NOT_FOUND',
                            statusCode: probe.statusCode,
                            reason: 'The page at that URL responded with HTTP ' + probe.statusCode + '.'
                        });
                    }
                } catch (e) {
                    return jsonResponse(res, 400, {
                        ok: false,
                        code: 'UNREACHABLE',
                        reason: 'The link entered is invalid or unreachable: ' + (e && e.message ? e.message : 'unknown error')
                    });
                }
            }

            let host = 'site';
            try { host = new URL(targetUrl).hostname; } catch (_) { /* keep default */ }
            const baseName = customFilename
                || (mode === 'local' ? 'studyboard-source' : _safeFilename(host) + '-webbuild-' + new Date().toISOString().slice(0, 10));

            // Asset budgets — bumped to "effectively unlimited" when
            // the user opted in via the modal toggle. We use a finite
            // (but enormous) value so range-comparisons keep working.
            const NO_LIMIT = Number.MAX_SAFE_INTEGER;

            // For "Use their server" mode we mint a fresh studyboard
            // session right here. The build embeds a small bridge
            // script that prefixes every fetch / XHR / WS URL with
            // `<host>/<sessionId>/`, which is the only path layout
            // the studyboard URL router actually understands. Without
            // a session ID the proxy 404s every request, so the
            // bridge would be effectively a no-op.
            let proxySessionId = null;
            if (useServer) {
                try {
                    proxySessionId = generateId();
                    const session = new StudyBoardSession();
                    // Don't IP-lock: the deployed copy might run from
                    // anywhere. We accept the looser security posture
                    // here because the user opted in by ticking the
                    // toggle.
                    sessionStore.addSerializedSession(proxySessionId, session.serializeSession());
                } catch (e) {
                    logger.warn(`(buildwebfiles) failed to mint proxy session: ${e && e.message}`);
                    proxySessionId = null;
                }
            }

            const staticOpts = {
                useServer,
                proxyHostHeader: req.headers && req.headers.host,
                proxySessionId,
                proxyProtocol: (req.headers['x-forwarded-proto'] || (req.connection && req.connection.encrypted ? 'https' : 'http'))
            };
            if (noLimit) {
                staticOpts.maxTotalBytes = NO_LIMIT;
                staticOpts.maxPerFileBytes = NO_LIMIT;
                staticOpts.maxPages = 100000;
                staticOpts.maxDepth = 32;
                staticOpts.totalTimeoutMs = 60 * 60 * 1000; // 1h
            }
            const localOpts = noLimit
                ? { publicMaxBytes: NO_LIMIT, restMaxBytes: NO_LIMIT }
                : {};

            // ── Single-file path ────────────────────────────────────
            // Returns a single text/html document with everything
            // inlined. Streamed via res.end() because the builder
            // collects into a buffer first (single-file inherently
            // requires the full DOM in memory to inline base64 data).
            if (singleFile) {
                try {
                    const html = await webBuilder.buildSingleFileSite(targetUrl, staticOpts);
                    res.writeHead(200, Object.assign({
                        'Content-Type': 'text/html; charset=utf-8',
                        'Content-Disposition': 'attachment; filename="' + baseName + '.html"',
                        'Cache-Control': 'no-store',
                        'X-Web-Build-Mode': 'static-single',
                        'Content-Length': Buffer.byteLength(html)
                    }, CORS_HEADERS));
                    res.end(html);
                    return;
                } catch (e) {
                    logger.error(`(buildwebfiles single) ${config.getIP(req)} ${targetUrl} ${e && e.message}`);
                    // No bytes have gone out yet — JSON-error politely.
                    return jsonResponse(res, 500, {
                        ok: false,
                        code: 'BUILD_FAILED',
                        reason: 'Build failed: ' + (e && e.message ? e.message : 'unknown error')
                    });
                }
            }

            // ── ZIP path (default) ─────────────────────────────────
            res.writeHead(200, Object.assign({
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="' + baseName + '.zip"',
                'Cache-Control': 'no-store',
                'X-Web-Build-Mode': mode + (useServer ? '+useServer' : '') + (noLimit ? '+noLimit' : '')
            }, CORS_HEADERS));

            const zip = new ZipWriter(res, { compressLevel: 6 });

            try {
                if (mode === 'local') {
                    await webBuilder.buildLocalSite(zip, Object.assign({
                        projectRoot: path.resolve(__dirname, '..', '..'),
                        publicDir: config.publicDir
                    }, localOpts));
                } else {
                    await webBuilder.buildStaticSite(targetUrl, zip, staticOpts);
                }
                await zip.finish();
            } catch (e) {
                logger.error(`(buildwebfiles) ${config.getIP(req)} ${targetUrl} ${e && e.message}`);
                // Best-effort: append an error note inside the zip and close.
                try {
                    await zip.add('ERROR.txt',
                        Buffer.from('Export aborted: ' + (e && e.message ? e.message : 'unknown error') + '\n', 'utf8'));
                    await zip.finish();
                } catch (_) {
                    try { res.end(); } catch (__) { /* response already gone */ }
                }
            }
        })();
    };

    proxyServer.GET('/buildwebfiles', handleBuildWebFiles);
    proxyServer.GET('/studyboard/buildwebfiles', handleBuildWebFiles);

};
