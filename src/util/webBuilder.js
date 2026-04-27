/**
 * Web-build-files builder.
 *
 * Two modes, both produce a streamed ZIP:
 *
 *   1. STATIC  — crawl an external URL. Walks every same-origin HTML page
 *                we can reach via <a> links and inlines/relocates every
 *                referenced asset (CSS/JS/img/font/srcset/inline url()).
 *                Cross-origin assets are pulled in too (so the offline copy
 *                works when redeployed) up to a configurable size cap; if
 *                the cap is hit, we leave them as absolute URLs. HTML/PHP
 *                pages on other domains are NEVER recursed into — they stay
 *                as absolute links because pulling them would explode the
 *                graph.
 *
 *   2. LOCAL   — package this rammerhead instance's source tree (public/,
 *                src/, package.json, etc.). Used when the user typed a URL
 *                that resolves to the running server itself; it's the only
 *                "non-static" export we can actually deliver, since we
 *                can't reach into a third-party server's source from the
 *                outside.
 *
 * Limits (configurable, defaults match the feature spec):
 *   STATIC_MAX_TOTAL_BYTES        = 10 GB   asset budget; once exceeded we
 *                                            stop downloading new
 *                                            cross-origin assets and leave
 *                                            them as absolute links.
 *   LOCAL_PUBLIC_MAX_BYTES        =  5 GB   public/ budget; over-quota
 *                                            files are left out of the zip
 *                                            and a manifest line tells the
 *                                            user where they came from.
 *   LOCAL_REST_MAX_BYTES          = 25 GB   everything else (src/, etc.).
 *                                            Hard cap — over budget aborts
 *                                            the export.
 *
 * Path rewriting: every URL in served HTML/CSS becomes a relative path
 * (./, ../, ../../, …) computed from the file's own location inside the
 * archive, so the bundle is portable — the user can drop it in any static
 * host (or open files from disk) and links resolve correctly.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const DEFAULTS = {
    static: {
        maxTotalBytes: 10 * GB,
        maxPages: 200,
        maxDepth: 6,
        maxPerFileBytes: 200 * MB,
        timeoutMs: 30 * 1000,
        totalTimeoutMs: 5 * 60 * 1000,
        concurrency: 6,
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    },
    local: {
        publicMaxBytes: 5 * GB,
        restMaxBytes: 25 * GB,
        // Anything matching these names is excluded entirely — checkouts,
        // build artefacts, secrets, runtime state, the user's own crawled
        // sessions. Keep this tight: shipping a sessions/ dump in the zip
        // would leak proxy state to whoever opens it.
        excludeNames: new Set([
            'node_modules', '.git', '.svn', '.hg', '.DS_Store',
            '.env', '.env.local', '.env.production',
            'sessions', 'logs', 'tmp', 'cache', '.cache', 'coverage',
            'dist', 'build', '.next', '.nuxt', '.parcel-cache'
        ]),
        excludeExt: new Set(['.log', '.lock'])
    }
};

// ---- HTTP helpers ----------------------------------------------------------

/**
 * Promise-style fetch built on Node's core http/https. We don't rely on
 * `fetch()` because it isn't available on Node 14, and rammerhead's
 * package.json declares >=18 but downstream forks may run older.
 *
 * Auto-follows up to `maxRedirects` redirects, returns the final URL so the
 * crawler can normalize relative links from the response.
 */
