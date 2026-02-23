#!/usr/bin/env node
/**
 * Debug script: test URLs through the proxy.
 * Reports every unique error type with counts.
 *
 * Usage:
 *   node scripts/debug-urls.js
 *   BASE_URL=http://localhost:8080 node scripts/debug-urls.js
 *   DEBUG_ITERATIONS=3 node scripts/debug-urls.js
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const ITERATIONS = parseInt(process.env.DEBUG_ITERATIONS || '5', 10);

function loadConfig() {
    if (process.env.DEBUG_URLS) {
        return {
            urls: process.env.DEBUG_URLS.split(',').map((u) => u.trim()).filter(Boolean),
            known403Hosts: []
        };
    }
    const configPath = path.join(__dirname, '../debug-urls.json');
    if (fs.existsSync(configPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return {
                urls: Array.isArray(data.urls) ? data.urls : [],
                known403Hosts: Array.isArray(data.known403Hosts) ? data.known403Hosts : []
            };
        } catch (_) {}
    }
    return { urls: [], known403Hosts: [] };
}

const { urls: DEBUG_URLS, known403Hosts } = loadConfig();
if (DEBUG_URLS.length === 0) {
    console.error('No URLs to test. Set DEBUG_URLS env or create debug-urls.json with {"urls":["https://..."]}');
    process.exit(1);
}

const STATIC_PATHS = ['/', '/favicon.png', '/manifest.json'];
const ACCEPTABLE_CODES = new Set([200, 201, 202, 301, 302]);

async function fetchStatus(url, opts = {}) {
    try {
        const res = await fetch(url, { redirect: 'follow', ...opts });
        return { status: res.status, ok: res.ok };
    } catch (e) {
        return { status: 0, ok: false, error: e.message };
    }
}

function errorKey(type, value) {
    return `${type}:${value}`;
}

async function run() {
    const errorCounts = new Map(); // "path:404" -> count, "hostname:403" -> count, "error:msg" -> count
    let totalRuns = 0;
    let successfulRuns = 0;

    for (let run = 1; run <= ITERATIONS; run++) {
        totalRuns++;
        const runErrors = [];
        try {
            const sessionRes = await fetch(`${BASE}/newsession`);
            const session = await sessionRes.text();
            if (!session || session.length < 10) {
                const k = errorKey('session', 'no-session');
                errorCounts.set(k, (errorCounts.get(k) || 0) + 1);
                runErrors.push(k);
            } else {
                for (const p of STATIC_PATHS) {
                    const { status } = await fetchStatus(`${BASE}${p}`);
                    if (!ACCEPTABLE_CODES.has(status)) {
                        const k = errorKey('static', `${p}:${status}`);
                        errorCounts.set(k, (errorCounts.get(k) || 0) + 1);
                        runErrors.push(k);
                    }
                }
                for (const url of DEBUG_URLS) {
                    const { status } = await fetchStatus(`${BASE}/${session}/${url}`);
                    const host = new URL(url).hostname;
                    const isKnown403 = status === 403 && known403Hosts.includes(host);
                    if (isKnown403) continue; // Known anti-bot 403, don't fail
                    if (!ACCEPTABLE_CODES.has(status) || status === 500) {
                        const k = errorKey('proxy', `${host}:${status}`);
                        errorCounts.set(k, (errorCounts.get(k) || 0) + 1);
                        runErrors.push(k);
                    }
                }
            }
        } catch (e) {
            const k = errorKey('error', e.message);
            errorCounts.set(k, (errorCounts.get(k) || 0) + 1);
            runErrors.push(k);
        }
        if (runErrors.length === 0) {
            successfulRuns++;
            console.log(`Run ${run} OK`);
        } else {
            console.log(`Run ${run} FAIL: ${[...new Set(runErrors)].join(' ')}`);
        }
    }

    // Summary: every unique error type
    console.log('\n=== ERROR TYPES (all unique) ===');
    const byType = { session: [], static: [], proxy: [], error: [] };
    for (const [k, count] of errorCounts) {
        const idx = k.indexOf(':');
        const type = idx >= 0 ? k.slice(0, idx) : 'other';
        const rest = idx >= 0 ? k.slice(idx + 1) : k;
        const entry = `${rest} (×${count})`;
        if (byType[type]) byType[type].push(entry);
    }
    for (const [type, entries] of Object.entries(byType)) {
        if (entries.length) {
            console.log(`\n${type.toUpperCase()}:`);
            entries.sort().forEach((e) => console.log(`  ${e}`));
        }
    }

    // By status code
    const byStatus = new Map();
    for (const [k, count] of errorCounts) {
        const m = k.match(/:(\d+)$/);
        if (m) {
            const code = parseInt(m[1], 10);
            byStatus.set(code, (byStatus.get(code) || 0) + count);
        }
    }
    if (byStatus.size) {
        console.log('\nBY STATUS CODE:');
        for (const [code, count] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
            console.log(`  ${code}: ${count} occurrences`);
        }
    }

    if (known403Hosts.length) {
        console.log(`\nKnown 403 hosts (excluded from fail): ${known403Hosts.join(', ')}`);
    }
    console.log('\n---');
    console.log(`Runs: ${successfulRuns}/${totalRuns} OK, ${totalRuns - successfulRuns} failed`);
    console.log(`Unique error types: ${errorCounts.size}`);
    process.exit(successfulRuns < totalRuns ? 1 : 0);
}

run();
