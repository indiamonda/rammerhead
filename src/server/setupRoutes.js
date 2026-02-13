const generateId = require('../util/generateId');
const URLPath = require('../util/URLPath');
const httpResponse = require('../util/httpResponse');
const config = require('../config');
const StrShuffler = require('../util/StrShuffler');
const RammerheadSession = require('../classes/RammerheadSession');
const fs = require('fs');
const path = require('path');
const mime = require('mime');

/**
 *
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 * @param {import('../classes/RammerheadLogging')} logger
 */
module.exports = function setupRoutes(proxyServer, sessionStore, logger) {
    // Serve /styles.css (new path) directly to bypass caching - register FIRST
    const stylePath = path.join(config.publicDir, 'style.css');
    logger.info(`(setupRoutes) Registering /styles.css handler, path: ${stylePath}, exists: ${fs.existsSync(stylePath)}`);
    
    const handleStylesCss = (req, res) => {
        // Force fresh read every time - no caching
        try {
            logger.info(`(handleStylesCss) HANDLER CALLED for ${req.url}`);
            if (!config.publicDir) {
                logger.error(`(handleStylesCss) config.publicDir is null`);
                res.writeHead(404);
                res.end('Public dir not configured');
                return;
            }
            const currentStylePath = path.join(config.publicDir, 'style.css');
            if (!fs.existsSync(currentStylePath)) {
                logger.error(`(handleStylesCss) File not found: ${currentStylePath}`);
                res.writeHead(404);
                res.end(`Not Found: ${currentStylePath}`);
                return;
            }
            // Read fresh from disk every time
            const content = fs.readFileSync(currentStylePath);
            const firstChars = content.toString().substring(0, 50);
            logger.info(`(handleStylesCss) Serving file: ${content.length} bytes, starts with: ${firstChars}`);
            res.writeHead(200, { 
                'Content-Type': 'text/css',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Custom-Handler': 'true',
                'X-File-Size': content.length.toString()
            });
            res.end(content);
        } catch (error) {
            logger.error(`(handleStylesCss) Error: ${error.message}`);
            logger.error(`(handleStylesCss) Stack: ${error.stack}`);
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    };
    
    // Register the handler for the new path
    proxyServer.GET('/styles.css', handleStylesCss);
    logger.info(`(setupRoutes) Successfully registered /styles.css handler`);
    
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
                    res.writeHead(200, { 'Content-Type': 'text/html' });
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
                session.data.restrictIP = null; // Don't restrict IP for device sessions
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, sessionId: id }));
        } catch (error) {
            logger.error(`(ensureSession) Error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    };
    
    // Route to get proxied URL with proper shuffling
    const handleGetProxiedUrl = (req, res) => {
        try {
            const { id, url: targetUrl } = new URLPath(req.url).getParams();
            const basePath = getBasePath(req);
            
            if (!id || !targetUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Session ID and URL required' }));
                return;
            }
            
            // Ensure session exists
            if (!sessionStore.has(id)) {
                const session = new RammerheadSession();
                session.data.restrictIP = null;
                session.shuffleDict = StrShuffler.generateDictionary();
                sessionStore.addSerializedSession(id, session.serializeSession());
            }
            
            // Get session and shuffle URL
            const session = sessionStore.get(id);
            if (!session.shuffleDict) {
                session.shuffleDict = StrShuffler.generateDictionary();
            }
            const shuffler = new StrShuffler(session.shuffleDict);
            const shuffledUrl = shuffler.shuffle(targetUrl);
            
            const serverInfo = config.getServerInfo(req);
            const protocol = serverInfo.protocol || 'http:';
            const hostname = serverInfo.hostname || 'localhost';
            const port = serverInfo.port || 8080;
            const portSuffix = (protocol === 'https:' && port === 443) || (protocol === 'http:' && port === 80) ? '' : `:${port}`;
            const proxiedUrl = `${protocol}//${hostname}${portSuffix}${basePath}/${id}/${shuffledUrl}`;
            
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
            
            if (!targetUrl) {
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
            
            // Generate the proxied URL
            const shuffler = new StrShuffler(session.shuffleDict);
            const shuffledUrl = shuffler.shuffle(targetUrl);
            const serverInfo = config.getServerInfo(req);
            const protocol = serverInfo.protocol || 'http:';
            const hostname = serverInfo.hostname || 'localhost';
            const port = serverInfo.port || 8080;
            const portSuffix = (protocol === 'https:' && port === 443) || (protocol === 'http:' && port === 80) ? '' : `:${port}`;
            const basePath = getBasePath(req);
            const proxiedUrl = `${protocol}//${hostname}${portSuffix}${basePath}/${id}/${shuffledUrl}`;
            
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