function fetchUrl(target, opts = {}) {
    const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : 8;
    const timeoutMs = opts.timeoutMs || 30000;
    const maxBytes = opts.maxBytes || (200 * MB);
    const userAgent = opts.userAgent || DEFAULTS.static.userAgent;

    return new Promise((resolve, reject) => {
        let redirects = 0;
        const visited = new Set();

        const go = (current) => {
            if (visited.has(current)) {
                reject(new Error('redirect loop: ' + current));
                return;
            }
            visited.add(current);

            let parsed;
            try { parsed = new URL(current); } catch (e) { reject(e); return; }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                reject(new Error('unsupported protocol: ' + parsed.protocol));
                return;
            }

            const lib = parsed.protocol === 'https:' ? https : http;
            const req = lib.request({
                method: 'GET',
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                headers: {
                    'User-Agent': userAgent,
                    'Accept': '*/*',
                    'Accept-Encoding': 'identity'
                },
                timeout: timeoutMs
            }, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                    res.resume();
                    redirects++;
                    if (redirects > maxRedirects) {
                        reject(new Error('too many redirects'));
                        return;
                    }
                    let next;
                    try { next = new URL(res.headers.location, current).href; } catch (e) { reject(e); return; }
                    go(next);
                    return;
                }
                const chunks = [];
                let total = 0;
                let aborted = false;
                res.on('data', (chunk) => {
                    if (aborted) return;
                    total += chunk.length;
                    if (total > maxBytes) {
                        aborted = true;
                        // Drain quietly and report the size limit so the
                        // caller can either treat the asset as too-big and
                        // leave a link, or surface the error.
                        try { req.destroy(); } catch (_) { /* socket may already be closed */ }
                        reject(Object.assign(new Error('response exceeds maxBytes'), { code: 'TOO_LARGE', size: total }));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    if (aborted) return;
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                        finalUrl: current
                    });
                });
                res.on('error', reject);
            });
            req.on('timeout', () => {
                try { req.destroy(new Error('request timeout')); } catch (_) { /* already torn down */ }
                reject(new Error('request timeout'));
            });
            req.on('error', reject);
            req.end();
        };
        go(target);
    });
}

/** HEAD/GET with a minimal body to verify a URL exists. */
async function probeUrl(target, opts = {}) {
    const result = await fetchUrl(target, Object.assign({ maxBytes: 16 * MB, timeoutMs: 15000 }, opts));
    return result;
}

// ---- Path utilities --------------------------------------------------------

const HTML_EXT_RE = /\.(html?|htm|php|asp|aspx|jsp|cfm)$/i;
const ASSET_EXT_RE = /\.(css|js|m?js|json|xml|svg|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|flac|pdf|txt|map|wasm)(\?|$)/i;

function looksLikeHtmlPath(p) { return p === '' || p === '/' || p.endsWith('/') || HTML_EXT_RE.test(p); }

/**
 * Build the in-zip path for a URL. The strategy: reflect the URL's
 * pathname under either a same-origin tree (no prefix) or under
 * `_external/<host>/...` for cross-origin assets. Trailing-slash and empty
 * paths become `index.html` so the bundle has actual files at directory
 * boundaries, which is what static hosts (and `file://`) expect.
 */
function urlToZipPath(targetUrl, rootOrigin) {
    const u = new URL(targetUrl);
    const sameOrigin = u.origin === rootOrigin;
    let pathname = decodeURIComponent(u.pathname).replace(/\\/g, '/');
    if (!pathname || pathname === '/') pathname = '/index.html';
    else if (pathname.endsWith('/')) pathname += 'index.html';
    // If the path has no extension, treat directory-style URLs as HTML.
    else if (!/\.[a-z0-9]+$/i.test(pathname)) pathname += '/index.html';

    pathname = pathname.replace(/^\/+/, '');
    // Sanitize: forbid '..' segments which a malicious server could try
    // to inject through a Content-Disposition or unusual path. The
    // control-char strip is intentional — they have no business in zip
    // entry names — so suppress the lint warning for the regex.
    pathname = pathname
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        // eslint-disable-next-line no-control-regex
        .map((seg) => seg.replace(/[\x00-\x1f]/g, '_'))
        .join('/');
    if (!pathname) pathname = 'index.html';

    if (sameOrigin) return pathname;
    const safeHost = u.host.replace(/[:]/g, '_');
    return '_external/' + safeHost + '/' + pathname;
}

