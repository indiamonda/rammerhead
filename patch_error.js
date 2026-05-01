const fs = require('fs');
const path = 'node_modules/testcafe-hammerhead/lib/request-pipeline/utils.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    'function error(ctx, err) {',
    'function error(ctx, err) {\n    console.error("[HAMMERHEAD ERROR]", err);\n    try { console.error("[HAMMERHEAD ERROR STACK]", err.stack); } catch(e){}'
);
fs.writeFileSync(path, content);
console.log('Patched');
