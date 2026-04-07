const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary || cluster.isMaster) {
    try { require('dotenv-flow').config(); } catch (e) {}
}

const config = require('../config');

if (config.enableWorkers && (cluster.isPrimary || cluster.isMaster)) {
    const numWorkers = Math.min(config.workers || os.cpus().length, os.cpus().length);
    console.log(`[master] Forking ${numWorkers} workers on port ${config.port}`);
    for (let i = 0; i < numWorkers; i++) cluster.fork();
    cluster.on('exit', (worker, code) => {
        console.log(`[master] Worker ${worker.process.pid} exited (code=${code}), restarting`);
        cluster.fork();
    });
} else {
    const exitHook = require('async-exit-hook');
    const fs = require('fs');
    const path = require('path');
    const RammerheadProxy = require('../classes/RammerheadProxy');
    const addStaticDirToProxy = require('../util/addStaticDirToProxy');
    const RammerheadSessionFileCache = require('../classes/RammerheadSessionFileCache');
    const setupRoutes = require('./setupRoutes');
    const setupPipeline = require('./setupPipeline');
    const RammerheadLogging = require('../classes/RammerheadLogging');

    const workerId = config.enableWorkers ? `(worker ${cluster.worker.id}) ` : '';

    const logger = new RammerheadLogging({
        logLevel: config.logLevel,
        generatePrefix: (level) => workerId + config.generatePrefix(level)
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
    if (config.enableWorkers) {
        fileCacheOptions.staleCleanupOptions = null;
    }
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
        `(server) Rammerhead proxy is listening on ${formatUrl(config.ssl, config.bindingAddress, config.port)}`
    );

    module.exports = proxyServer;
}