/** Return the relative path from `from` (a file) to `to` (a file). */
function relativePath(from, to) {
    if (from === to) return path.basename(to);
    const fromParts = from.split('/').slice(0, -1);
    const toParts = to.split('/');
    let common = 0;
    while (
        common < fromParts.length &&
        common < toParts.length - 1 &&
        fromParts[common] === toParts[common]
    ) common++;
    const ups = fromParts.length - common;
    const tail = toParts.slice(common).join('/');
    if (ups === 0) return './' + tail;
    return '../'.repeat(ups) + tail;
}

// ---- HTML/CSS rewriting ----------------------------------------------------

// Attributes whose value is a single URL we want to rewrite or follow.
const URL_ATTRS = ['href', 'src', 'action', 'poster', 'data-src', 'data-href', 'data-original', 'background'];
const URL_ATTRS_RE = new RegExp(
    '\\s(' + URL_ATTRS.join('|') + ')\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
    'gi'
);

// Tags whose `src`/`href` we treat as page-style (HTML) vs asset-style.
const PAGE_TAG_RE = /^(a|iframe|frame|form|area)$/i;

function rewriteHtml(htmlBody, baseUrl, mapper) {
    // We do regex-based attribute scanning (good enough for finding URL
    // attrs in HTML — full DOM parsing would be more robust but adds a
    // dependency for marginal gain in this offline-mirror use case).
    let out = '';
    let cursor = 0;

    // Find every tag start, then within each opening tag rewrite URL attrs.
    const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
    let m;
    while ((m = tagRe.exec(htmlBody)) !== null) {
        const tagName = m[1].toLowerCase();
        const tagStart = m.index;
        const tagEnd = tagStart + m[0].length;
        out += htmlBody.slice(cursor, tagStart);
        const inner = m[0];

        let rewritten = inner.replace(URL_ATTRS_RE, (full, attr, _quoted, dq, sq, bare) => {
            const value = dq != null ? dq : sq != null ? sq : bare != null ? bare : '';
            if (!value) return full;
            const isPageLike = PAGE_TAG_RE.test(tagName);
            const replaced = mapper(value, baseUrl, { tagName, attr, isPageLike });
            if (replaced == null) return full;
            const safe = replaced.replace(/"/g, '&quot;');
            return ' ' + attr + '="' + safe + '"';
        });

        // srcset attribute (multi-URL list).
        rewritten = rewritten.replace(/\s(srcset|imagesrcset)\s*=\s*("([^"]*)"|'([^']*)')/gi,
            (full, attr, _q, dq, sq) => {
                const list = dq != null ? dq : sq;
                if (!list) return full;
                const parts = list.split(',').map((seg) => {
                    const t = seg.trim();
                    if (!t) return '';
                    const sp = t.split(/\s+/);
                    const u = sp[0];
                    const desc = sp.slice(1).join(' ');
                    const replaced = mapper(u, baseUrl, { tagName, attr, isPageLike: false });
                    return (replaced != null ? replaced : u) + (desc ? ' ' + desc : '');
                }).filter(Boolean).join(', ');
                return ' ' + attr + '="' + parts.replace(/"/g, '&quot;') + '"';
            });

        // Inline style attributes — pass through CSS rewriter.
        rewritten = rewritten.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
            (full, _q, dq, sq) => {
                const css = dq != null ? dq : sq;
                if (!css) return full;
                const replaced = rewriteCss(css, baseUrl, mapper);
                return ' style="' + replaced.replace(/"/g, '&quot;') + '"';
            });

        out += rewritten;
        cursor = tagEnd;
    }
    out += htmlBody.slice(cursor);

    // <style>…</style> blocks: extract, run CSS rewriter, re-insert.
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
        (_m, open, css, close) => open + rewriteCss(css, baseUrl, mapper) + close);

    // <meta http-equiv="refresh" content="0;url=…">
    out = out.replace(/(content\s*=\s*["'])(\d+\s*;\s*url=)([^"']+)(["'])/gi,
        (_m, p1, p2, u, p3) => {
            const replaced = mapper(u, baseUrl, { tagName: 'meta', attr: 'content', isPageLike: true });
            return p1 + p2 + (replaced != null ? replaced : u) + p3;
        });

    return out;
}

