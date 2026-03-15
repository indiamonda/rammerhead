/**
 * Monkey-patch hammerhead's outgoing TLS + HTTP/2 settings to mimic Chrome 131.
 *
 * Without this, Cloudflare/AWS WAF block requests based on:
 *   - JA3/JA4 TLS fingerprint (cipher order, curves, sigalgs)
 *   - HTTP/2 fingerprint (SETTINGS frame values, WINDOW_UPDATE, ALPN)
 *
 * Patches:
 *  1. agent.assign – injects Chrome TLS options into HTTPS request options
 *  2. http2.connect – injects Chrome TLS options + Chrome HTTP/2 SETTINGS
 */

const agentModule = require('testcafe-hammerhead/lib/request-pipeline/destination-request/agent');
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
        Object.assign(reqOpts, CHROME_TLS);
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
