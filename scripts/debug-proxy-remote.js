#!/usr/bin/env node
/**
 * Debug proxy on a remote host (e.g. studyboard.fly.dev).
 * Simulates browser: ensure session → get proxied URL → fetch document.
 * Run: node scripts/debug-proxy-remote.js [BASE_URL]
 * Example: node scripts/debug-proxy-remote.js https://studyboard.fly.dev
 *
 * If document request returns 404 while getresourceurl returns 200, requests
 * are likely hitting different Fly machines (need 1 machine or Upstash Redis).
 */

const BASE = process.argv[2] || 'https://studyboard.fly.dev';
// Must be 32 hex chars so proxy getSessionId() and session store recognize it
const sessionId = Array.from(require('crypto').randomBytes(16)).map(b => b.toString(16).padStart(2, '0')).join('');

async function fetchJson(url) {
    const res = await fetch(url);
    const text = await res.text();
    try {
        return { status: res.status, data: JSON.parse(text) };
    } catch {
        return { status: res.status, data: text };
    }
}

async function main() {
    console.log('Base URL:', BASE);
    console.log('Session ID:', sessionId);
    console.log('');

    const r1 = await fetchJson(`${BASE}/ensuresession?id=${sessionId}`);
    console.log('GET /ensuresession:', r1.status, r1.data);
    if (r1.status !== 200) {
        console.log('Abort: ensure session failed');
        process.exit(1);
    }

    const r2 = await fetchJson(`${BASE}/getresourceurl?id=${sessionId}&url=${encodeURIComponent('https://example.com/')}`);
    console.log('GET /getresourceurl (example.com):', r2.status, r2.data?.proxiedUrl || r2.data);
    if (r2.status !== 200 || !r2.data?.proxiedUrl) {
        console.log('Abort: getresourceurl failed');
        process.exit(1);
    }

    const docUrl = r2.data.proxiedUrl.startsWith('http') ? r2.data.proxiedUrl : BASE.replace(/\/$/, '') + r2.data.proxiedUrl;
    console.log('Fetching document:', docUrl);
    const r3 = await fetch(docUrl);
    console.log('GET document (example.com):', r3.status, r3.statusText);
    if (r3.status !== 200) {
        console.log('');
        console.log('>>> 404/500 on document = session not on this machine (multi-instance).');
        console.log('>>> Fix: fly.toml min_machines_running = 1, or set Upstash Redis secrets.');
    } else {
        const len = (await r3.text()).length;
        console.log('Document length:', len, 'bytes');
    }

    console.log('');
    const r4 = await fetchJson(`${BASE}/getresourceurl?id=${sessionId}&url=${encodeURIComponent('https://www.google.com/')}`);
    console.log('GET /getresourceurl (google):', r4.status);
    if (r4.status === 200 && r4.data?.proxiedUrl) {
        const docUrl2 = r4.data.proxiedUrl.startsWith('http') ? r4.data.proxiedUrl : BASE.replace(/\/$/, '') + r4.data.proxiedUrl;
        const r5 = await fetch(docUrl2);
        console.log('GET document (google):', r5.status, r5.statusText);
        if (r5.status !== 200) {
            console.log('');
            console.log('>>> Second document 404 = load balancer sent request to different machine.');
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