function rewriteCss(cssBody, baseUrl, mapper) {
    let out = cssBody;
    // url(...) — handles bare, single-quoted, double-quoted forms.
    out = out.replace(/url\(\s*("([^"]*)"|'([^']*)'|([^)]+))\s*\)/gi,
        (full, _q, dq, sq, bare) => {
            const value = (dq != null ? dq : sq != null ? sq : bare != null ? bare : '').trim();
            if (!value || value.startsWith('data:') || value.startsWith('#')) return full;
            const replaced = mapper(value, baseUrl, { tagName: 'css', attr: 'url', isPageLike: false });
            if (replaced == null) return full;
            return 'url("' + replaced.replace(/"/g, '\\"') + '")';
        });
    // @import "…" / @import url(…) — url() form is already handled above.
    out = out.replace(/@import\s+("([^"]*)"|'([^']*)')/gi,
        (full, _q, dq, sq) => {
            const v = (dq != null ? dq : sq).trim();
            if (!v) return full;
            const replaced = mapper(v, baseUrl, { tagName: 'css', attr: 'import', isPageLike: false });
            if (replaced == null) return full;
            return '@import "' + replaced.replace(/"/g, '\\"') + '"';
        });
    return out;
}

function classifyResource(absUrl) {
    try {
        const u = new URL(absUrl);
        const p = u.pathname.toLowerCase();
        if (looksLikeHtmlPath(p)) return 'html';
        if (ASSET_EXT_RE.test(p)) return 'asset';
        // Unknown extension → treat as page. Used by the same-origin
        // anchor-scan to keep following routes like `/about` or
        // `/api/users` that look like pages but lack a `.html` suffix.
        // (Cross-origin classification doesn't go through here — see
        // the mapper, which uses `ctx.isPageLike` instead.)
        return 'html';
    } catch (_) { return 'asset'; }
}

function tryResolveUrl(value, baseUrl) {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('#')) return null;
    if (/^javascript:/i.test(trimmed)) return null;
    if (/^mailto:/i.test(trimmed)) return null;
    if (/^tel:/i.test(trimmed)) return null;
    if (/^data:/i.test(trimmed)) return null;
    if (/^blob:/i.test(trimmed)) return null;
    if (/^about:/i.test(trimmed)) return null;
    try {
        const abs = new URL(trimmed, baseUrl);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
        return abs.href;
    } catch (_) { return null; }
}

// ---- Static site builder ---------------------------------------------------

/**
 * Crawl `rootUrl` into the supplied ZipWriter.
 *
 * Returns a manifest object the caller can stringify into an export-summary
 * file inside the archive.
 */
