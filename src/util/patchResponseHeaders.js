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

// Strip x-remix-reload-document: React Router / Remix uses this header to force
// a full document reload. Through the proxy, the /__manifest route always returns
// this header (ChatGPT, etc.), causing an infinite refresh loop.
transforms.responseTransforms['x-remix-reload-document'] = () => void 0;

// Rewrite HTTP Link preload/modulepreload hints. Browsers consume Link headers
// before the rewritten HTML is parsed, so a raw header like
// `Link: </cdn/assets/app.css>; rel=preload; as=style` makes Chrome request
// `/cdn/assets/app.css` from the proxy root and 404 (ChatGPT/React Router).
const ABSOLUTE_PATH_IN_LINK_RE = /<((?:https?:\/\/|\/\/|\/)[^>]*)>/gi;

transforms.responseTransforms[BUILTIN_HEADERS.link] = (src, ctx) => {
    try {
        if (!src) return src;
        if (/[;\s]rel=\s*prefetch/i.test(src)) return void 0;

        return String(src).replace(ABSOLUTE_PATH_IN_LINK_RE, (match, url) => {
            if (!url || /^\/[a-f0-9]{32}\//i.test(url)) return match;

            let absoluteUrl = url;
            if (url.startsWith('//')) absoluteUrl = (ctx.dest && ctx.dest.protocol || 'https:') + url;
            else if (url.startsWith('/')) absoluteUrl = new URL(url, ctx.dest.url).href;

            return '<' + ctx.toProxyUrl(absoluteUrl, false, ctx.contentInfo && ctx.contentInfo.contentTypeUrlToken) + '>';
        });
    } catch (_) {
        return src;
    }
};

// Override hammerhead's content-disposition transform. Hammerhead unconditionally
// injects `attachment;` for any non-page/non-script/non-iframe resource (computed
// in context/index.js as `isAttachment`), which causes Chrome to abort <img>,
// <video>, <audio>, and <link> requests because the browser refuses to render an
// "attachment" inline (poki.com images, etc. were broken by this).
//
// We only want the original behavior when the destination ACTUALLY sent
// content-disposition (e.g. a real download click), or when the browser is
// performing a top-level navigation to a non-displayable resource. Embedded
// resources (sec-fetch-dest=image/font/audio/video/style/...) and inline-
// displayable content-types should pass through whatever the origin sent.
const INLINE_CT_RE = /^(image|video|audio|font|text|application\/(javascript|x-javascript|ecmascript|json|xml|wasm|font-woff2?|x-font-(?:woff2?|ttf|otf)|vnd\.ms-fontobject)|model\/)/i;
const INLINE_FETCH_DEST = new Set([
    'image', 'font', 'audio', 'video', 'style', 'script',
    'track', 'manifest', 'embed', 'object', 'paintworklet', 'audioworklet',
]);

transforms.forcedResponseTransforms[BUILTIN_HEADERS.contentDisposition] = (src, ctx) => {
    try {
        if (src && /attachment/i.test(src)) return src;
        const ct = String(
            (ctx.destRes && ctx.destRes.headers && ctx.destRes.headers['content-type']) || ''
        );
        if (INLINE_CT_RE.test(ct)) return src;
        const dest = String(
            (ctx.req && ctx.req.headers && ctx.req.headers['sec-fetch-dest']) || ''
        ).toLowerCase();
        if (INLINE_FETCH_DEST.has(dest)) return src;
        if (ctx.contentInfo && ctx.contentInfo.isAttachment) {
            return 'attachment;' + (src || '');
        }
        return src;
    } catch (_) {
        return src;
    }
};
