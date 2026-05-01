// handle the additional errors: ERR_INVALID_PROTOCOL and ETIMEDOUT
// hammerhead handled errors: ECONNRESET, EPIPE (or ECONNABORTED for windows)

const hGuard = require('testcafe-hammerhead/lib/request-pipeline/connection-reset-guard');
const isConnectionResetError = hGuard.isConnectionResetError;
hGuard.isConnectionResetError = function (err) {
    // for some reason, ECONNRESET isn't handled correctly
    if (
        isConnectionResetError(err) ||
        err.code === 'ERR_INVALID_PROTOCOL' ||
        err.code === 'ERR_UNESCAPED_CHARACTERS' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE'
    ) {
        return true;
    }
    if (process.env.DEVELOPMENT) {
        console.error('Unknown crash-inducing error:', err.stack || err);
    } else {
        console.error('Unknown crash-inducing error:', err);
    }
    return true;
};

process.on('uncaughtException', (err) => {
    // for some reason, the above never catches all of the errors. this is a last resort failsafe
    if (
        err.message.includes('ECONN') ||
        err.message.includes('EPIPE') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ERR_INVALID_') ||
        err.message.includes('ERR_UNESCAPED_CHARACTERS') ||
        err.code === 'ERR_UNESCAPED_CHARACTERS' ||
        err.message.includes('ERR_HTTP_HEADERS_SENT') ||
        err.code === 'ERR_HTTP_HEADERS_SENT'
    ) {
        if (process.env.DEVELOPMENT) {
            console.error('Avoided crash:', err.stack || err.message);
        } else {
            console.error('Avoided crash:' + err.message);
        }
    } else {
        // probably a TypeError or something important
        console.error('About to throw: ' + err.message);
        throw err;
    }
});

process.on('unhandledRejection', (reason, promise) => {
    if (process.env.DEVELOPMENT) {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    } else {
        console.error('Unhandled Rejection:', reason);
    }
});
