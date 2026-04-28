const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

transforms.requestTransforms[BUILTIN_HEADERS.origin] = (_src, ctx) => {
  const reqOrigin = ctx.dest.reqOrigin;
  if (reqOrigin && !reqOrigin.includes(ctx.serverInfo.hostname)) {
    return reqOrigin;
  }
  return ctx.dest.domain;
};

transforms.forcedRequestTransforms[BUILTIN_HEADERS.origin] = (_src, ctx) => {
  if (ctx.serverInfo.port != ctx.serverInfo.crossDomainPort) return void 0;
  const reqOrigin = ctx.dest.reqOrigin;
  if (reqOrigin && !reqOrigin.includes(ctx.serverInfo.hostname)) {
    return reqOrigin;
  }
  return ctx.dest.domain;
};
