const transforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms');
const BUILTIN_HEADERS = require('testcafe-hammerhead/lib/request-pipeline/builtin-header-names');

/**
 * Override hammerhead's default Origin request transform.
 *
 * The stock transform uses `ctx.dest.reqOrigin || ctx.dest.domain`. In rammerhead's
 * single-port proxy, `reqOrigin` is the **proxy** origin (e.g. https://rammerhead.fly.dev
 * or https://shop.rammerhead.org) because that's what the browser sees. Sending the
 * proxy origin to the upstream server causes "Disallowed CORS origin" rejections on sites
 * that validate Origin server-side (ChatGPT, Discord, etc.).
 *
 * We always want the real **destination** origin (`ctx.dest.domain`) — which is the actual
 * site the user is browsing (e.g. https://chatgpt.com).
 */
transforms.requestTransforms[BUILTIN_HEADERS.origin] = (_src, ctx) => {
  return ctx.dest.domain;
};

transforms.forcedRequestTransforms[BUILTIN_HEADERS.origin] = (_src, ctx) => {
  if (ctx.serverInfo.port != ctx.serverInfo.crossDomainPort) return void 0;
  return ctx.dest.domain;
};
