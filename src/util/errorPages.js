/**
 * Self-contained, theme-aware HTTP error pages for proxy-internal responses.
 *
 * The proxy historically replied to its own routing errors (bad session id, IP
 * mismatch, missing parameter, raw-fetch failure, …) with a single line of
 * `text/plain` like `not found` / `Bad Gateway`. That is jarring inside a
 * browser tab — nothing tells the user what happened or how to recover, and
 * scanners that grep for "rammerhead" / "hammerhead" in the body get a hit.
 *
 * This module replaces those bare responses with a small inline HTML page that
 *   • respects the user's OS light/dark theme via `prefers-color-scheme`
 *   • carries no external resources (no font/CDN/script — works in stealth
 *     mode and for failed-network responses)
 *   • includes `noindex,nofollow` so search engines never cache an error page
 *   • degrades gracefully to plain text for non-browser clients (curl, fetch
 *     calls from inside a proxied page, JSON-API consumers, …)
 *
 * The accept-negotiation rule is intentionally simple: send HTML when the
 * `Accept` header lists `text/html` (browsers always do for navigations).
 * Everything else — XHR/fetch with `Accept: application/json`, `*` only, or
 * no Accept header at all (curl) — gets a one-line plain-text body so we
 * don't break programmatic consumers.
 */

const STATUS_INFO = {
    400: {
        title: 'Bad Request',
        subtitle: "We couldn't process this request",
        description:
            'The request was malformed or contained invalid parameters. ' +
            'Try going back and reloading the page, or return to the home page.'
    },
    401: {
        title: 'Unauthorized',
        subtitle: 'Authentication required',
        description:
            'You need to provide valid credentials to access this resource. ' +
            'Sign in or return to the home page to continue.'
    },
    402: {
        title: 'Payment Required',
        subtitle: 'This resource requires payment',
        description:
            'Access to this resource requires a valid payment or subscription on the destination service.'
    },
    403: {
        title: 'Forbidden',
        subtitle: "You don't have permission to view this",
        description:
            'Either this session is locked to a different IP address, the password is incorrect, ' +
            'or the destination site refused the request. Return to the home page to start a new session.'
    },
    404: {
        title: 'Page Not Found',
        subtitle: "We couldn't find that page",
        description:
            'The address you entered does not match any open session, route, or static asset on this server. ' +
            'Double-check the URL or head back to the home page.'
    },
    405: {
        title: 'Method Not Allowed',
        subtitle: 'That HTTP method is not supported here',
        description:
            'The endpoint exists but does not accept the request method you used (GET / POST / PUT / …).'
    },
    408: {
        title: 'Request Timeout',
        subtitle: 'The request took too long',
        description:
            'The server gave up waiting for the rest of the request. Check your connection and try again.'
    },
    410: {
        title: 'Gone',
        subtitle: 'This resource is no longer available',
        description:
            'The session or page you were looking for has been permanently removed. ' +
            'Return to the home page to start fresh.'
    },
    418: {
        title: "I'm a Teapot",
        subtitle: "I can't brew coffee",
        description: 'This server refuses to brew coffee because it is, permanently, a teapot.'
    },
    429: {
        title: 'Too Many Requests',
        subtitle: 'Slow down a moment',
        description:
            'You have sent too many requests in a short period of time. ' +
            'Wait a few seconds and try again, or return to the home page.'
    },
    500: {
        title: 'Internal Server Error',
        subtitle: 'Something went wrong on our end',
        description:
            'An unexpected error occurred while processing the request. ' +
            'This has been logged — try again in a moment, or return to the home page.'
    },
    501: {
        title: 'Not Implemented',
        subtitle: 'This feature is not available',
        description: 'The server does not support the functionality required to fulfil the request.'
    },
    502: {
        title: 'Bad Gateway',
        subtitle: "We couldn't reach the destination",
        description:
            'The upstream server returned an invalid response, refused the connection, or failed to respond. ' +
            'Try again in a moment, or return to the home page.'
    },
    503: {
        title: 'Service Unavailable',
        subtitle: 'The service is temporarily unavailable',
        description:
            'The server is overloaded or undergoing maintenance. ' +
            'Wait a moment and try again, or return to the home page.'
    },
    504: {
        title: 'Gateway Timeout',
        subtitle: 'The destination took too long to respond',
        description:
            'We waited for the upstream server but it never replied. ' +
            'Try again in a moment, or return to the home page.'
    },
    505: {
        title: 'HTTP Version Not Supported',
        subtitle: 'Unsupported HTTP version',
        description: 'The HTTP protocol version used in the request is not supported by this server.'
    }
};

