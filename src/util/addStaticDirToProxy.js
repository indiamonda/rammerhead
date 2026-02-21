const mime = require('mime');
const fs = require('fs');
const path = require('path');

// these routes are reserved by hammerhead and rammerhead
const forbiddenRoutes = [
    '/rammerhead.js',
    '/hammerhead.js',
    '/task.js',
    '/iframe-task.js',
    '/messaging',
    '/transport-worker.js',
    '/worker-hammerhead.js'
];

const isDirectory = (dir) => fs.lstatSync(dir).isDirectory();

/**
 *
 * @param {import('testcafe-hammerhead').Proxy} proxy
 * @param {string} staticDir - all of the files and folders in the specified directory will be served
 * publicly. /index.html will automatically link to /
 * @param {string} rootPath - all the files that will be served under rootPath
 */
function addStaticFilesToProxy(proxy, staticDir, rootPath = '/', shouldIgnoreFile = (_file, _dir) => false) {
    if (!isDirectory(staticDir)) {
        throw new TypeError('specified folder path is not a directory');
    }

    if (!rootPath.endsWith('/')) rootPath = rootPath + '/';
    if (!rootPath.startsWith('/')) rootPath = '/' + rootPath;

    // Re-read directory to pick up new files (like styles.css)
    const files = fs.readdirSync(staticDir);

    files.map((file) => {
        if (isDirectory(path.join(staticDir, file))) {
            addStaticFilesToProxy(proxy, path.join(staticDir, file), rootPath + file + '/', shouldIgnoreFile);
            return;
        }

        if (shouldIgnoreFile(file, staticDir)) {
            return;
        }

        // Skip style.css - it's handled by a custom route to bypass caching
        // But DO serve styles.css (the new path)
        if (file === 'style.css') {
            return;
        }

        const pathToFile = path.join(staticDir, file);
        const route = rootPath + file;

        if (forbiddenRoutes.includes(route)) {
            throw new TypeError(
                `route clashes with hammerhead. problematic route: ${route}. problematic static file: ${pathToFile}`
            );
        }

        // Use a handler function to read files on-demand instead of caching
        const handler = (req, res) => {
            try {
                // Always read fresh from disk
                if (!fs.existsSync(pathToFile)) {
                    res.writeHead(404);
                    res.end('Not Found');
                    return;
                }
                const content = fs.readFileSync(pathToFile);
                const contentType = mime.getType(file) || 'application/octet-stream';
                // Add cache-control headers to prevent caching during development
                res.writeHead(200, { 
                    'Content-Type': contentType,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(content);
            } catch (error) {
                console.error(`Error serving ${pathToFile}:`, error);
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        };

        const route = rootPath + file;
        proxy.GET(route, handler);
        // Log wallpaper routes for debugging
        if (route.includes('/wallpapers/')) {
            console.log(`[Static] Registered wallpaper route: ${route} -> ${pathToFile}`);
        }
        if (file === 'index.html') {
            proxy.GET(rootPath, handler);
        }
    });
}

module.exports = addStaticFilesToProxy;
