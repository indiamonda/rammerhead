const cluster = require('cluster');
if (cluster.isMaster) {
    require('dotenv-flow').config();
}

const exitHook = require('async-exit-hook');
const sticky = require('sticky-session-custom');
const fs = require('fs');
const path = require('path');
const mime = require('mime');
const RammerheadProxy = require('../classes/RammerheadProxy');
const addStaticDirToProxy = require('../util/addStaticDirToProxy');
const RammerheadSessionFileCache = require('../classes/RammerheadSessionFileCache');
const config = require('../config');
const setupRoutes = require('./setupRoutes');
const setupPipeline = require('./setupPipeline');
const RammerheadLogging = require('../classes/RammerheadLogging');
const getSessionId = require('../util/getSessionId');

const prefix = config.enableWorkers ? (cluster.isMaster ? '(master) ' : `(${cluster.worker.id}) `) : '';

const logger = new RammerheadLogging({
    logLevel: config.logLevel,
    generatePrefix: (level) => prefix + config.generatePrefix(level)
});

const proxyServer = new RammerheadProxy({
    logger,
    loggerGetIP: config.getIP,
    bindingAddress: config.bindingAddress,
    port: config.port,
    crossDomainPort: config.crossDomainPort,
    dontListen: config.enableWorkers,
    ssl: config.ssl,
    getServerInfo: config.getServerInfo,
    disableLocalStorageSync: config.disableLocalStorageSync,
    jsCache: config.jsCache,
    disableHttp2: config.disableHttp2
});

const fileCacheOptions = { logger, ...config.fileCacheSessionConfig };
if (!cluster.isMaster) {
    fileCacheOptions.staleCleanupOptions = null;
}
const sessionStore = new RammerheadSessionFileCache(fileCacheOptions);
sessionStore.attachToProxy(proxyServer);

setupPipeline(proxyServer, sessionStore);
// Register static files FIRST
if (config.publicDir) addStaticDirToProxy(proxyServer, config.publicDir);
// Register routes AFTER static files - this allows us to override specific routes
setupRoutes(proxyServer, sessionStore, logger);
// Override style.css route AFTER everything to ensure it takes precedence
const fs = require('fs');
const path = require('path');
const stylePath = path.join(config.publicDir, 'style.css');
if (fs.existsSync(stylePath)) {
    logger.info(`(server) Overriding /style.css route to serve fresh content`);
    const handleStyleCss = (req, res) => {
        try {
            const content = fs.readFileSync(stylePath);
            res.writeHead(200, { 
                'Content-Type': 'text/css',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Override-Handler': 'true',
                'X-File-Size': content.length.toString()
            });
            res.end(content);
        } catch (error) {
            logger.error(`(server) Error serving style.css: ${error.message}`);
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    };
    // Override the route - this should take precedence over cached static content
    proxyServer.GET('/style.css', handleStyleCss);
    logger.info(`(server) Successfully overrode /style.css route`);
}

// nicely close proxy server and save sessions to store before we exit
exitHook(() => {
    logger.info(`(server) Received exit signal, closing proxy server`);
    proxyServer.close();
    logger.info('(server) Closed proxy server');
});

if (!config.enableWorkers) {
    const formatUrl = (secure, hostname, port) => `${secure ? 'https' : 'http'}://${hostname}:${port}`;
    logger.info(
        `(server) Rammerhead proxy is listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`
    );
}

// spawn workers if multithreading is enabled //
if (config.enableWorkers) {
    /**
     * @type {import('sticky-session-custom/lib/sticky/master').MasterOptions}
     */
    const stickyOptions = {
        workers: config.workers,
        generatePrehashArray(req) {
            let sessionId = getSessionId(req.url); // /sessionid/url
            if (!sessionId) {
                // /editsession?id=sessionid
                const parsed = new URL(req.url, 'https://a.com');
                sessionId = parsed.searchParams.get('id') || parsed.searchParams.get('sessionId');
                if (!sessionId) {
                    // sessionId is in referer header
                    for (let i = 0; i < req.headers.length; i += 2) {
                        if (req.headers[i].toLowerCase() === 'referer') {
                            sessionId = getSessionId(req.headers[i + 1]);
                            break;
                        }
                    }
                    if (!sessionId) {
                        // if there is still none, it's likely a static asset, in which case,
                        // just delegate it to a worker
                        sessionId = ' ';
                    }
                }
            }
            return sessionId.split('').map((e) => e.charCodeAt());
        }
    };
    logger.info(JSON.stringify({ port: config.port, crossPort: config.crossDomainPort, master: cluster.isMaster }));
    const closeMasters = [sticky.listen(proxyServer.server1, config.port, config.bindingAddress, stickyOptions)];
    if (config.crossDomainPort) {
        closeMasters.push(
            sticky.listen(proxyServer.server2, config.crossDomainPort, config.bindingAddress, stickyOptions)
        );
    }

    if (closeMasters[0]) {
        // master process //
        const formatUrl = (secure, hostname, port) => `${secure ? 'https' : 'http'}://${hostname}:${port}`;
        logger.info(
            `Rammerhead proxy load balancer is listening on ${formatUrl(
                config.ssl,
                config.bindingAddress,
                config.port
            )}`
        );

        // nicely close proxy server and save sessions to store before we exit
        exitHook(async (done) => {
            logger.info('Master received exit signal. Shutting down workers');
            for (const closeMaster of closeMasters) {
                await new Promise((resolve) => closeMaster(resolve));
            }
            logger.info('Closed all workers');
            done();
        });
    } else {
        logger.info(`Worker ${cluster.worker.id} is running`);
    }
}

// if you want to just extend the functionality of this proxy server, you can
// easily do so using this. mainly used for debugging
module.exports = proxyServer;
