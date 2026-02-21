const config = require('../config');
const getSessionId = require('../util/getSessionId');
const fs = require('fs');
const path = require('path');

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
    // Intercept /styles.css requests to bypass hammerhead's static content cache
    proxyServer.addToOnRequestPipeline((req, res, _serverInfo, isRoute) => {
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
    });
    Object.assign(proxyServer.rewriteServerHeaders, config.rewriteServerHeaders);
};