async function buildStaticSite(rootUrl, zip, opts = {}) {
    const o = Object.assign({}, DEFAULTS.static, opts);
    const root = new URL(rootUrl);
    const rootOrigin = root.origin;

    const pageQueue = []; // {url, depth}
    const visitedPages = new Set();
    const enqueuedPages = new Set();
    const assetQueue = []; // {url, sameOrigin}
    const enqueuedAssets = new Set();
    const downloaded = new Map(); // url -> {zipPath, type, externalLinked}
    const externalLinked = new Set(); // urls we deliberately left as absolute
    const errors = []; // {url, error}

    const startedAt = Date.now();
    let totalBytes = 0;
    let assetBudgetExceeded = false;

    const enqueuePage = (u, depth) => {
        if (enqueuedPages.has(u) || depth > o.maxDepth) return;
        if (visitedPages.size + pageQueue.length >= o.maxPages) return;
        enqueuedPages.add(u);
        pageQueue.push({ url: u, depth });
    };

    const enqueueAsset = (u) => {
        if (enqueuedAssets.has(u)) return;
        enqueuedAssets.add(u);
        assetQueue.push(u);
    };

    enqueuePage(root.href, 0);

    /**
     * Map function called by the HTML/CSS rewriters. Decides for each
     * encountered URL whether to: schedule a crawl, schedule an asset
     * download, or leave it as an absolute link.
     *
     * Page-vs-asset is decided primarily by tag context (a/iframe/form
     * are pages; img/script/link/style are assets), not by URL extension.
     * That keeps `<img src="/dynamic-img">` (no extension) downloadable
     * and `<a href="/about">` (no extension) crawlable, regardless of
     * whether the URL has a `.html` suffix.
     */
    function makeMapper(currentPageUrl, currentZipPath) {
        return (rawValue, baseUrl, ctx) => {
            const abs = tryResolveUrl(rawValue, baseUrl || currentPageUrl);
            if (!abs) return null;

            // Strip url fragment for storage keying; preserve fragment in
            // the rewritten value if it was page-internal.
            const parsed = new URL(abs);
            const fragment = parsed.hash;
            parsed.hash = '';
            const cleanAbs = parsed.href;

            const sameOrigin = parsed.origin === rootOrigin;
            // Page-y when the tag is a/iframe/form/area, OR when the URL
            // itself carries an explicit page extension (catches cases
            // like `<link rel="alternate" href="/feed.html">`).
            const isPage = ctx.isPageLike || HTML_EXT_RE.test(parsed.pathname);

            if (isPage) {
                if (!sameOrigin) {
                    externalLinked.add(cleanAbs);
                    return cleanAbs + fragment;
                }
                const zipPath = urlToZipPath(cleanAbs, rootOrigin);
                enqueuePage(cleanAbs, 0); // depth tracked at dequeue
                if (!downloaded.has(cleanAbs)) {
                    downloaded.set(cleanAbs, { zipPath, type: 'html', pending: true });
                }
                return relativePath(currentZipPath, zipPath) + fragment;
            }

            // Asset case. Same-origin always pulled. Cross-origin pulled
            // unless we're over budget — then leave as absolute link.
            if (!sameOrigin && assetBudgetExceeded) {
                externalLinked.add(cleanAbs);
                return cleanAbs + fragment;
            }
            const zipPath = urlToZipPath(cleanAbs, rootOrigin);
            enqueueAsset(cleanAbs);
            if (!downloaded.has(cleanAbs)) {
                downloaded.set(cleanAbs, { zipPath, type: 'asset', pending: true });
            }
            return relativePath(currentZipPath, zipPath) + fragment;
        };
    }

    // ---- Pump pages ------------------------------------------------------

    while (pageQueue.length) {
        if (Date.now() - startedAt > o.totalTimeoutMs) break;
        const { url: pageUrl, depth } = pageQueue.shift();
        if (visitedPages.has(pageUrl)) continue;
        visitedPages.add(pageUrl);
        if (visitedPages.size > o.maxPages) break;

        let res;
        try {
            res = await fetchUrl(pageUrl, {
                timeoutMs: o.timeoutMs,
                maxBytes: o.maxPerFileBytes,
                userAgent: o.userAgent
            });
        } catch (e) {
            errors.push({ url: pageUrl, error: e.message });
            continue;
        }

        if (res.statusCode >= 400) {
            errors.push({ url: pageUrl, error: 'HTTP ' + res.statusCode });
            continue;
        }

        const finalUrl = res.finalUrl;
        const ct = (res.headers['content-type'] || '').toLowerCase();
        const isHtml = ct.includes('html') || classifyResource(finalUrl) === 'html';

        const zipPath = urlToZipPath(finalUrl, rootOrigin);
        // Keep a fixed slot for the original requested URL too (in case
        // redirects landed somewhere different) so internal links resolve.
        if (pageUrl !== finalUrl) {
            const aliasPath = urlToZipPath(pageUrl, rootOrigin);
            if (aliasPath !== zipPath && !downloaded.has(pageUrl)) {
                downloaded.set(pageUrl, { zipPath, type: 'html', pending: false, alias: true });
            }
        }

        if (isHtml) {
            const html = res.body.toString('utf8');
            const mapper = makeMapper(finalUrl, zipPath);
            const rewritten = rewriteHtml(html, finalUrl, mapper);
            // Find <a href> targets that the mapper already enqueued; we
            // re-enqueue here with proper depth so deep crawls stop at
            // maxDepth.
            const anchorRe = /<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
            let am;
            while ((am = anchorRe.exec(html)) !== null) {
                const v = am[2] != null ? am[2] : am[3] != null ? am[3] : am[4];
                const abs = tryResolveUrl(v, finalUrl);
                if (!abs) continue;
                const u2 = new URL(abs);
                u2.hash = '';
                if (u2.origin !== rootOrigin) continue;
                if (classifyResource(u2.href) !== 'html') continue;
                enqueuePage(u2.href, depth + 1);
            }

            const buf = Buffer.from(rewritten, 'utf8');
            totalBytes += buf.length;
            await zip.add(zipPath, buf);
            downloaded.set(finalUrl, { zipPath, type: 'html', pending: false });
        } else {
            // Mid-crawl we got a non-HTML response (e.g., direct asset
            // link followed). Treat it as an asset.
            totalBytes += res.body.length;
            if (totalBytes > o.maxTotalBytes && new URL(finalUrl).origin !== rootOrigin) {
                assetBudgetExceeded = true;
                externalLinked.add(finalUrl);
            } else {
                await zip.add(zipPath, res.body);
                downloaded.set(finalUrl, { zipPath, type: 'asset', pending: false });
            }
        }
    }

    // ---- Pump assets -----------------------------------------------------

    // Pull assets in small parallel batches for throughput. We don't
    // recurse off found assets except for CSS, where url() and @import
    // can pull more files (fonts, sub-stylesheets, sprites).
    const inFlight = new Set();
    const cssFollowups = [];

    async function pullOne(u) {
        if (Date.now() - startedAt > o.totalTimeoutMs) return;
        const meta = downloaded.get(u);
        if (meta && !meta.pending) return;

        const isExternal = new URL(u).origin !== rootOrigin;
        if (isExternal && assetBudgetExceeded) {
            externalLinked.add(u);
            return;
        }

        let res;
        try {
            res = await fetchUrl(u, {
                timeoutMs: o.timeoutMs,
                maxBytes: o.maxPerFileBytes,
                userAgent: o.userAgent
            });
        } catch (e) {
            errors.push({ url: u, error: e.message });
            // If it was external and too big, fall back to leaving a link.
            if (isExternal) externalLinked.add(u);
            return;
        }
        if (res.statusCode >= 400) {
            errors.push({ url: u, error: 'HTTP ' + res.statusCode });
            if (isExternal) externalLinked.add(u);
            return;
        }

        if (totalBytes + res.body.length > o.maxTotalBytes) {
            // Hitting the cap mid-crawl flips us into "link, don't download"
            // mode for any remaining cross-origin assets.
            if (isExternal) {
                assetBudgetExceeded = true;
                externalLinked.add(u);
                return;
            }
            // Same-origin always honours the cap for safety; just record
            // and skip.
            errors.push({ url: u, error: 'budget exceeded' });
            return;
        }

        const zipPath = urlToZipPath(res.finalUrl, rootOrigin);
        const ct = (res.headers['content-type'] || '').toLowerCase();

        let body = res.body;
        if (ct.includes('css') || /\.css(\?|$)/i.test(res.finalUrl)) {
            const cssText = body.toString('utf8');
            const mapper = (rawValue, baseUrl /* , _ctx */) => {
                const abs = tryResolveUrl(rawValue, baseUrl || res.finalUrl);
                if (!abs) return null;
                const parsed = new URL(abs);
                const fragment = parsed.hash;
                parsed.hash = '';
                const cleanAbs = parsed.href;
                const sameOrigin = parsed.origin === rootOrigin;
                if (!sameOrigin && assetBudgetExceeded) {
                    externalLinked.add(cleanAbs);
                    return cleanAbs + fragment;
                }
                const childZipPath = urlToZipPath(cleanAbs, rootOrigin);
                if (!downloaded.has(cleanAbs)) {
                    downloaded.set(cleanAbs, { zipPath: childZipPath, type: 'asset', pending: true });
                    cssFollowups.push(cleanAbs);
                }
                return relativePath(zipPath, childZipPath) + fragment;
            };
            const rewritten = rewriteCss(cssText, res.finalUrl, mapper);
            body = Buffer.from(rewritten, 'utf8');
        }

        await zip.add(zipPath, body);
        totalBytes += body.length;
        downloaded.set(u, { zipPath, type: 'asset', pending: false });
    }

    while (assetQueue.length || cssFollowups.length || inFlight.size) {
        if (Date.now() - startedAt > o.totalTimeoutMs) break;
        while ((assetQueue.length || cssFollowups.length) && inFlight.size < o.concurrency) {
            const next = assetQueue.shift() || cssFollowups.shift();
            const p = pullOne(next).finally(() => inFlight.delete(p));
            inFlight.add(p);
        }
        if (inFlight.size === 0) break;
        // Wait for at least one to finish so we can refill the slot.
        await Promise.race(Array.from(inFlight));
    }

    // ---- Manifest --------------------------------------------------------

    const downloadedList = [];
    for (const [u, meta] of downloaded) {
        if (meta.pending) continue;
        downloadedList.push({ url: u, path: meta.zipPath, type: meta.type });
    }

    const manifest = {
        mode: 'static',
        rootUrl: rootUrl,
        generatedAt: new Date().toISOString(),
        totalBytes,
        budget: o.maxTotalBytes,
        budgetExceeded: assetBudgetExceeded,
        pageCount: visitedPages.size,
        downloaded: downloadedList,
        externalLinks: Array.from(externalLinked).slice(0, 5000),
        errors: errors.slice(0, 500)
    };
    await zip.add('EXPORT_MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    const readme = [
        '# Web Build Files Export',
        '',
        '## Source',
        '`' + rootUrl + '`',
        '',
        '## Mode',
        'Static crawl — every same-origin HTML page reachable from the root',
        'was downloaded along with its CSS, JS, image, font, and data assets.',
        'Cross-origin assets were inlined into `_external/<host>/...` so',
        'the offline copy stays self-contained. Cross-origin HTML/PHP links',
        'are kept as absolute URLs and were not crawled.',
        '',
        '## Stats',
        '- Pages: ' + visitedPages.size,
        '- Total bytes: ' + totalBytes.toLocaleString(),
        '- Asset budget: ' + o.maxTotalBytes.toLocaleString() + ' bytes',
        '- Budget hit: ' + (assetBudgetExceeded ? 'yes — some external assets remain as absolute links' : 'no'),
        '- Errors logged: ' + errors.length,
        '',
        '## Deploying',
        'All in-page paths have been rewritten to be relative to each',
        'document\'s own folder, so the bundle works:',
        '- on any static host (drop the contents of this archive into the',
        '  webroot of nginx/Apache/S3/Pages/etc.),',
        '- when opened directly from disk (`file://`).',
        '',
        '## Files',
        '- `EXPORT_MANIFEST.json` — machine-readable list of downloaded',
        '  files, external links, and crawl errors.',
        '',
        ''
    ].join('\n');
    // Use a distinct filename so we never shadow the site's own README.md.
    await zip.add('EXPORT_README.md', Buffer.from(readme, 'utf8'));

    return manifest;
}

