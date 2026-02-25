/**
 * Browser-like headers to bypass 403 from sites that block non-browser requests.
 * Injected into proxied requests (sessionId + destination URL) before hammerhead.
 * Session proxy requests have isRoute=false, so we detect by URL pattern.
 */

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DOCUMENT_HEADERS = {
    'user-agent': CHROME_UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'cache-control': 'max-age=0',
    'connection': 'keep-alive',
};

const SUBRESOURCE_HEADERS = {
    'user-agent': CHROME_UA,
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
};

// Match both unshuffled (https://...) and shuffled (_rhs~...) proxy URLs
const PROXY_REQUEST_RE = /^\/[a-z0-9]{32}\/(?:https?:\/\/[^/]+|_rhs~)/i;

function isProxiedRequest(req) {
    if (!req?.url) return false;
    return PROXY_REQUEST_RE.test(req.url.split('?')[0]);
}

/**
 * @param {http.IncomingMessage} req
 * @param {boolean} isRoute - from pipeline; session proxy requests are false
 */
function injectBrowserLikeHeaders(req, isRoute) {
    if (!req?.headers) return;
    if (!isRoute && !isProxiedRequest(req)) return;

    const dest = req.headers['sec-fetch-dest'];
    const mode = req.headers['sec-fetch-mode'];
    const isDoc = !dest || dest === 'document' || mode === 'navigate';

    const headersToInject = isDoc ? DOCUMENT_HEADERS : SUBRESOURCE_HEADERS;

    for (const [name, value] of Object.entries(headersToInject)) {
        const lower = name.toLowerCase();
        req.headers[lower] = value;
    }

}

module.exports = { injectBrowserLikeHeaders };
