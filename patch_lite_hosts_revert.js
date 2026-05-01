const fs = require('fs');
const path = 'src/util/processingMode.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    "    '.duckduckgo.com',\n    '.google.com',\n    '.youtube.com',\n    '.googlevideo.com',\n    '.ytimg.com',\n    '.ggpht.com',\n];",
    "    '.duckduckgo.com',\n];"
);
fs.writeFileSync(path, content);
console.log('Patched');
