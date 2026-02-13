const config = require('../config');
const getSessionId = require('../util/getSessionId');
const fs = require('fs');
const path = require('path');

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
    // Intercept /styles.css requests (new path to bypass cache)
    // Use addToOnRequestPipeline with beginning=true to add it FIRST in the pipeline
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
        // Handle /styles.css requests - check URL path directly
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
                        'Expires': '0',
                        'X-Pipeline-Handler': 'true',
                        'X-File-Size': content.length.toString()
                    });
                    res.end(content);
                    return true; // Signal that we handled this request - stop pipeline
                }
            } catch (error) {
                // If there's an error, let other handlers process it
                console.error('Error serving styles.css from pipeline:', error);
            }
        }
        // For other requests, only process if not a route (to avoid interfering with proxied requests)
        if (isRoute) {
            return false; // Let route handlers process
        }
        return false; // Let other handlers process
    }, true); // beginning=true to add to the START of the pipeline
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
    });
    Object.assign(proxyServer.rewriteServerHeaders, config.rewriteServerHeaders);
};
