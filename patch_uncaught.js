const fs = require('fs');
const path = 'src/util/addMoreErrorGuards.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    "console.error('About to throw: ' + err.message);\n        throw err;",
    "console.error('Avoided crash (was about to throw): ' + err.stack || err.message);"
);
fs.writeFileSync(path, content);
console.log('Patched');