// ---- Local site builder ----------------------------------------------------

async function buildLocalSite(zip, opts = {}) {
    const o = Object.assign({}, DEFAULTS.local, opts);
    const projectRoot = opts.projectRoot || path.resolve(__dirname, '..', '..');

    const publicDir = opts.publicDir || path.join(projectRoot, 'public');
    const restRoots = opts.restRoots || ['src', 'scripts', 'tests', 'package.json',
        'package-lock.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'Dockerfile',
        '.dockerignore', 'fly.toml', 'render.yaml', 'replit.nix', '.replit',
        '.eslintrc.json', '.prettierrc.json', 'Procfile', '.nvmrc'];

    let publicBytes = 0;
    let restBytes = 0;
    const skipped = []; // {path, reason}

    async function walk(absRoot, zipPrefix, accumulator, cap, kind) {
        if (!fs.existsSync(absRoot)) return;
        const stat = fs.lstatSync(absRoot);
        if (stat.isFile()) {
            if (accumulator.value + stat.size > cap) {
                if (kind === 'public') {
                    skipped.push({ path: zipPrefix, reason: 'public quota; left as link' });
                    return;
                }
                throw Object.assign(new Error('non-public quota exceeded'),
                    { code: 'REST_OVER_QUOTA', size: stat.size, limit: cap });
            }
            const data = fs.readFileSync(absRoot);
            await zip.add(zipPrefix, data);
            accumulator.value += data.length;
            return;
        }
        if (!stat.isDirectory()) return;
        for (const name of fs.readdirSync(absRoot).sort()) {
            if (o.excludeNames.has(name)) continue;
            if (o.excludeExt.has(path.extname(name).toLowerCase())) continue;
            const child = path.join(absRoot, name);
            await walk(child, (zipPrefix ? zipPrefix + '/' : '') + name, accumulator, cap, kind);
        }
    }

    const publicAcc = { value: 0 };
    if (fs.existsSync(publicDir) && fs.lstatSync(publicDir).isDirectory()) {
        await walk(publicDir, 'public', publicAcc, o.publicMaxBytes, 'public');
        publicBytes = publicAcc.value;
    }

    const restAcc = { value: 0 };
    let abortReason = null;
    try {
        for (const root of restRoots) {
            const abs = path.isAbsolute(root) ? root : path.join(projectRoot, root);
            const rel = path.basename(abs);
            await walk(abs, rel, restAcc, o.restMaxBytes, 'rest');
        }
    } catch (e) {
        if (e && e.code === 'REST_OVER_QUOTA') {
            abortReason = e;
        } else {
            throw e;
        }
    }
    restBytes = restAcc.value;

    const manifest = {
        mode: 'local',
        generatedAt: new Date().toISOString(),
        publicBytes,
        publicLimit: o.publicMaxBytes,
        restBytes,
        restLimit: o.restMaxBytes,
        skipped,
        aborted: abortReason ? { reason: abortReason.message, size: abortReason.size, limit: abortReason.limit } : null
    };
    await zip.add('EXPORT_MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    const readme = [
        '# Web Build Files Export — Local Mode',
        '',
        'This archive contains the rammerhead source tree (the live server',
        'you exported from). Use it to redeploy or fork the instance.',
        '',
        '## Layout',
        '- `public/` — static assets served by the proxy UI.',
        '- `src/`    — server source code.',
        '- top-level — `package.json`, build/deploy configs.',
        '',
        '## Quotas',
        '- public/  ≤ ' + o.publicMaxBytes.toLocaleString() + ' bytes (over-quota files left out, see EXPORT_MANIFEST.json)',
        '- non-public ≤ ' + o.restMaxBytes.toLocaleString() + ' bytes (hard cap; export aborts when hit)',
        '',
        '## Re-deploying',
        '1. `npm install`',
        '2. `npm start`',
        ''
    ].join('\n');
    // Distinct from the project's own README.md (which is included in the
    // archive at top level when present); this is the export's own notes.
    await zip.add('EXPORT_README.md', Buffer.from(readme, 'utf8'));

    return manifest;
}

module.exports = {
    fetchUrl,
    probeUrl,
    buildStaticSite,
    buildLocalSite,
    urlToZipPath,
    relativePath,
    DEFAULTS
};
