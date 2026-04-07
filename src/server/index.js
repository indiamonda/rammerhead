const cluster = require('cluster');
const os = require('os');
try { require('dotenv-flow').config(); } catch (_) {}

const useCluster = !process.env.DEVELOPMENT && os.cpus().length > 1;

if (useCluster && cluster.isPrimary) {
    const numWorkers = Math.min(os.cpus().length, 4);
    console.log(`[master] Forking ${numWorkers} workers...`);
    for (let i = 0; i < numWorkers; i++) cluster.fork();
    cluster.on('exit', (worker, code) => {
        console.log(`[master] Worker ${worker.process.pid} exited (code ${code}), restarting...`);
        cluster.fork();
    });
} else {
    const exitHook = require('async-exit-hook');
    const fs = require('fs');
    const path = require('path');
    const RammerheadProxy = require('../classes/RammerheadProxy');
    const addStaticDirToProxy = require('../util/addStaticDirToProxy');
    const RammerheadSessionFileCache = require('../classes/RammerheadSessionFileCache');
    const config = require('../config');
    const setupRoutes = require('./setupRoutes');
    const setupPipeline = require('./setupPipeline');
    const RammerheadLogging = require('../classes/RammerheadLogging');

    const wid = useCluster ? `(w${cluster.worker.id}) ` : '';
    const logger = new RammerheadLogging({
        logLevel: config.logLevel,
        generatePrefix: (level) => wid + config.generatePrefix(level)
    });

    const proxyServer = new RammerheadProxy({
        logger,
        loggerGetIP: config.getIP,
        bindingAddress: config.bindingAddress,
        port: config.port,
        crossDomainPort: config.crossDomainPort,
        dontListen: false,
        ssl: config.ssl,
        getServerInfo: config.getServerInfo,
        disableLocalStorageSync: config.disableLocalStorageSync,
        jsCache: config.jsCache,
        disableHttp2: config.disableHttp2
    });

    const fileCacheOptions = { logger, ...config.fileCacheSessionConfig };
    if (useCluster) fileCacheOptions.staleCleanupOptions = null;
    const sessionStore = new RammerheadSessionFileCache(fileCacheOptions);
    sessionStore.attachToProxy(proxyServer);

    setupPipeline(proxyServer, sessionStore);
    if (config.publicDir) addStaticDirToProxy(proxyServer, config.publicDir);
    setupRoutes(proxyServer, sessionStore, logger);

    exitHook(() => {
        logger.info(`(server) Received exit signal, closing proxy server`);
        proxyServer.close();
        logger.info('(server) Closed proxy server');
    });

    const formatUrl = (secure, hostname, port) => `${secure ? 'https' : 'http'}://${hostname}:${port}`;
    logger.info(
        `${wid}Rammerhead proxy is listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`
    );

    module.exports = proxyServer;
}
