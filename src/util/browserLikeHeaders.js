/**
 * Browser-like headers to bypass 403 from sites like Discord, Poki that block
 * requests that don't look like a real browser.
 * Injected into proxied requests (isRoute) before they reach hammerhead.
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

/**
 * @param {http.IncomingMessage} req
 * @param {boolean} isRoute
 */
function injectBrowserLikeHeaders(req, isRoute) {
    if (!isRoute || !req.headers) return;

    const dest = req.headers['sec-fetch-dest'];
    const mode = req.headers['sec-fetch-mode'];
    const isDoc = !dest || dest === 'document' || mode === 'navigate';

    const headersToInject = isDoc ? DOCUMENT_HEADERS : SUBRESOURCE_HEADERS;

    for (const [name, value] of Object.entries(headersToInject)) {
        const lower = name.toLowerCase();
        const existing = req.headers[lower];
        if (!existing || lower === 'user-agent' || lower === 'accept') {
            req.headers[lower] = value;
        }
    }
}

module.exports = { injectBrowserLikeHeaders };
