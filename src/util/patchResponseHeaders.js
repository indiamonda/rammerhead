/**
 * Patch hammerhead's response header transforms to be more permissive:
 *
 * 1. Always inject Access-Control-Allow-Origin with the proxy origin (not just
 *    when CORS check passes), so the browser never blocks API responses.
 * 2. Always allow credentials, methods, and headers for preflight responses.
 * 3. Remove Access-Control-Allow-Headers restrictions that might block custom
 *    headers used by SPAs (YouTube InnerTube, TikTok, Slack, etc.).
 */

const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

transforms.responseTransforms[BUILTIN_HEADERS.accessControlAllowOrigin] = (_src, ctx) => {
    return ctx.getProxyOrigin(!!ctx.dest.reqOrigin);
};

transforms.forcedResponseTransforms = transforms.forcedResponseTransforms || {};

transforms.forcedResponseTransforms['access-control-allow-credentials'] = () => 'true';

transforms.forcedResponseTransforms['access-control-allow-methods'] = (src) => {
    if (src) return src;
    return 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD';
};

transforms.forcedResponseTransforms['access-control-allow-headers'] = (src) => {
    if (src) return src;
    return 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Range, Cookie';
};

transforms.forcedResponseTransforms['access-control-expose-headers'] = (src) => {
    if (src) return src;
    return '*';
};
