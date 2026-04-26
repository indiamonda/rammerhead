/**
 * Thin wrappers around the most-used HTTP error responses.
 *
 * Every helper:
 *   • Logs the failure (caller, IP, URL, message) at error level.
 *   • Delegates the actual write to {@link sendErrorPage}, which negotiates
 *     between a styled HTML page (browser navigations) and a one-line plain
 *     text body (curl / XHR / fetch consumers).
 *
 * Existing call sites kept their `(logger, req, res, ip, msg)` signature so
 * this is a drop-in replacement; the new helpers (notFound, unauthorized, …)
 * follow the same convention so adding new error responses stays mechanical.
 *
 * @typedef {'badRequest'|'unauthorized'|'paymentRequired'|'accessForbidden'|'notFound'|'methodNotAllowed'|'tooManyRequests'|'internalServerError'|'badGateway'|'serviceUnavailable'|'gatewayTimeout'} httpResponseTypes
 */

const { sendErrorPage } = require('./errorPages');

function makeHandler(status, label) {
    return (logger, req, res, ip, msg) => {
        if (logger && typeof logger.error === 'function') {
            logger.error(`(httpResponse.${label}) ${ip} ${req && req.url} ${msg}`);
        }
        sendErrorPage(req, res, status, {
            detail: msg,
            // The descriptions in errorPages.js are user-facing — pass the
            // server-side reason in `detail` so callers can surface it to a
            // developer / curl user without mixing it into the friendly copy.
            requestId: req && req.headers && (req.headers['x-request-id'] || req.headers['cf-ray']) || undefined
        });
    };
}

module.exports = {
    badRequest: makeHandler(400, 'badRequest'),
    unauthorized: makeHandler(401, 'unauthorized'),
    paymentRequired: makeHandler(402, 'paymentRequired'),
    accessForbidden: makeHandler(403, 'accessForbidden'),
    notFound: makeHandler(404, 'notFound'),
    methodNotAllowed: makeHandler(405, 'methodNotAllowed'),
    tooManyRequests: makeHandler(429, 'tooManyRequests'),
    internalServerError: makeHandler(500, 'internalServerError'),
    badGateway: makeHandler(502, 'badGateway'),
    serviceUnavailable: makeHandler(503, 'serviceUnavailable'),
    gatewayTimeout: makeHandler(504, 'gatewayTimeout')
};
