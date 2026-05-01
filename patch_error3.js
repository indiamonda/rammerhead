const fs = require('fs');
const path = 'node_modules/testcafe-hammerhead/lib/request-pipeline/utils.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    'else if (ctx.isAjax)\n        ctx.closeWithError(500, err.toString());',
    'else if (ctx.isAjax)\n        ctx.req.destroy();'
);
fs.writeFileSync(path, content);
console.log('Patched');
