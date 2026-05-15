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
        err.code === 'EPIPE' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'EAI_AGAIN' ||
        err.code === 'ERR_CONTENT_DECODING_FAILED' ||
        err.code === 'Z_BUF_ERROR' ||
        err.code === 'ERR_STREAM_PREMATURE_CLOSE'
    ) {
        return true;
    }
    if (process.env.DEVELOPMENT) {
        console.error('Unknown crash-inducing error:', err.stack || err);
    } else {
        console.error('Unknown crash-inducing error:', err.message);
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
        err.code === 'ERR_HTTP_HEADERS_SENT' ||
        err.message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
        err.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('EAI_AGAIN') ||
        err.message.includes('Z_BUF_ERROR') ||
        err.message.includes('ERR_CONTENT_DECODING_FAILED') ||
        err.message.includes('Unexpected token') ||
        err.message.includes('timed out') ||
        err.code === 'EAI_AGAIN'
    ) {
        if (process.env.DEVELOPMENT) {
            console.error('Avoided crash:', err.stack || err.message);
        } else {
            console.error('Avoided crash:' + err.message);
        }
        return; // swallow the error - don't rethrow
    } else {
        // probably a TypeError or something important - log and exit cleanly instead of crashing
        console.error('Unhandled exception (exiting cleanly): ' + err.message);
        if (process.env.DEVELOPMENT) {
            console.error(err.stack);
        }
        process.exit(1); // Exit with code 1 instead of letting it crash naturally (which causes Fly to see it as a crash)
    }
});
