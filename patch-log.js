const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src/util/browserLikeHeaders.js');
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('console.log(\'[UPSTREAM_REQ]\'')) {
    code = code.replace(
        "req.headers['sec-fetch-site'] = secFetchSite;",
        `req.headers['sec-fetch-site'] = secFetchSite;
        if (req.url && req.url.includes('backend-api')) {
            console.log('[UPSTREAM_REQ]', req.url);
            console.log(req.headers);
        }`
    );
    fs.writeFileSync(file, code);
    console.log('Patched browserLikeHeaders.js');
}
