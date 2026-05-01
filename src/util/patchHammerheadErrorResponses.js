/**
 * Replace Hammerhead's bare `respond404` / `respond500` with our themed
 * {@link sendErrorPage} so silent failures inside the request pipeline render
 * a friendly HTML page (browser navigations) or a one-line plain-text body
 * (XHR/fetch consumers) instead of a blank tab with a 404 status.
 *
 * Trigger sites in the upstream module (`testcafe-hammerhead`):
 *
 *   • `request-pipeline/index.js` calls `respond404(res)` when a request can
 *     NOT be dispatched to any open session (URL has no session id, or the
 *     id refers to a closed/expired session). Without this patch the user
 *     sees an empty page.
 *
 *   • `proxy/index.js` calls `respond500(res, "Session is not opened in proxy")`
 *     when a service-worker or task-script lookup misses its session — same
 *     "blank tab" symptom.
 *
 * Hammerhead doesn't pass the `req` to these helpers, so StudyBoardGateway
 * tags every `res` with `_sbReq = req` inside `_onRequest`. We read that
 * here to do content-negotiation. If the tag is missing (e.g. third-party
 * code calling these helpers from another path), we fall back to the
 * original status-only behaviour.
 */

const httpUtil = require('testcafe-hammerhead/lib/utils/http');
const { sendErrorPage } = require('./errorPages');

const orig404 = httpUtil.respond404;
const orig500 = httpUtil.respond500;

httpUtil.respond404 = function patchedRespond404(res) {
    const req = res && res._sbReq;
    if (req && !res.headersSent) {
        try {
            sendErrorPage(req, res, 404, { detail: req.url });
            return;
        } catch (_) {
            // If our renderer crashes for any reason, fall back to the
            // original behaviour so we never leave the request hanging.
        }
    }
    return orig404.apply(this, arguments);
};
httpUtil.respond404._a_patched = true;

httpUtil.respond500 = function patchedRespond500(res, err) {
    const req = res && res._sbReq;
    if (req && !res.headersSent) {
        try {
            sendErrorPage(req, res, 500, { detail: err || undefined });
            return;
        } catch (_) {
            // Fall through to original behaviour if our renderer fails.
        }
    }
    return orig500.apply(this, arguments);
};
httpUtil.respond500._a_patched = true;

// Prevent testcafe-hammerhead from destroying the socket for AJAX requests,
// which causes Fly.io to return a 502 Bad Gateway error.
const pipelineUtils = require('testcafe-hammerhead/lib/request-pipeline/utils');
const origError = pipelineUtils.error;
pipelineUtils.error = function patchedError(ctx, err) {
    if (ctx.isPage && !ctx.isIframe) {
        ctx.session.handlePageError(ctx, err);
    } else {
        ctx.closeWithError(500, err ? err.toString() : 'Unknown error');
    }
};
pipelineUtils.error._a_patched = true;
