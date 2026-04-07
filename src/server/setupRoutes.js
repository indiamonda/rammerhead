const generateId = require('../util/generateId');
const URLPath = require('../util/URLPath');
const httpResponse = require('../util/httpResponse');
const config = require('../config');
const StrShuffler = require('../util/StrShuffler');
const RammerheadSession = require('../classes/RammerheadSession');
const sessionAffinity = require('../util/sessionAffinity');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');


/**
 *
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 * @param {import('../classes/RammerheadLogging')} logger
 */
module.exports = function setupRoutes(proxyServer, sessionStore, logger) {
    const _staticCache = new Map();
    const DEV = !!process.env.DEVELOPMENT;
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
                if (!entry) { res.writeHead(404); res.end('Not Found'); return; }
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
            } catch (e) { res.writeHead(500); res.end('Internal Server Error'); }
        };
    }
    proxyServer.GET('/styles.css', serveCached('style.css', 'text/css'));
    proxyServer.GET('/favicon.png', serveCached('favicon.png', 'image/png'));
    proxyServer.GET('/embedded-styles.css', serveCached('embedded-styles.css', 'text/css'));
    proxyServer.GET('/manifest.json', serveCached('manifest.json', 'application/json'));

    // Lightweight health check for Fly.io/Render (avoids loading full index.html)
    proxyServer.GET('/health', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
    });

    // Debug: check if session exists (helps verify Fly single-machine / session lookup)
    proxyServer.GET('/debug-proxy', (req, res) => {
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
        const session = new RammerheadSession();
        session.data.restrictIP = config.getIP(req);

        // workaround for saving the modified session to disk
        sessionStore.addSerializedSession(id, session.serializeSession());
        res.end(id);
    });
    proxyServer.GET('/editsession', (req, res) => {
        if (isNotAuthorized(req, res)) return;

        let { id, httpProxy, enableShuffling } = new URLPath(req.url).getParams();

        if (!id || !sessionStore.has(id)) {
            return httpResponse.badRequest(logger, req, res, config.getIP(req), 'not found');
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
            res.end('not found');
            return;
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
        if (path.startsWith('/rammerhead')) {
            return '/rammerhead';
        }
        return '';
    };
    
    // Route handler - serve public/index.html for root paths
    const handleRoot = (req, res) => {
        try {
            const pathname = req.url.split('?')[0];
            // Only handle root paths
            if (pathname !== '/' && pathname !== '/rammerhead' && pathname !== '/rammerhead/') {
                return; // Let other handlers process this
            }
            
            // Serve public/index.html (browser interface)
            if (config.publicDir) {
                const indexPath = path.join(config.publicDir, 'index.html');
                if (fs.existsSync(indexPath)) {
                    logger.debug(`(handleRoot) Serving public index.html`);
                    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
                    res.end(fs.readFileSync(indexPath));
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
            const basePath = getBasePath(req);
            
            if (!id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Session ID required' }));
                return;
            }
            
            // Check if session exists, create if it doesn't
            if (!sessionStore.has(id)) {
                logger.debug(`(ensureSession) Creating session: ${id}`);
                const session = new RammerheadSession();
                session.data.restrictIP = null;
                session.data.neverExpire = true;
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
                sessionAffinity.registerSessionMachineSync(id);
            } else {
                // Upgrade existing sessions to never-expire and persist immediately
                const session = sessionStore.get(id);
                if (session) {
                    let changed = false;
                    if (!session.data.neverExpire) {
                        session.data.neverExpire = true;
                        changed = true;
                    }
                    if (session.data.restrictIP) {
                        session.data.restrictIP = null;
                        changed = true;
                    }
                    if (changed) {
                        sessionStore.addSerializedSession(id, session.serializeSession());
                    }
                }
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId: id }));
        } catch (error) {
            logger.error(`(ensureSession) Error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
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
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Session ID and URL required' }));
                return;
            }
            
            // Ensure session exists
            if (!sessionStore.has(id)) {
                const session = new RammerheadSession();
                session.data.restrictIP = null;
                session.data.neverExpire = true;
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
                sessionAffinity.registerSessionMachineSync(id);
            }

            // Get session and shuffle URL, persisting any upgrades immediately
            const session = sessionStore.get(id);
            let changed = false;
            if (!session.data.neverExpire) {
                session.data.neverExpire = true;
                changed = true;
            }
            if (session.data.restrictIP) {
                session.data.restrictIP = null;
                changed = true;
            }
            if (!session.shuffleDict) {
                session.shuffleDict = StrShuffler.generateDictionary();
                changed = true;
            }
            if (changed) {
                sessionStore.addSerializedSession(id, session.serializeSession());
            }
            const shuffler = new StrShuffler(session.shuffleDict);
            const shuffledUrl = shuffler.shuffle(normalizedTarget);
            // Use relative URL so browser inherits current page's protocol (fixes mixed content behind Cloudflare Tunnel etc.)
            const proxiedUrl = (basePath ? basePath + '/' : '/') + id + '/' + shuffledUrl;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ proxiedUrl, sessionId: id }));
        } catch (error) {
            logger.error(`(getProxiedUrl) Error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    };
    
    // Register routes - these will handle / and serve index.html
    proxyServer.GET('/', handleRoot);
    proxyServer.GET('/rammerhead', handleRoot);
    proxyServer.GET('/rammerhead/', handleRoot);
    
    // Route to ensure/create session
    proxyServer.GET('/ensuresession', handleEnsureSession);
    proxyServer.GET('/rammerhead/ensuresession', handleEnsureSession);
    
    // Route to get proxied URL
    proxyServer.GET('/getproxiedurl', handleGetProxiedUrl);
    proxyServer.GET('/rammerhead/getproxiedurl', handleGetProxiedUrl);
    
    // Generate never-expire link route - handle both /generatelink and /rammerhead/generatelink
    const handleGenerateLink = (req, res) => {
        try {
            const { url: targetUrl } = new URLPath(req.url).getParams();
            const normalizedTarget = normalizeTargetUrl(targetUrl);
            
            if (!normalizedTarget) {
                logger.error(`(generatelink) ${config.getIP(req)} ${req.url} Must provide url parameter`);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Must provide url parameter' }));
                return;
            }
            
            const id = generateId();
            const session = new RammerheadSession();
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
            const proxiedUrl = (basePath ? basePath + '/' : '/') + id + '/' + shuffledUrl;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ url: proxiedUrl, sessionId: id }));
        } catch (error) {
            logger.error(`(generatelink) ${config.getIP(req)} ${req.url} Error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
        }
    };
    
    proxyServer.GET('/generatelink', handleGenerateLink);
    proxyServer.GET('/rammerhead/generatelink', handleGenerateLink);
    
};
