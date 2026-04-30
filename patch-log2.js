const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src/util/browserLikeHeaders.js');
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
    `if (req.url && req.url.includes('backend-api')) {
            console.log('[UPSTREAM_REQ]', req.url);
            console.log(req.headers);
        }`,
    `if (req.url && req.url.includes('!a!')) {
            console.log('[UPSTREAM_REQ]', req.url);
            console.log(req.headers);
        }`
);
fs.writeFileSync(file, code);
console.log('Patched browserLikeHeaders.js');
