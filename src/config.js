const path = require('path');
const fs = require('fs');
const os = require('os');
const RammerheadJSMemCache = require('./classes/RammerheadJSMemCache.js');
const RammerheadJSFileCache = require('./classes/RammerheadJSFileCache.js');

// Disable workers for Node.js v24+ compatibility (sticky-session-custom has issues)
const enableWorkers = false; // os.cpus().length !== 1;

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
        const protocol = req?.socket?.encrypted ? 'https:' : 'http:';
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
    // recommended: 50mb for memory, 5gb for disk
    // Using memory cache for better performance
    jsCache: new RammerheadJSMemCache(100 * 1024 * 1024), // 100MB memory cache for faster performance
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
    rewriteServerHeaders: {},

    //// SESSION STORE CONFIG ////

    // see src/classes/RammerheadSessionFileCache.js for more details and options
    fileCacheSessionConfig: {
        saveDirectory: path.join(__dirname, '../sessions'),
        cacheTimeout: 1000 * 60 * 30, // 30 minutes (increased for better performance)
        cacheCheckInterval: 1000 * 60 * 15, // 15 minutes (less frequent checks)
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
    logLevel: process.env.DEVELOPMENT ? 'debug' : 'info',
    generatePrefix: (level) => `[${new Date().toISOString()}] [${level.toUpperCase()}] `,

    // logger depends on this value
    getIP: (req) => req.socket.remoteAddress
    // use the example below if rammerhead is sitting behind a reverse proxy like nginx
    // getIP: req => (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim()
};

if (fs.existsSync(path.join(__dirname, '../config.js'))) Object.assign(module.exports, require('../config'));