const DEFAULT_INFO = {
    title: 'Unexpected Error',
    subtitle: 'Something went wrong',
    description: 'The server returned an unexpected status code. Try going back or returning to the home page.'
};

function getStatusInfo(status) {
    return STATUS_INFO[status] || DEFAULT_INFO;
}

// Cheap but safe HTML escape — used for the optional caller-provided detail
// (request URL, error message, …). We never hand-craft an attribute value from
// untrusted input, so escaping the standard 5 characters is enough.
function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// `clientWantsHtml` — does the request look like a browser navigation that we
// should answer with a styled page? We require an explicit `text/html` token
// in `Accept`; XHR/fetch from inside a proxied page sends `*/*` or
// `application/json` and gets the plain-text body so it can be decoded the
// way the caller expects (JSON parser, error toast, …).
function clientWantsHtml(req) {
    if (!req || !req.headers) return false;
    const accept = String(req.headers['accept'] || '').toLowerCase();
    if (!accept) return false;
    if (accept.indexOf('text/html') !== -1) return true;
    return false;
}

function renderErrorPage(status, options) {
    const info = getStatusInfo(status);
    options = options || {};
    const title = options.title || info.title;
    const subtitle = options.subtitle || info.subtitle;
    const description = options.description || info.description;
    const detail = options.detail ? escapeHtml(options.detail) : '';
    const homeHref = options.homeHref || '/';
    const requestId = options.requestId ? escapeHtml(options.requestId) : '';

    // Inline everything — no external font, CSS, JS, or image. This keeps the
    // page renderable when the network is broken and prevents content-scanners
    // from fingerprinting the proxy via a known asset URL.
    return [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="robots" content="noindex,nofollow">',
        '<meta name="referrer" content="no-referrer">',
        '<title>' + escapeHtml(status + ' — ' + title) + '</title>',
        '<style>',
        ':root{',
        '--bg:#fafafa;--surface:#ffffff;--fg:#1a1a1a;--mu:#5f6368;',
        '--border:#e5e7eb;--accent:#1a73e8;--accent-hover:#1557b0;',
        '--code-bg:#f1f3f4;--code-fg:#202124;--shadow:0 4px 24px rgba(0,0,0,0.06);',
        '}',
        '@media (prefers-color-scheme:dark){:root{',
        '--bg:#0f1014;--surface:#181a20;--fg:#e8eaed;--mu:#9aa0a6;',
        '--border:#2a2d33;--accent:#8ab4f8;--accent-hover:#aecbfa;',
        '--code-bg:#23262d;--code-fg:#e8eaed;--shadow:0 4px 24px rgba(0,0,0,0.4);',
        '}}',
        '*{box-sizing:border-box}',
        'html,body{margin:0;padding:0;height:100%}',
        'body{',
        "font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,'Helvetica Neue',sans-serif;",
        'background:var(--bg);color:var(--fg);',
        '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
        '}',
        'main{min-height:100vh;display:grid;place-items:center;padding:32px 20px}',
        '.card{',
        'width:100%;max-width:520px;background:var(--surface);border:1px solid var(--border);',
        'border-radius:16px;padding:36px 32px 28px;box-shadow:var(--shadow);text-align:center;',
        '}',
        '.code{',
        'display:inline-flex;align-items:center;justify-content:center;',
        'min-width:96px;height:40px;padding:0 16px;border-radius:999px;',
        'background:var(--code-bg);color:var(--code-fg);',
        "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace;",
        'font-size:14px;font-weight:600;letter-spacing:0.04em;margin-bottom:18px;',
        '}',
        'h1{font-size:28px;line-height:1.2;margin:0 0 6px;font-weight:600;letter-spacing:-0.01em}',
        '.sub{color:var(--mu);font-size:15px;margin:0 0 18px}',
        'p.desc{color:var(--mu);margin:0 0 24px;font-size:14px;line-height:1.6}',
        '.detail{',
        'text-align:left;background:var(--code-bg);color:var(--code-fg);',
        'border-radius:10px;padding:12px 14px;margin:0 0 22px;',
        "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace;",
        'font-size:12.5px;line-height:1.55;word-break:break-word;white-space:pre-wrap;',
        'max-height:160px;overflow:auto;',
        '}',
        '.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}',
        '.btn{',
        'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;',
        'border-radius:10px;text-decoration:none;font-weight:500;font-size:14px;',
        'border:1px solid var(--border);background:transparent;color:var(--fg);cursor:pointer;',
        'transition:background 120ms ease,color 120ms ease,border-color 120ms ease;',
        '}',
        '.btn:hover{background:var(--code-bg);border-color:var(--mu)}',
        '.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}',
        '.btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);color:#fff}',
        '.rid{margin-top:18px;color:var(--mu);font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0.02em}',
        '@media (max-width:480px){.card{padding:28px 22px 22px}h1{font-size:24px}}',
        '</style>',
        '</head>',
        '<body>',
        '<main>',
        '<section class="card" role="alert" aria-live="polite">',
        '<div class="code" aria-hidden="true">' + escapeHtml(String(status)) + '</div>',
        '<h1>' + escapeHtml(title) + '</h1>',
        '<p class="sub">' + escapeHtml(subtitle) + '</p>',
        '<p class="desc">' + escapeHtml(description) + '</p>',
        detail ? '<pre class="detail">' + detail + '</pre>' : '',
        '<div class="actions">',
        '<button class="btn" type="button" onclick="if(history.length>1){history.back()}else{location.href=' +
            JSON.stringify(homeHref) +
            '}">Go back</button>',
        '<a class="btn btn-primary" href="' + escapeHtml(homeHref) + '">Home</a>',
        '</div>',
        requestId ? '<div class="rid">Request ID: ' + requestId + '</div>' : '',
        '</section>',
        '</main>',
        '</body>',
        '</html>'
    ]
        .filter(Boolean)
        .join('\n');
}

