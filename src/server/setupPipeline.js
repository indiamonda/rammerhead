const config = require('../config');
const getSessionId = require('../util/getSessionId');
const fs = require('fs');
const path = require('path');
const mime = require('mime');

/**
 * @param {import('../classes/RammerheadProxy')} proxyServer
 * @param {import('../classes/RammerheadSessionAbstractStore')} sessionStore
 */
module.exports = function setupPipeline(proxyServer, sessionStore) {
    // Intercept /styles.css requests (new path to bypass cache)
    // Use addToOnRequestPipeline with beginning=true to add it FIRST in the pipeline
    // This MUST run before hammerhead's static content cache
    proxyServer.addToOnRequestPipeline(async (req, res, _serverInfo, isRoute) => {
        // Handle /styles.css requests - check URL path directly (don't check isRoute, handle all requests to this path)
        const urlPath = req.url.split('?')[0];
        if (urlPath === '/styles.css' || urlPath.endsWith('/styles.css')) {
            try {
                const stylePath = path.join(config.publicDir, 'style.css');
                console.log(`[Pipeline] Handling /styles.css, file exists: ${fs.existsSync(stylePath)}`);
                if (fs.existsSync(stylePath)) {
                    const content = fs.readFileSync(stylePath);
                    console.log(`[Pipeline] Serving styles.css: ${content.length} bytes`);
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
                } else {
                    console.error(`[Pipeline] styles.css file not found at: ${stylePath}`);
                }
            } catch (error) {
                // If there's an error, let other handlers process it
                console.error('[Pipeline] Error serving styles.css:', error);
            }
        }
        
        // Handle wallpaper requests - serve from public/wallpapers or assets/wallpapers directory
        if (urlPath.startsWith('/wallpapers/') || urlPath.startsWith('/rammerhead/wallpapers/')) {
            try {
                // Remove /rammerhead prefix if present
                const cleanPath = urlPath.replace(/^\/rammerhead/, '');
                const fileName = cleanPath.replace('/wallpapers/', '');
                
                // Only allow .jpg and .png files for security
                if (!fileName.match(/^[0-9]+\.(jpg|png)$/i)) {
                    return false; // Let other handlers process invalid filenames
                }
                
                // Try public/wallpapers first (preferred location)
                let filePath = null;
                if (config.publicDir) {
                    const publicWallpaperPath = path.join(config.publicDir, 'wallpapers', fileName);
                    if (fs.existsSync(publicWallpaperPath)) {
                        filePath = publicWallpaperPath;
                    }
                }
                
                // Fallback to assets/wallpapers if not in public
                if (!filePath) {
                    const assetsWallpaperPath = path.join(__dirname, '../../assets/wallpapers', fileName);
                    if (fs.existsSync(assetsWallpaperPath)) {
                        filePath = assetsWallpaperPath;
                    }
                }
                
                if (filePath && fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath);
                    res.writeHead(200, {
                        'Content-Type': mime.getType(fileName) || 'image/jpeg',
                        'Cache-Control': 'public, max-age=31536000' // Cache wallpapers for 1 year
                    });
                    res.end(content);
                    return true; // Signal that we handled this request
                }
            } catch (error) {
                console.error(`[Pipeline] Error serving wallpaper: ${error.message}`);
            }
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
