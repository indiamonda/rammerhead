const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'node_modules/testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms.js');
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('console.log(\'[SET-COOKIE]\'')) {
    code = code.replace(
        'const parsedCookies = cookie_1.default.parse(src);',
        `const parsedCookies = cookie_1.default.parse(src);
        console.log('[SET-COOKIE]', src);`
    );
    fs.writeFileSync(file, code);
    console.log('Patched transforms.js');
}
