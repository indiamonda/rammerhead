/**
 * Post-install patches for testcafe-hammerhead.
 *
 * 1. Fixes a crash in the dynamic import transformer where
 *    parseProxyUrl(resolver('./')) returns null (e.g. when URL shuffling
 *    is active), causing an unguarded .destUrl access to throw.
 *
 * 2. Fixes a crash in the script preprocessor where `code` can be null
 *    (e.g. upstream returned empty body), causing .substring to throw.
 */

const fs = require('fs');
const path = require('path');

const HH = path.join(__dirname, '..', 'node_modules', 'testcafe-hammerhead', 'lib');
let applied = 0;
let skipped = 0;

function patch(file, before, after, label) {
    const filePath = path.join(HH, file);
    try {
        let src = fs.readFileSync(filePath, 'utf8');
        if (src.includes(after)) {
            console.log(`[patch-hammerhead] ${label}: already patched.`);
            skipped++;
            return true;
        }
        if (!src.includes(before)) {
            console.error(`[patch-hammerhead] ${label}: target string not found.`);
            return false;
        }
        src = src.replace(before, after);
        fs.writeFileSync(filePath, src, 'utf8');
        console.log(`[patch-hammerhead] ${label}: OK.`);
        applied++;
        return true;
    } catch (err) {
        console.error(`[patch-hammerhead] ${label}: error - ${err.message}`);
        return false;
    }
}

// Patch 1: null-safe destUrl in dynamic import transformer
patch(
    'processing/script/transform.js',
    `dynamic_import_1.default.baseUrl = resolver ? (0, url_1.parseProxyUrl)(resolver('./')).destUrl : '';`,
    `dynamic_import_1.default.baseUrl = resolver ? ((0, url_1.parseProxyUrl)(resolver('./')) || {}).destUrl || '' : '';`,
    'null-safe destUrl'
);

// Patch 2: null-safe code in script preprocessor (prevents .substring crash on null body)
patch(
    'processing/script/index.js',
    `function preprocess(code) {\n    const bom`,
    `function preprocess(code) {\n    if (code == null) return { bom: null, preprocessed: '' };\n    const bom`,
    'null-safe script preprocess'
);

const total = applied + skipped;
if (total === 0) {
    console.error('[patch-hammerhead] No patches applied! Check hammerhead version.');
    process.exit(1);
}
console.log(`[patch-hammerhead] Done (${applied} applied, ${skipped} already present).`);
