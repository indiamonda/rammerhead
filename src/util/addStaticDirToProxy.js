const mime = require('mime');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const { NEW_PATHS, OLD_PATHS, PROXY_PATHS } = require('./patchServiceRoutes');
const { sendErrorPage } = require('./errorPages');

const forbiddenRoutes = [
    OLD_PATHS.hammerhead, OLD_PATHS.task, OLD_PATHS.iframeTask,
    OLD_PATHS.messaging, OLD_PATHS.transportWorker, OLD_PATHS.workerHammerhead,
    NEW_PATHS.hammerhead, NEW_PATHS.task, NEW_PATHS.iframeTask,
    NEW_PATHS.messaging, NEW_PATHS.transportWorker, NEW_PATHS.workerHammerhead,
    PROXY_PATHS.studyboardJs, PROXY_PATHS.devtoolsJs, PROXY_PATHS.console,
    PROXY_PATHS.raw, PROXY_PATHS.sources, PROXY_PATHS.shuffleDict,
];

const isDirectory = (dir) => fs.lstatSync(dir).isDirectory();

const fileCache = new Map();
const DEV = !!process.env.DEVELOPMENT;

function getCachedFile(filePath, contentType) {
    let entry = fileCache.get(filePath);
    if (entry) return entry;

    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath);
    const etag = '"' + crypto.createHash('md5').update(raw).digest('hex') + '"';
    const isCompressible = /text|javascript|json|xml|svg|css|html/i.test(contentType);
    const gzipped = isCompressible && raw.length > 1024
        ? zlib.gzipSync(raw, { level: 6 })
        : null;
    entry = { raw, gzipped, etag, contentType };
    fileCache.set(filePath, entry);

    if (DEV) {
        try { fs.watchFile(filePath, { interval: 2000 }, () => fileCache.delete(filePath)); } catch (_) {}
    }
    return entry;
}

/**
 * @param {import('testcafe-hammerhead').Proxy} proxy
 * @param {string} staticDir
 * @param {string} rootPath
 */
function addStaticFilesToProxy(proxy, staticDir, rootPath = '/', shouldIgnoreFile = (_file, _dir) => false) {
    if (!isDirectory(staticDir)) {
        throw new TypeError('specified folder path is not a directory');
    }

    if (!rootPath.endsWith('/')) rootPath = rootPath + '/';
    if (!rootPath.startsWith('/')) rootPath = '/' + rootPath;

    const files = fs.readdirSync(staticDir);

    files.map((file) => {
        if (isDirectory(path.join(staticDir, file))) {
            addStaticFilesToProxy(proxy, path.join(staticDir, file), rootPath + file + '/', shouldIgnoreFile);
            return;
        }

        if (shouldIgnoreFile(file, staticDir)) return;
        if (file === 'style.css') return;
        if (file === 'background.png') return;

        const pathToFile = path.join(staticDir, file);
        const route = rootPath + file;

        if (forbiddenRoutes.includes(route)) {
            throw new TypeError(
                `route clashes with hammerhead. problematic route: ${route}. problematic static file: ${pathToFile}`
            );
        }

        const contentType = mime.getType(file) || 'application/octet-stream';

        const handler = (req, res) => {
            try {
                const entry = getCachedFile(pathToFile, contentType);
                if (!entry) {
                    sendErrorPage(req, res, 404, { detail: req.url });
                    return;
                }

                if (req.headers['if-none-match'] === entry.etag) {
                    res.writeHead(304);
                    res.end();
                    return;
                }

                const ae = (req.headers['accept-encoding'] || '').toLowerCase();
                const useGzip = ae.includes('gzip') && entry.gzipped;
                const body = useGzip ? entry.gzipped : entry.raw;

                const headers = {
                    'Content-Type': entry.contentType,
                    'Content-Length': body.length,
                    'ETag': entry.etag,
                    'Cache-Control': DEV ? 'no-cache' : 'public, max-age=3600, stale-while-revalidate=86400',
                    'Access-Control-Allow-Origin': '*',
                };
                if (useGzip) {
                    headers['Content-Encoding'] = 'gzip';
                    headers['Vary'] = 'Accept-Encoding';
                }
                res.writeHead(200, headers);
                if (req.method !== 'HEAD') res.end(body);
                else res.end();
            } catch (error) {
                sendErrorPage(req, res, 500, { detail: error && error.message });
            }
        };

        proxy.GET(route, handler);
        if (file === 'index.html') {
            proxy.GET(rootPath, handler);
        }
    });
}

module.exports = addStaticFilesToProxy;
