const fs = require('fs');
const path = 'src/util/patchHammerheadErrorResponses.js';
let content = fs.readFileSync(path, 'utf8');

const newError = `
const pipelineUtils = require('testcafe-hammerhead/lib/request-pipeline/utils');
const origError = pipelineUtils.error;
pipelineUtils.error = function patchedError(ctx, err) {
    if (ctx.isPage && !ctx.isIframe) {
        ctx.session.handlePageError(ctx, err);
    } else if (ctx.isAjax || ctx.isScript) {
        if ('setHeader' in ctx.res && !ctx.res.headersSent) {
            ctx.res.statusCode = 500;
            // Send empty response or JSON to avoid SyntaxError from HTML
            if (ctx.isScript) {
                ctx.res.setHeader('content-type', 'application/javascript');
                ctx.res.write('console.error("Proxy Error: " + ' + JSON.stringify(err ? err.toString() : 'Unknown error') + ');');
            } else {
                ctx.res.setHeader('content-type', 'application/json');
                ctx.res.write(JSON.stringify({ error: err ? err.toString() : 'Unknown error' }));
            }
        }
        ctx.res.end();
        ctx.goToNextStage = false;
    } else {
        ctx.closeWithError(500, err ? err.toString() : 'Unknown error');
    }
};
pipelineUtils.error._a_patched = true;
`;

content = content.replace(
    /const pipelineUtils = require\('testcafe-hammerhead\/lib\/request-pipeline\/utils'\);[\s\S]*?pipelineUtils\.error\._a_patched = true;/,
    newError.trim()
);

fs.writeFileSync(path, content);
console.log('Patched');
