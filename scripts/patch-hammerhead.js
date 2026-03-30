/**
 * Post-install patch for testcafe-hammerhead.
 *
 * Fixes a crash in the dynamic import transformer where
 * parseProxyUrl(resolver('./')) returns null (e.g. when URL shuffling
 * is active), causing an unguarded .destUrl access to throw.
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(
    __dirname,
    '..',
    'node_modules',
    'testcafe-hammerhead',
    'lib',
    'processing',
    'script',
    'transform.js'
);

const BEFORE = `dynamic_import_1.default.baseUrl = resolver ? (0, url_1.parseProxyUrl)(resolver('./')).destUrl : '';`;
const AFTER  = `dynamic_import_1.default.baseUrl = resolver ? ((0, url_1.parseProxyUrl)(resolver('./')) || {}).destUrl || '' : '';`;

try {
    let src = fs.readFileSync(TARGET, 'utf8');
    if (src.includes(AFTER)) {
        console.log('[patch-hammerhead] Already patched.');
        process.exit(0);
    }
    if (!src.includes(BEFORE)) {
        console.error('[patch-hammerhead] Could not find target string. Hammerhead version may have changed.');
        process.exit(1);
    }
    src = src.replace(BEFORE, AFTER);
    fs.writeFileSync(TARGET, src, 'utf8');
    console.log('[patch-hammerhead] Patched dynamic import transformer (null-safe destUrl).');
} catch (err) {
    console.error('[patch-hammerhead] Error:', err.message);
    process.exit(1);
}
