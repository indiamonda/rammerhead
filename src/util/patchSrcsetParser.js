/**
 * Patch testcafe-hammerhead's handleUrlsSet to correctly tokenize srcset
 * attributes per WHATWG spec.
 *
 * Hammerhead's stock implementation does `url.split(',')` to extract the
 * comma-separated URLs of a srcset. That breaks on URLs that legitimately
 * contain commas inside the path (Cloudflare cdn-cgi image-resize URLs are
 * the classic case: `/cdn-cgi/image/q=78,scq=50,width=94,fit=cover/...`).
 *
 * Per WHATWG `parse a srcset attribute` algorithm, a srcset value is parsed
 * by:
 *   1. Skipping whitespace.
 *   2. Collecting a run of non-whitespace characters as the URL.
 *   3. If the URL doesn't end with `,`, parsing optional descriptors after
 *      whitespace. Descriptors look like `2x`, `100w`, `1.5x`, etc.
 *   4. The candidate is terminated when the parser hits a `,` AT THE
 *      DESCRIPTOR LEVEL (not inside a URL).
 *
 * Concretely: COMMAS INSIDE THE URL (no whitespace yet) are part of the URL.
 * COMMAS AFTER A DESCRIPTOR are candidate separators.
 *
 * That's exactly what real browsers do — Chrome happily fetches Cloudflare
 * image-resize URLs from srcset. Hammerhead's split-by-comma misparses these
 * and emits a Frankenstein "url1,url2_fragment,url3_fragment..." that the
 * server can't decode (404/403).
 */

const urlUtils = require('testcafe-hammerhead/lib/utils/url');

function smartHandleUrlsSet(handler, input, ...args) {
    if (!input || typeof input !== 'string') return input;
    const candidates = [];
    let i = 0;
    const n = input.length;

    while (i < n) {
        while (i < n && _isWs(input.charCodeAt(i))) i++;
        if (i >= n) break;

        const urlStart = i;
        while (i < n && !_isWs(input.charCodeAt(i))) i++;
        let url = input.substring(urlStart, i);

        // Trailing comma on the URL itself — the URL was directly followed by
        // `,nextUrl` with no whitespace. Strip trailing commas and emit URL-only.
        let trailingCommas = 0;
        while (url.length && url.charCodeAt(url.length - 1) === 0x2C /* , */) {
            url = url.slice(0, -1);
            trailingCommas++;
        }

        if (!url) continue;

        if (trailingCommas > 0) {
            candidates.push({ url, descriptors: '' });
            continue;
        }

        while (i < n && _isWs(input.charCodeAt(i))) i++;

        // Collect descriptors until the candidate-terminating comma.
        // Parens depth tracking keeps `(min-width: 600px)` style content intact.
        const descStart = i;
        let parenDepth = 0;
        while (i < n) {
            const cc = input.charCodeAt(i);
            if (cc === 0x28) parenDepth++;
            else if (cc === 0x29 && parenDepth) parenDepth--;
            else if (cc === 0x2C /* , */ && parenDepth === 0) break;
            i++;
        }
        const descriptors = input.substring(descStart, i).trim();

        if (!descriptors && url.indexOf(',') !== -1) {
            // Heuristic: URL has internal commas BUT no descriptor was found.
            // Authors sometimes write `url1,url2,url3` (no descriptors). Real
            // URLs that legitimately contain commas (Cloudflare cdn-cgi/image
            // URLs) ALWAYS have a descriptor in practice — a descriptor was
            // collected above so this branch isn't taken for those. Fall back
            // to comma-splitting to handle malformed-but-common author input.
            for (const u of url.split(',')) {
                const t = u.trim();
                if (t) candidates.push({ url: t, descriptors: '' });
            }
        } else {
            candidates.push({ url, descriptors });
        }

        if (i < n && input.charCodeAt(i) === 0x2C) i++;
    }

    if (!candidates.length) return input;

    const out = [];
    for (const c of candidates) {
        const replaced = handler(c.url, ...args);
        out.push(c.descriptors ? `${replaced} ${c.descriptors}` : replaced);
    }
    return out.join(', ');
}

function _isWs(cc) {
    return cc === 0x20 /* space */
        || cc === 0x09 /* TAB */
        || cc === 0x0A /* LF */
        || cc === 0x0C /* FF */
        || cc === 0x0D /* CR */;
}

const _origHandleUrlsSet = urlUtils.handleUrlsSet;
urlUtils.handleUrlsSet = smartHandleUrlsSet;
exports._origHandleUrlsSet = _origHandleUrlsSet;
exports.smartHandleUrlsSet = smartHandleUrlsSet;
