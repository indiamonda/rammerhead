const path = require('path');
const fs = require('fs');
const os = require('os');
const RammerheadJSMemCache = require('./classes/RammerheadJSMemCache.js');
const RammerheadJSFileCache = require('./classes/RammerheadJSFileCache.js');

// Disable workers for Node.js v24+ compatibility (sticky-session-custom has issues)
const enableWorkers = false; // os.cpus().length !== 1;

// Auto-detect cloud/reverse-proxy environments (Render, Fly.io, Heroku, etc.)
const isCloudDeployment = !!(
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.DYNO ||
    process.env.CLOUD_DEPLOYMENT
);

module.exports = {
    //// HOSTING CONFIGURATION ////

    bindingAddress: '0.0.0.0',
    port: process.env.PORT || 8080,
    // In cloud/reverse-proxy environments, use single-port mode (crossDomainPort=null) to avoid EADDRINUSE.
    // For local/dev, keep a separate crossDomainPort like upstream (8081).
    crossDomainPort: isCloudDeployment ? null : 8081,
    publicDir: path.join(__dirname, '../public'), // set to null to disable

    // enable or disable multithreading
    enableWorkers,
    workers: os.cpus().length,

    // ssl object is either null or { key: fs.readFileSync('path/to/key'), cert: fs.readFileSync('path/to/cert') }
    // for more info, see https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener
    ssl: null,

    // this function's return object will determine how the client url rewriting will work.
    // set them differently from bindingAddress and port if rammerhead is being served
    // from a reverse proxy.
    getServerInfo: (req) => {
        const hostHeader = (req?.headers?.host || '').trim() || 'localhost:8080';
        const colonIdx = hostHeader.indexOf(':');
        const hostname = colonIdx >= 0 ? hostHeader.slice(0, colonIdx).trim() : hostHeader.trim();
        const portStr = colonIdx >= 0 ? hostHeader.slice(colonIdx + 1).trim() : '';
        let isEncrypted = req?.socket?.encrypted || req?.headers?.['x-forwarded-proto'] === 'https';
        if (!isEncrypted && req?.headers?.['cf-visitor']) {
            try {
                const cf = JSON.parse(req.headers['cf-visitor']);
                if (cf?.scheme === 'https') isEncrypted = true;
            } catch (_) {}
        }
        // Behind a reverse proxy (cloud): force HTTPS for any non-local host so rewrite URLs are correct
        if (!isEncrypted && isCloudDeployment && hostname && hostname !== 'localhost' && !/^127\.\d+\.\d+\.\d+$/.test(hostname)) {
            isEncrypted = true;
        }
        const protocol = isEncrypted ? 'https:' : 'http:';
        const defaultPort = protocol === 'https:' ? 443 : 80;
        const port = parseInt(portStr, 10);
        const resolvedPort = Number.isInteger(port) && port > 0 ? port : defaultPort;
        return {
            hostname: hostname || 'localhost',
            port: resolvedPort,
            crossDomainPort: resolvedPort,
            protocol
        };
    },

    // enforce a password for creating new sessions. set to null to disable
    password: null,

    // disable or enable localStorage sync (turn off if clients send over huge localStorage data, resulting in huge memory usages)
    disableLocalStorageSync: false,

    // restrict sessions to be only used per IP (disabled in cloud: Fly/Render can vary x-forwarded-for)
    restrictSessionToIP: !isCloudDeployment,

    // caching options for js rewrites. (disk caching not recommended for slow HDD disks)
    // recommended: 50mb for memory, 5gb for disk. Larger = more cache hits, less rewriting
    jsCache: new RammerheadJSMemCache(25 * 1024 * 1024), // 25MB – keep low on 512MB Fly VMs to avoid OOM
    // jsCache: new RammerheadJSFileCache(path.join(__dirname, '../cache-js'), 5 * 1024 * 1024 * 1024, 50000, enableWorkers),

    // whether to disable http2 support or not (from proxy to destination site).
    // disabling may reduce number of errors/memory, but also risk
    // removing support for picky sites like web.whatsapp.com that want
    // the client to connect to http2 before connecting to their websocket
    disableHttp2: false,

    //// REWRITE HEADER CONFIGURATION ////

    // removes reverse proxy headers
    // cloudflare example:
    // stripClientHeaders: ['cf-ipcountry', 'cf-ray', 'x-forwarded-proto', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop', 'x-forwarded-for'],
    stripClientHeaders: [],
    // if you want to modify response headers, like removing the x-frame-options header, do it like so:
    // rewriteServerHeaders: {
    //     // you can also specify a function to modify/add the header using the original value (undefined if adding the header)
    //     // 'x-frame-options': (originalHeaderValue) => '',
    //     'x-frame-options': null, // set to null to tell rammerhead that you want to delete it
    // },
    rewriteServerHeaders: {
        'x-frame-options': null,
        'content-security-policy': () => undefined,
        'content-security-policy-report-only': () => undefined,
        'x-content-security-policy': () => undefined,
    },

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: process.env.FLY_APP_NAME ? '/data/sessions' : path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 20, // 20 min – evict idle sessions from RAM sooner on 512MB VMs
        cacheCheckInterval: 1000 * 60 * 10, // 10 min
        deleteUnused: true,
        staleCleanupOptions: {
            staleTimeout: 1000 * 60 * 60 * 24, // 1 day
            maxToLive: null,
            staleCheckInterval: 1000 * 60 * 60 * 6 // 6 hours
        },
        // corrupted session files happens when nodejs exits abruptly while serializing the JSON sessions to disk
        deleteCorruptedSessions: true,
    },

    //// LOGGING CONFIGURATION ////

    // valid values: 'disabled', 'debug', 'traffic', 'info', 'warn', 'error'
    logLevel: process.env.DEVELOPMENT ? 'debug' : 'warn', // 'warn' reduces log overhead vs 'info'
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // logger depends on this value
    // Cloud deployments sit behind a reverse proxy, so use x-forwarded-for to get the real client IP
    getIP: isCloudDeployment
        ? (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
        : (req) => req.socket.remoteAddress
};

if (fs.existsSync(path.join(__dirname, '../config.js'))) Object.assign(module.exports, require('../config'));