// Plain-text fallback for programmatic clients. Format mirrors the standard
// reason-phrase line — keeps existing curl/fetch consumers happy.
function renderErrorText(status, options) {
    const info = getStatusInfo(status);
    options = options || {};
    const title = options.title || info.title;
    const description = options.detail || options.description || info.description;
    return status + ' ' + title + '\n\n' + description + '\n';
}

/**
 * Send an error response to `res`, choosing HTML or plain text based on the
 * `Accept` header of `req`. Safe to call from within a request pipeline — if
 * headers were already sent we silently drop the response (writing twice would
 * crash the worker).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {number} status - HTTP status code
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.subtitle]
 * @param {string} [options.description]
 * @param {string} [options.detail] - extra detail (request URL, error message)
 * @param {string} [options.homeHref] - link target for the "Home" button
 * @param {string} [options.requestId] - shown at the bottom of the page
 * @param {object} [options.headers] - extra headers to merge in
 */
function sendErrorPage(req, res, status, options) {
    if (res && res.headersSent) return;
    options = options || {};

    const wantsHtml = clientWantsHtml(req);
    const headers = Object.assign(
        {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'X-Robots-Tag': 'noindex, nofollow',
            'Referrer-Policy': 'no-referrer'
        },
        options.headers || {}
    );

    let body;
    if (wantsHtml) {
        body = renderErrorPage(status, options);
        headers['Content-Type'] = 'text/html; charset=utf-8';
    } else {
        body = renderErrorText(status, options);
        headers['Content-Type'] = 'text/plain; charset=utf-8';
    }
    headers['Content-Length'] = Buffer.byteLength(body);

    try {
        res.writeHead(status, headers);
        if (req && req.method === 'HEAD') {
            res.end();
        } else {
            res.end(body);
        }
    } catch (_) {
        // res may have been torn down underneath us (client disconnect, etc.) —
        // intentionally swallow so the calling pipeline keeps running.
    }
}

module.exports = {
    STATUS_INFO,
    getStatusInfo,
    renderErrorPage,
    renderErrorText,
    sendErrorPage,
    clientWantsHtml
};
