const config = require('../config');
const getSessionId = require('../util/getSessionId');
const { injectBrowserLikeHeaders } = require('../util/browserLikeHeaders');
const sessionAffinity = require('../util/sessionAffinity');
const fs = require('fs');
const path = require('path');

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
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

    // jimmyqrg.github.io: root and /page/ need ?page=extend for iframe content; rewrite to avoid blank
    proxyServer.addToOnRequestPipeline((req, _res, _serverInfo) => {
        if (!req.url) return false;
        const pathOnly = req.url.split('?')[0];
        const qs = req.url.includes('?') ? '&' + req.url.split('?')[1] : '';
        const mRoot = pathOnly.match(/^\/([a-z0-9]{32})\/(https?:\/\/jimmyqrg\.github\.io)\/?$/i);
        const mPage = pathOnly.match(/^\/([a-z0-9]{32})\/(https?:\/\/jimmyqrg\.github\.io)\/page\/?$/i);
        if (mRoot) {
            const [, sessionId, origin] = mRoot;
            req.url = `/${sessionId}/${origin}/page/?page=extend${qs}`;
        } else if (mPage && !req.url.includes('page=extend')) {
            const [, sessionId, origin] = mPage;
            req.url = `/${sessionId}/${origin}/page/?page=extend${qs}`;
        }
        return false;
    }, true);

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
