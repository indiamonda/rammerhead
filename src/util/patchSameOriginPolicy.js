/**
 * Bypass hammerhead's same-origin policy enforcement for AJAX/fetch requests.
 *
 * Problem: hammerhead enforces browser-like CORS checks on proxied requests.
 * If a page on youtube.com makes a fetch to accounts.google.com, hammerhead
 * checks Access-Control-Allow-Origin. If the header is missing or doesn't
 * match, the response is blocked. This breaks YouTube (InnerTube API), TikTok
 * (feed API), Slack (API calls), and many other SPAs that rely on cross-origin
 * APIs working through the proxy.
 *
 * Fix: override isPassSameOriginPolicy() to always return true. The proxy
 * mediates all requests, so enforcing same-origin policy is counter-productive.
 */

const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context');

RequestPipelineContext.prototype.isPassSameOriginPolicy = function () {
    return true;
};
