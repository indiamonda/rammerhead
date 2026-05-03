/**
 * Replace Hammerhead's HTTPS destination requests with wreq-js.
 *
 * wreq-js uses curl-impersonate (BoringSSL) to produce a Chrome-identical
 * TLS ClientHello (JA3/JA4 fingerprint). This is the single biggest factor
 * in bypassing Cloudflare / DataDome / PerimeterX bot detection at the
 * network layer — the challenge page is never served when the TLS looks real.
 *
 * We monkey-patch DestinationRequest.prototype._send so that HTTPS requests
 * go through wreq-js while HTTP requests use the original Node pipeline.
 */

const { Readable } = require('stream');

let wreq;
try {
    wreq = require('wreq-js');
} catch (_) {
    // wreq-js not installed — skip patch
}

if (wreq) {
    const DestinationRequest = require('testcafe-hammerhead/lib/request-pipeline/destination-request/index');
    const requestCache = require('testcafe-hammerhead/lib/request-pipeline/cache');
    const { connectionResetGuard } = require('testcafe-hammerhead/lib/request-pipeline/connection-reset-guard');

    const BROWSER_PROFILE = 'chrome_131';
    const WREQ_TIMEOUT_MS = 30000;

    function headersObjFromWreq(wreqHeaders) {
        const out = Object.create(null);
        if (!wreqHeaders) return out;
        if (typeof wreqHeaders.forEach === 'function') {
            wreqHeaders.forEach((v, k) => {
                const lower = k.toLowerCase();
                if (lower in out) {
                    const prev = out[lower];
                    out[lower] = Array.isArray(prev) ? [...prev, v] : [prev, v];
                } else {
                    out[lower] = v;
                }
            });
        }
        return out;
    }

    function buildUrl(opts) {
        const proto = opts.protocol || (opts.isHttps ? 'https:' : 'http:');
        const host = opts.host || opts.hostname;
        const path = opts.path || '/';
        return `${proto}//${host}${path}`;
    }

    const SAFE_ACCEPT_ENCODING = 'gzip, deflate, br';

    function buildWreqHeaders(opts) {
        const headers = {};
        const raw = opts.headers || (opts.prepare ? opts.prepare().headers : null) || {};
        for (const [k, v] of Object.entries(raw)) {
            if (v === undefined || v === null) continue;
            const lower = k.toLowerCase();
            if (lower === 'host') continue;
            if (lower === 'accept-encoding') {
                headers[k] = SAFE_ACCEPT_ENCODING;
                continue;
            }
            headers[k] = String(v);
        }
        if (!headers['accept-encoding'] && !headers['Accept-Encoding']) {
            headers['accept-encoding'] = SAFE_ACCEPT_ENCODING;
        }
        return headers;
    }

    const _origSend = DestinationRequest.prototype._send;

    DestinationRequest.prototype._send = async function patchedSend(waitForData) {
        if (!this.opts.isHttps) {
            return _origSend.call(this, waitForData);
        }

        if (this.opts.isWebSocket) {
            return _origSend.call(this, waitForData);
        }

        if (this.cache) {
            const cachedResponse = requestCache.getResponse(this.opts);
            if (cachedResponse) {
                setImmediate(() => this._emitOnResponse(cachedResponse.res));
                return;
            }
        }

        const url = buildUrl(this.opts);
        const method = (this.opts.method || 'GET').toUpperCase();
        const headers = buildWreqHeaders(this.opts);
        const body = this.opts.body && this.opts.body.length ? this.opts.body : undefined;

        const fetchOpts = {
            method,
            headers,
            browser: BROWSER_PROFILE,
            redirect: 'manual',
            // Let wreq-js decompress response bodies (the default). We strip the
            // Content-Encoding header below so downstream sees raw bytes.
            // Hammerhead's decodeContent gracefully handles encoding='' (no-op),
            // and our gzip middleware re-compresses text for the browser.
            // This avoids the fragile compress:false path where the Rust layer
            // may or may not actually skip decompression, leading to
            // ERR_CONTENT_DECODING_FAILED / "WOFF 2.0 size" mismatches.
        };
        if (body && method !== 'GET' && method !== 'HEAD') {
            fetchOpts.body = body;
        }

        const self = this;
        self.req = {
            destroy: () => {},
            on: () => {},
            setTimeout: () => {},
            write: () => {},
            end: () => {},
            socket: { destroyed: false },
        };

        connectionResetGuard(async () => {
            let timer;
            try {
                const wreqPromise = wreq.fetch(url, fetchOpts);
                const timeoutPromise = new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('wreq-js timeout')), WREQ_TIMEOUT_MS);
                });

                const wreqRes = await Promise.race([wreqPromise, timeoutPromise]);
                clearTimeout(timer);

                const statusCode = wreqRes.status;
                const resHeaders = headersObjFromWreq(wreqRes.headers);
                let buf = Buffer.from(await wreqRes.arrayBuffer());

                // wreq-js decompresses the body (compress defaults to true).
                // Strip content-encoding so downstream doesn't try to decompress
                // again. Content-length is also stale after decompression.
                delete resHeaders['content-encoding'];
                delete resHeaders['content-length'];

                const fakeRes = new Readable({ read() {} });
                fakeRes.statusCode = statusCode;
                fakeRes.statusMessage = wreqRes.statusText || '';
                fakeRes.headers = resHeaders;
                fakeRes.rawHeaders = [];
                for (const [k, v] of Object.entries(resHeaders)) {
                    const vals = Array.isArray(v) ? v : [v];
                    for (const val of vals) {
                        fakeRes.rawHeaders.push(k, val);
                    }
                }
                fakeRes.trailers = {};
                fakeRes.setEncoding = function (enc) {
                    this._readableState.encoding = enc;
                    return this;
                };

                fakeRes.push(buf);
                fakeRes.push(null);

                self._onResponse(fakeRes);
            } catch (err) {
                clearTimeout(timer);
                // Fall back to the original Node.js pipeline on wreq-js failure
                try {
                    _origSend.call(self, waitForData);
                } catch (_) {
                    self._onError(err);
                }
            }
        });
    };
}
