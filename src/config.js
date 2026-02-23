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
    // Use same port for crossDomain in cloud deployments (most platforms don't allow multiple ports)
    crossDomainPort: process.env.PORT ? parseInt(process.env.PORT) : 8081,
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
        const hostHeader = req?.headers?.host || 'localhost:8080';
        const [hostname, port] = hostHeader.split(':');
        const isEncrypted = req?.socket?.encrypted ||
            (isCloudDeployment && req?.headers?.['x-forwarded-proto'] === 'https');
        const protocol = isEncrypted ? 'https:' : 'http:';
        return {
            hostname: hostname || 'localhost',
            port: parseInt(port || (protocol === 'https:' ? 443 : 80)),
            crossDomainPort: parseInt(port || (protocol === 'https:' ? 443 : 80)),
            protocol
        };
    },

    // enforce a password for creating new sessions. set to null to disable
    password: null,

    // disable or enable localStorage sync (turn off if clients send over huge localStorage data, resulting in huge memory usages)
    disableLocalStorageSync: false,

    // restrict sessions to be only used per IP
    restrictSessionToIP: true,

    // caching options for js rewrites. (disk caching not recommended for slow HDD disks)
    // recommended: 50mb for memory, 5gb for disk. Larger = more cache hits, less rewriting
    jsCache: new RammerheadJSMemCache(200 * 1024 * 1024), // 200MB for faster repeat visits
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
    // cspCompatibilityMode: true = relax CSP for Discord, Poki, jmail (slower). false = minimal rewrite (faster)
    cspCompatibilityMode: true,
    rewriteServerHeaders: {
        'x-frame-options': null, // remove to allow loading in iframes
        'content-security-policy': (value) => {
            if (!value) return undefined;
            const compat = module.exports.cspCompatibilityMode;
            let csp = value.replace(/frame-ancestors[^;]*(;|$)/gi, '').trim();
            if (compat) {
                csp = csp
                    .replace(/worker-src\s+([^;]*)(;|$)/gi, (m, s) => (/blob:/.test(s) && /'self'|self/.test(s) ? m : `worker-src 'self' blob: ${s.trim()};`))
                    .replace(/script-src\s+([^;]*)(;|$)/gi, (m, s) => {
                        const x = s.trim();
                        if (/'unsafe-inline'/.test(x) && /'unsafe-eval'/.test(x)) return m;
                        return `script-src ${x}${/'unsafe-inline'/.test(x) ? '' : " 'unsafe-inline'"}${/'unsafe-eval'/.test(x) ? '' : " 'unsafe-eval'"};`;
                    })
                    .replace(/connect-src\s+([^;]*)(;|$)/gi, (m, s) => (/\*/.test(s) ? m : `connect-src ${s.trim()} blob: wss: ws:;`));
            }
            return csp || undefined;
        },
    },

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 60, // 1 hour - keep sessions in memory longer, fewer disk reads
        cacheCheckInterval: 1000 * 60 * 30, // 30 minutes (less frequent disk writes)
        deleteUnused: true,
        staleCleanupOptions: {
            staleTimeout: 1000 * 60 * 60 * 24 * 3, // 3 days
            maxToLive: null,
            staleCheckInterval: 1000 * 60 * 60 * 12 // 12 hours (less frequent cleanup)
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
