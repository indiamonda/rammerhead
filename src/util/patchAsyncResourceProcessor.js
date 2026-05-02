// https://github.com/DevExpress/testcafe-hammerhead/blob/47f8b6e370c37f2112fd7f56a3d493fbfcd7ec99/src/processing/resources/index.ts

const url = require('url');
const pageProcessor = require('testcafe-hammerhead/lib/processing/resources/page');
const manifestProcessor = require('testcafe-hammerhead/lib/processing/resources/manifest');
const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const stylesheetProcessor = require('testcafe-hammerhead/lib/processing/resources/stylesheet');
const urlUtil = require('testcafe-hammerhead/lib/utils/url');
const { encodeContent, decodeContent } = require('testcafe-hammerhead/lib/processing/encoding');
const { platform } = require('os');

const IS_WIN = platform() === 'win32';
const DISK_RE = /^[A-Za-z]:/;
const RESOURCE_PROCESSORS = [pageProcessor, manifestProcessor, scriptProcessor, stylesheetProcessor];

function getResourceUrlReplacer(ctx) {
    return function urlReplacer(resourceUrl, resourceType, charsetAttrValue, baseUrl, isCrossDomain = false, isUrlsSet = false) {
        if (isUrlsSet)
            return urlUtil.handleUrlsSet(urlReplacer, resourceUrl, resourceType, charsetAttrValue, baseUrl, isCrossDomain);

        if (!urlUtil.isSupportedProtocol(resourceUrl) && !urlUtil.isSpecialPage(resourceUrl)) return resourceUrl;

        if (IS_WIN && ctx.dest.protocol === 'file:' && DISK_RE.test(resourceUrl)) resourceUrl = '/' + resourceUrl;

        // NOTE: Resolves base URLs without a protocol ('//google.com/path' for example).
        baseUrl = baseUrl ? url.resolve(ctx.dest.url, baseUrl) : '';
        resourceUrl = urlUtil.processSpecialChars(resourceUrl);

        let resolvedUrl = url.resolve(baseUrl || ctx.dest.url, resourceUrl);

        if (!urlUtil.isValidUrl(resolvedUrl)) return resourceUrl;

        // NOTE: Script or <link rel='preload' as='script'>
        const isScriptLike = urlUtil.parseResourceType(resourceType).isScript;
        const charsetStr = charsetAttrValue || (isScriptLike && ctx.contentInfo.charset.get());

        resolvedUrl = urlUtil.ensureTrailingSlash(resourceUrl, resolvedUrl);

        if (!urlUtil.isValidUrl(resolvedUrl)) return resolvedUrl;

        return ctx.toProxyUrl(resolvedUrl, isCrossDomain, resourceType, charsetStr);
    };
}

// Heuristic: did the upstream return HTML for a request the browser made via
// a `<script>` / `import` / fetch-with-script-mode? Common when destinations
// reply with a CDN error page, captcha challenge, or a "blocked region" stub.
// Without rewriting, the browser logs `Uncaught SyntaxError: Unexpected token '<'`
// at the script's first byte. We force-route the body through our script
// processor (which has an HTML detector) so a clean `console.error(...)` stub
// is sent instead of raw HTML.
const _HTML_HEAD_RE = /^[\s\uFEFF]*<(?:!doctype|!--|html|head|body|script|meta|title|link|style)\b/i;
function _bodyLooksLikeHtml(buf) {
    try {
        const head = (buf || Buffer.alloc(0)).slice(0, 256).toString('utf8');
        return _HTML_HEAD_RE.test(head);
    } catch (_) {
        return false;
    }
}

require('testcafe-hammerhead/lib/processing/resources/index').process = async function process(ctx) {
    const { destResBody, contentInfo } = ctx;
    const { encoding, charset } = contentInfo;

    for (const processor of RESOURCE_PROCESSORS) {
        if (!processor.shouldProcessResource(ctx)) continue;

        const urlReplacer = getResourceUrlReplacer(ctx);

        if (pageProcessor === processor) await ctx.prepareInjectableUserScripts(ctx.eventFactory, ctx.session.injectable.userScripts);

        const decoded = await decodeContent(destResBody, encoding, charset);

        // @ts-ignore: Cannot invoke an expression whose type lacks a call signature
        const processed = await processor.processResource(decoded, ctx, charset, urlReplacer); // <-- add async support

        if (processed === pageProcessor.RESTART_PROCESSING) return await process(ctx);

        return await encodeContent(processed, encoding, charset);
    }

    // No processor matched but the request was for a JS resource AND the body
    // looks like HTML — substitute a console.error stub so the browser's JS
    // parser doesn't choke. This handles CDN error pages / WAF stubs that
    // come back with `text/html` for `<script src="…">` requests.
    if (ctx.dest && ctx.dest.isScript && _bodyLooksLikeHtml(destResBody)) {
        const url = (ctx.dest && ctx.dest.url) || '<unknown>';
        const stub = 'console.error("[StudyBoard] Expected JavaScript, received HTML from " + ' + JSON.stringify(url) + ');';
        // Force JS content type so the browser parses the stub correctly.
        try {
            if (ctx.destRes && ctx.destRes.headers) {
                ctx.destRes.headers['content-type'] = 'application/javascript; charset=utf-8';
                delete ctx.destRes.headers['content-encoding'];
                delete ctx.destRes.headers['content-length'];
            }
        } catch (_) {}
        return Buffer.from(stub, 'utf8');
    }

    return destResBody;
};
