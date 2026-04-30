/**
 * Monkey-patch hammerhead's outgoing TLS + HTTP/2 settings to mimic Chrome 131.
 *
 * Without this, Cloudflare/AWS WAF block requests based on:
 *   - JA3/JA4 TLS fingerprint (cipher order, curves, sigalgs)
 *   - HTTP/2 fingerprint (SETTINGS frame values, WINDOW_UPDATE, ALPN, pseudo-header order)
 *
 * Patches:
 *  1. agent.assign – injects Chrome TLS options into HTTPS request options
 *  2. http2.connect – injects Chrome TLS options + Chrome HTTP/2 SETTINGS
 *  3. formatRequestHttp2Headers – Chrome pseudo-header order (:method :authority :scheme :path)
 */

const agentModule = require('testcafe-hammerhead/lib/request-pipeline/destination-request/agent');
const http2Module = require('testcafe-hammerhead/lib/request-pipeline/destination-request/http2');
const http2 = require('http2');

const CHROME_CIPHERS = [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA',
].join(':');

const CHROME_SIGALGS = [
    'ecdsa_secp256r1_sha256',
    'rsa_pss_rsae_sha256',
    'rsa_pkcs1_sha256',
    'ecdsa_secp384r1_sha384',
    'rsa_pss_rsae_sha384',
    'rsa_pkcs1_sha384',
    'rsa_pss_rsae_sha512',
    'rsa_pkcs1_sha512',
].join(':');

const CHROME_TLS = {
    ciphers: CHROME_CIPHERS,
    ecdhCurve: 'X25519:P-256:P-384',
    sigalgs: CHROME_SIGALGS,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: ['h2', 'http/1.1'],
    rejectUnauthorized: false,
};

// Chrome 131 HTTP/2 SETTINGS frame values (order matters for fingerprinting)
const CHROME_H2_SETTINGS = {
    headerTableSize: 65536,
    enablePush: false,
    maxConcurrentStreams: 1000,
    initialWindowSize: 6291456,
    maxHeaderListSize: 262144,
};

// Chrome sends WINDOW_UPDATE(15663105) after SETTINGS, making the connection
// window 65535 + 15663105 = 15728640
const CHROME_H2_WINDOW_SIZE = 15728640;

// 1. Patch HTTP/1.1: set Chrome TLS options on every HTTPS request
const originalAssign = agentModule.assign;
agentModule.assign = function (reqOpts) {
    originalAssign(reqOpts);
    if (reqOpts.isHttps || reqOpts.protocol === 'https:') {
        // CRITICAL: For WebSocket upgrades we MUST force http/1.1 ALPN. WebSockets
        // cannot run over HTTP/2 with Node's http.request — if ALPN negotiates h2
        // (which Cloudflare-fronted hosts like gateway.discord.gg always prefer),
        // Node receives raw H2 binary frames on the socket, and its HTTP/1 parser
        // throws "Parse Error: Expected HTTP/, RTSP/ or ICE/" → the upgrade silently
        // fails. Browsers solve this by sending a different ALPN list for WS, so
        // we mirror that here. Symptoms before this fix: every WS-using site
        // (Discord gateway, Twitch chat, jchat, Douyin) showed
        // `[WS CLOSED] (false, 0, An error with the websocket occurred)` in the
        // page console with no further detail.
        if (reqOpts.isWebSocket) {
            Object.assign(reqOpts, CHROME_TLS, { ALPNProtocols: ['http/1.1'] });
        } else {
            Object.assign(reqOpts, CHROME_TLS);
        }
    }
};

// 2. Patch HTTP/2: inject Chrome TLS + HTTP/2 SETTINGS when creating sessions
const originalHttp2Connect = http2.connect;
http2.connect = function (authority, options, listener) {
    if (typeof authority === 'string' && authority.startsWith('https:')) {
        const base = typeof options === 'object' && options !== null ? options : {};
        options = Object.assign({}, base, CHROME_TLS, {
            settings: Object.assign({}, base.settings || {}, CHROME_H2_SETTINGS),
        });
    }
    const session = originalHttp2Connect.call(this, authority, options, listener);
    if (typeof authority === 'string' && authority.startsWith('https:') && session) {
        try {
            session.setLocalWindowSize(CHROME_H2_WINDOW_SIZE);
        } catch (_) {}
    }
    return session;
};

// 3. Patch HTTP/2 pseudo-header order to match Chrome: :method :authority :scheme :path
const { HTTP2_HEADER_METHOD, HTTP2_HEADER_PATH, HTTP2_HEADER_AUTHORITY, HTTP2_HEADER_SCHEME,
    HTTP2_HEADER_CONNECTION, HTTP2_HEADER_UPGRADE, HTTP2_HEADER_KEEP_ALIVE,
    HTTP2_HEADER_PROXY_CONNECTION, HTTP2_HEADER_TRANSFER_ENCODING, HTTP2_HEADER_HTTP2_SETTINGS,
    HTTP2_HEADER_HOST } = http2.constants;
const H2_UNSUPPORTED = new Set([
    HTTP2_HEADER_CONNECTION, HTTP2_HEADER_UPGRADE, HTTP2_HEADER_HTTP2_SETTINGS,
    HTTP2_HEADER_KEEP_ALIVE, HTTP2_HEADER_PROXY_CONNECTION,
    HTTP2_HEADER_TRANSFER_ENCODING, HTTP2_HEADER_HOST,
]);
http2Module.formatRequestHttp2Headers = function chromeOrderHeaders(opts) {
    const out = Object.create(null);
    out[HTTP2_HEADER_METHOD] = opts.method;
    out[HTTP2_HEADER_AUTHORITY] = opts.headers.host;
    out[HTTP2_HEADER_SCHEME] = 'https';
    out[HTTP2_HEADER_PATH] = opts.path;
    for (const key of Object.keys(opts.headers)) {
        if (!H2_UNSUPPORTED.has(key)) out[key] = opts.headers[key];
    }
    return out;
};
