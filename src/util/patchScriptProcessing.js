/**
 * Patch hammerhead's script processing header to add fallback pass-through
 * implementations of __set$, __get$, __call$, etc.
 *
 * Problem: hammerhead prepends a header to every rewritten JS file that tries
 * to copy __set$/__get$/__call$ from window (set by hammerhead.js runtime).
 * If the runtime hasn't loaded yet (race condition, ES module timing, dynamic
 * chunk loading), the header's `if (window.__get$ && ...)` fails, the `var`
 * declarations hoist but never assign, so __set$ is `undefined`.
 * Calling undefined() → TypeError: __set$ is not a function.
 *
 * Fix: after the header, insert a safety-net: if __set$ is still not a
 * function, define pass-through implementations (normal property access).
 * The page loses client-side URL interception but won't crash.
 *
 * Affected: vercel, netlify, figma, gitlab, facebook, linkedin, netflix, amazon
 */

const headerModule = require('testcafe-hammerhead/lib/processing/script/header');
const stylesheetProcessor = require('testcafe-hammerhead/lib/processing/resources/stylesheet');
const processingMode = require('./processingMode');

const FALLBACK = [
    'if(typeof __set$!=="function"){',
    'var __get$Loc=function(l){return l},',
    '__set$Loc=function(l,v){return l=v},',
    '__set$=function(o,p,v){return o[p]=v},',
    '__get$=function(o,p){return o[p]},',
    '__call$=function(o,p,a){return o[p].apply(o,a)},',
    '__get$Eval=function(e){return e},',
    '__proc$Script=function(s){return s},',
    '__proc$Html=function(h){return h},',
    '__get$PostMessage=function(w,p){return arguments.length===1?w.postMessage:p},',
    '__get$ProxyUrl=function(u,d){return u},',
    '__rest$Array=function(a,i){return Array.prototype.slice.call(a,i)},',
    '__rest$Object=function(o,p){var k=Object.keys(o),n={};for(var i=0;i<k.length;++i)if(p.indexOf(k[i])<0)n[k[i]]=o[k[i]];return n},',
    '__arrayFrom$=function(r){if(!r)return r;return!Array.isArray(r)&&"function"==typeof r[Symbol.iterator]?Array.from(r):r}',
    '}'
].join('');

// Process / atob polyfill prepended to EVERY Hammerhead-rewritten script
// (lite + full AST). Keeps `process.env.NODE_ENV` references working in proxied
// React/Webpack/Vite bundles and prevents `atob()` `InvalidCharacterError`
// crashes when sites feed corrupted base64 (TikTok, several ad networks).
//
// `globalThis` covers main thread, dedicated workers, shared workers, and
// service workers. The IIFE walls off `g` from leaking into the surrounding
// script's scope. Every guard is idempotent so repeated execution is safe.
const PROCESS_POLYFILL = (
    '(function(){try{' +
        'var g=(typeof globalThis!=="undefined")?globalThis:' +
            '(typeof window!=="undefined")?window:' +
            '(typeof self!=="undefined")?self:this;' +
        'if(g&&!g.process){' +
            'var _p={env:{NODE_ENV:"production"},browser:true,type:"renderer",version:"",versions:{node:""},platform:"browser",argv:[],argv0:"",release:{name:"node"},title:"browser",pid:0,arch:"x64",cwd:function(){return "/"},chdir:function(){},nextTick:function(cb){var a=Array.prototype.slice.call(arguments,1);Promise.resolve().then(function(){cb.apply(null,a)})},on:function(){return _p},once:function(){return _p},off:function(){return _p},emit:function(){return false},addListener:function(){return _p},removeListener:function(){return _p},removeAllListeners:function(){return _p},listeners:function(){return []},binding:function(){throw new Error("process.binding is not supported")},umask:function(){return 0},hrtime:function(prev){var now=(typeof performance!=="undefined"&&performance.now)?performance.now():Date.now();var s=Math.floor(now/1000),ns=Math.floor((now%1000)*1e6);if(prev){s-=prev[0];ns-=prev[1];if(ns<0){s--;ns+=1e9}}return [s,ns]}};' +
            'try{Object.defineProperty(g,"process",{value:_p,configurable:true,writable:true,enumerable:false})}catch(_){g.process=_p}' +
        '}' +
        'if(g&&typeof g.atob==="function"&&!g.atob.__sb_patched){' +
            'var _orig=g.atob.bind(g);' +
            'var _f=function(s){try{return _orig(s)}catch(_e){try{var c=String(s==null?"":s).replace(/[^A-Za-z0-9+\\/=]/g,"");while(c.length%4!==0)c+="=";return _orig(c)}catch(_2){return ""}}};' +
            '_f.__sb_patched=true;' +
            'try{g.atob=_f}catch(_){}' +
        '}' +
    '}catch(_e){}})();'
);

// Apparatus-style iframe safety net — catches dynamically created iframes that
// bypass hammerhead's URL rewriting (race conditions, __proc$Html fallback, etc.).
// Uses MutationObserver to detect iframes with unproxied src attributes.
// Fallback chain: proxy URL → blob URL (proxy content) → blob URL (raw content via /_a/rw with bridge).
const IFRAME_PROXY = [
    'if(typeof window!=="undefined"&&typeof document!=="undefined"&&!window._a_ifi){window._a_ifi=1;(function(){',
    'function getHH(){try{return window["%_d%"]}catch(e){return null}}',
    'var _pOrig,_sid;',
    'function getCtx(){',
      'if(_pOrig)return true;',
      'try{var h=getHH();if(h&&h.settings&&h.settings._settings){',
        'var s=h.settings._settings;',
        '_sid=s.sessionId;',
        '_pOrig=s.forceProxySrcForImage?null:(location.protocol+"//"+location.host)}}catch(e){}',
      'if(!_pOrig){try{var n=performance.getEntriesByType("navigation");',
        'if(n&&n[0]){var m=n[0].name.match(/^(https?:\\/\\/[^/]+)\\/([a-f0-9]{32})\\//i);',
        'if(m){_pOrig=m[1];_sid=m[2]}}}catch(e){}}',
      'return!!_pOrig&&!!_sid',
    '}',
    'function proxyUrl(url){',
      'var h=getHH();',
      'if(h&&h.utils&&h.utils.url&&h.utils.url.getProxyUrl){',
        'try{return h.utils.url.getProxyUrl(url,{resourceType:"i"})}catch(e){}}',
      'if(getCtx())return _pOrig+"/"+_sid+"/"+url;',
      'return null',
    '}',
    'function isAbs(s){return!!s&&typeof s==="string"&&/^https?:\\/\\//i.test(s)}',
    'function blobLoad(el,html){',
      'if(!html)return;',
      'try{el.src=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}))}catch(e){}',
    '}',
    'function fixIframe(el){',
    'if(!el||el.tagName!=="IFRAME"||el._a_if)return;',
    'var src=el.getAttribute("src")||"";',
    'if(!isAbs(src))return;',
    'if(getCtx()&&src.indexOf(_pOrig)===0)return;',
    'el._a_if=1;',
    'if(!getHH()){var p=proxyUrl(src);if(p)try{el.setAttribute("src",p)}catch(e){}}',
    'var pu=proxyUrl(src);if(!pu)return;',
      'el.addEventListener("error",function(){',
        'fetch(pu,{credentials:"include"}).then(function(r){',
          'return r.ok?r.text():Promise.reject()}).then(function(h){blobLoad(el,h)',
        '}).catch(function(){',
          'if(!getCtx())return;',
          'var _rb=JSON.stringify({url:src,session:_sid});',
          'fetch("/_a/rw",{method:"POST",headers:{"Content-Type":"application/json"},body:_rb}).then(function(r){return r.ok?r.text():null}).then(function(h){if(h)blobLoad(el,h)}).catch(function(){})',
        '})',
      '},{once:true})',
    '}',
    'function startObs(){',
      'var root=document.documentElement;',
      'if(!root){document.addEventListener("DOMContentLoaded",startObs);return}',
      'try{new MutationObserver(function(ml){',
        'for(var i=0;i<ml.length;i++){var m=ml[i];',
          'if(m.type==="childList"){',
            'for(var j=0;j<m.addedNodes.length;j++){var n=m.addedNodes[j];',
              'if(n.nodeType!==1)continue;',
              'if(n.tagName==="IFRAME")fixIframe(n);',
              'else try{var f=n.getElementsByTagName("iframe");',
              'for(var k=0;k<f.length;k++)fixIframe(f[k])}catch(e){}}',
          '}else if(m.type==="attributes"&&m.target&&m.target.tagName==="IFRAME"){',
            'var _ns=m.target.getAttribute("src")||"";if(isAbs(_ns)&&(!getCtx()||_ns.indexOf(_pOrig)!==0)){m.target._a_if=0;fixIframe(m.target)}}',
        '}',
      '}).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["src"]})}catch(e){}',
    '}',
    'startObs()',
    '})()}'
].join('');

// Console capture is now handled by patchPageProcessing.js via HTML injection.

// Skip JS rewriting for anti-bot / CAPTCHA scripts.
// Hammerhead's AST rewriting breaks obfuscated challenge code.
const CF_SKIP_RE = new RegExp([
    // Cloudflare
    '\\/cdn-cgi\\/', 'challenges\\.cloudflare\\.com', 'cloudflareinsights\\.com',
    'challenge-platform', 'turnstile',
    // Google reCAPTCHA
    'gstatic\\.com\\/recaptcha', 'google\\.com\\/recaptcha', 'recaptcha', 'grecaptcha',
    // hCaptcha
    'hcaptcha\\.com',
    // AWS WAF
    'aws-waf-token',
    // PerimeterX / HUMAN
    'px-cdn\\.net', 'px-cloud\\.net', 'perimeterx', 'human-challenge',
    // DataDome
    'datadome',
    // Kasada
    'kasada',
    // Akamai Bot Manager
    'akamaized\\.net\\/akam',
    // Imperva / Incapsula
    'imperva', 'incapsula',
    // Shape Security
    'shape\\.com\\/captcha',
    // Newgrounds NG Guard
    '\\/_guard\\/',
    // Generic
    'captcha\\.js',
].join('|'), 'i');
const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const _origShouldProcess = scriptProcessor.shouldProcessResource.bind(scriptProcessor);
scriptProcessor.shouldProcessResource = function (ctx) {
    if (ctx && ctx.dest && ctx.dest.url && CF_SKIP_RE.test(ctx.dest.url)) return false;
    // Lite domains were previously skipped entirely. We now process them with simple
    // string rewriting (no AST) so dynamic import() of paths like /cdn/assets/... gets
    // a proxy-prefixed URL. Without this, ChatGPT's React Router enters an infinite
    // reload loop because dynamic imports resolve to /cdn/assets/<hash>.js on the
    // proxy origin (no session prefix) and 404. Cf. processResource override below.
    return _origShouldProcess(ctx);
};

// ---------------------------------------------------------------------------
// LITE-DOMAIN JS REWRITING
// Hammerhead's full AST rewriting breaks complex SPAs (React/Remix/Next/Vue),
// so for "lite" domains we keep their JS source intact except for a few
// surgical string replacements: absolute asset paths and dynamic import()
// calls get prefixed with the proxy URL. Without these rewrites, dynamic
// import() — which can NOT be intercepted at runtime by JavaScript — resolves
// against the proxy origin and 404s, causing infinite reload loops on sites
// like ChatGPT (React Router auto-reloads on import failure).
//
// Asset path categories rewritten in string literals:
//   /cdn/...            ChatGPT, OpenAI
//   /cdn-cgi/...        Cloudflare challenge platform
//   /assets/...         Generic build assets
//   /_next/...          Next.js
//   /static/...         Generic static assets
//   /build/...          Remix
//   /dist/...           Generic build output
//   /chunks/...         Webpack code splitting
//   /bundles/...        Generic bundles
//   /js/...             Generic JS folders
//   /css/...            Generic CSS folders
//   /media/...          Generic media folders
//   /fonts/...          Generic fonts folders
//   /images/...         Generic images folders
// ---------------------------------------------------------------------------
const LITE_PATH_LITERAL_RE = /(["'`])(\/(?:cdn(?:-cgi)?|assets|static|_next|build|dist|chunks|bundles|js|css|media|fonts|images)\/[^"'`\n\r\s<>]*)(["'`])/g;
const LITE_IMPORT_DYNAMIC_RE = /(import\(\s*["'`])(\/[^"'`\n\r]+)(["'`]\s*[,)])/g;

function _liteRewriteJs(script, ctx) {
    if (!script || typeof script !== 'string') return script;
    if (!ctx || !ctx.dest) return script;

    const proto = ctx.dest.protocol || 'https:';
    const dHost = ctx.dest.host || '';
    if (!dHost) return script;
    const origin = proto + '//' + dHost;

    const sid = (ctx.session && ctx.session.id) || '';
    if (!sid) return script;
    // Domain-leak hardening: emit a DOMAIN-RELATIVE prefix ("/<sid>/...") rather than
    // ABSOLUTE ("https://<proxy-host>/<sid>/..."). Browsers resolve relative URLs in
    // import() / fetch / asset literals against the importer's URL, which is itself
    // proxy-origin-rooted, so the result is functionally identical — but the served
    // JS bytes never contain the proxy hostname as a literal string.
    const relPrefix = '/' + sid + '/';

    let result = script;
    result = result.replace(LITE_PATH_LITERAL_RE, (_m, q1, p, q2) => {
        // Skip already-proxied paths
        if (p && typeof p === 'string' && p.indexOf('/' + sid + '/') === 0) return _m;
        return q1 + relPrefix + origin + p + q2;
    });
    result = result.replace(LITE_IMPORT_DYNAMIC_RE, (_m, pre, p, post) => {
        if (p && typeof p === 'string' && p.indexOf('/' + sid + '/') === 0) return _m;
        return pre + relPrefix + origin + p + post;
    });
    // Inline-substitute `process.env.NODE_ENV` literals — Webpack's DefinePlugin
    // does this at build time but bundlers that ship in dev mode (or sites that
    // run a custom bundler) leave bare references in the proxied JS. The string
    // replace is safe because `.NODE_ENV` is exclusively a build-time token.
    if (result.includes('process.env.NODE_ENV')) {
        result = result.replace(/process\.env\.NODE_ENV/g, '"production"');
    }
    // Polyfill `process`/`atob` for lite-rewritten scripts. Uses globalThis so
    // the same body works in main-thread + worker scopes (window is undefined
    // inside workers). PROCESS_POLYFILL is also injected by `headerModule.add`,
    // but lite scripts skip Hammerhead's AST pipeline entirely so the script
    // header is never appended — we have to splice the polyfill in here.
    if (result.match(/\bprocess\b/) || result.match(/\batob\s*\(/)) {
        result = PROCESS_POLYFILL + '\n' + result;
    }
    return result;
}

// Install instance-level processResource that handles lite domains. We use
// Object.getPrototypeOf at call time so we always delegate to whatever sits on
// the prototype now (addJSDiskCache replaces it later when the proxy is built).
// Domain-leak hardening for Hammerhead-rewritten JS bodies.
//
// Hammerhead's script processor calls getProxyUrl(...) on every URL literal
// it finds, which produces ABSOLUTE strings like
//   "https://<proxy-host>/<sid>/<destination>"
// We sweep the rewritten script and replace each occurrence of
//   "<proxy-origin>/<sid>/" → "/<sid>/"
// — a domain-relative path. Browsers resolve relative URLs against the
// importing script's URL (also proxy-origin-rooted), so behaviour is
// unchanged. The served bytes simply no longer contain the proxy hostname.
// Same path-style prefix used in patchPageProcessing.js. When set, the strip
// pass replaces the proxy origin with the prefix in one shot:
//   <proxy-origin>/<sid>/   →   /<pathStyle>/<sid>/
const _PATH_STYLE = (require('../config').pathStyle || '').replace(/^\/+|\/+$/g, '');
const _PATH_PREFIX = _PATH_STYLE ? '/' + _PATH_STYLE : '';

function _stripProxyOriginFromScript(script, ctx) {
    if (!script || typeof script !== 'string') return script;
    const sid = ctx && ctx.session && ctx.session.id;
    if (!sid) return script;

    const serverInfo = ctx.serverInfo || {};
    const protocol = serverInfo.protocol || 'http:';
    const hostname = serverInfo.hostname || 'localhost';
    const port = serverInfo.port;
    const portPart = port == 443 || port == 80 || !port ? '' : ':' + port;
    const origins = new Set();
    origins.add(protocol + '//' + hostname + portPart);
    origins.add('http://' + hostname + portPart);
    origins.add('https://' + hostname + portPart);
    if (ctx.req && ctx.req.headers) {
        const hostHdr = ctx.req.headers['host'] || ctx.req.headers[':authority'];
        if (hostHdr) {
            origins.add('http://' + hostHdr);
            origins.add('https://' + hostHdr);
        }
        const fwdHost = ctx.req.headers['x-forwarded-host'];
        if (fwdHost) {
            const fwdProto = ctx.req.headers['x-forwarded-proto'] || 'https';
            origins.add(fwdProto + '://' + fwdHost);
        }
    }
    const sidEsc = sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let out = script;
    for (const o of origins) {
        if (!o) continue;
        const oEsc = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the proxy origin only before "/<sid>" or "/_a/" so we never
        // touch unrelated absolute strings inside the body. Replacement is
        // _PATH_PREFIX (default "") which also injects the configured
        // pathStyle in one pass.
        const re = new RegExp(oEsc + '(?=/(?:' + sidEsc + '|_a/))', 'g');
        out = out.replace(re, _PATH_PREFIX);
    }
    return out;
}

// Detect responses that the upstream served as HTML (4xx/5xx error pages,
// Cloudflare/AWS WAF challenge, "Are you a robot?" gating, ad-blocker stubs,
// regional gating, etc.) but the browser is trying to load via a `<script>`
// tag. Hammerhead's AST rewriter would either fail to parse the HTML or
// emit broken JS, and the browser would log the classic
// `Uncaught SyntaxError: Unexpected token '<' (at core.js:1:1)`.
// Replace the body with a SILENT no-op so the script tag finishes loading
// cleanly. We deliberately avoid console.error here: subresource HTML/404
// stubs are common (ads, trackers, region-blocked widgets, optional
// privacy-framework loaders that the destination rejects when proxied) and
// surfacing every one as a red console error makes pages look broken when
// they only had a benign sub-resource fail. The script will be visible in
// the DevTools Network tab if the user wants to debug.
const _HTML_SHEBANG_RE = /^[\s\uFEFF]*<(?:!doctype|!--|html|head|body|script|meta|title|link|style)\b/i;
function _looksLikeHtml(s) {
    if (!s || typeof s !== 'string') return false;
    return _HTML_SHEBANG_RE.test(s);
}

scriptProcessor.processResource = async function patchedProcessResource(script, ctx, charset, urlReplacer) {
    // Pre-flight: if the upstream returned HTML for a script-typed request
    // there's nothing for the AST rewriter (or our lite rewriter) to do —
    // both will produce garbage. Emit a silent stub so the <script> tag
    // resolves without polluting the console.
    if (_looksLikeHtml(script)) {
        return '/* sb: html-for-script stubbed */void 0;';
    }
    if (processingMode.isMarkedLiteHost(ctx)) {
        return _stripProxyOriginFromScript(_liteRewriteJs(script, ctx), ctx);
    }
    const proto = Object.getPrototypeOf(this);
    let result;
    // If the AST rewriter throws on a single asset (esotope codegen bug,
    // unknown ESTree extension, OOM, …) we must NOT propagate — Hammerhead
    // turns the throw into a 500 for that script and the rest of the page
    // (fonts, images, sub-bundles) cascade-fails. Fall back to the
    // string-only `_liteRewriteJs` rewriter which never parses the source,
    // so at minimum the script still loads. Hammerhead's runtime
    // (`hammerhead.js`) intercepts XHR/fetch/postMessage at the browser
    // level, so client-side URL interception still works for most APIs.
    if (proto && typeof proto.processResource === 'function') {
        try {
            result = await proto.processResource.call(this, script, ctx, charset, urlReplacer);
        } catch (err) {
            const url = (ctx && ctx.dest && ctx.dest.url) || '<unknown>';
            try {
                if (ctx && ctx.session && ctx.session.logger && ctx.session.logger.warn) {
                    ctx.session.logger.warn(`script rewrite failed for ${url}: ${err && err.message}; falling back to lite rewrite`);
                } else {
                    console.warn(`[rh] script rewrite failed for ${url}: ${err && err.message}; falling back to lite rewrite`);
                }
            } catch (_) { /* logger best-effort */ }
            result = _liteRewriteJs(script, ctx);
        }
    } else {
        result = script;
    }
    return _stripProxyOriginFromScript(result, ctx);
};

const END_HEADER = headerModule.SCRIPT_PROCESSING_END_HEADER_COMMENT;
const originalAdd = headerModule.add;

headerModule.add = function patchedAdd(code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings) {
    let result = originalAdd.call(this, code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings);
    if (result.includes(END_HEADER)) {
        // PROCESS_POLYFILL must be FIRST after the header marker so any later
        // user code (and the IFRAME_PROXY block, which references `window`)
        // sees a populated `globalThis.process` and a forgiving `atob`.
        result = result.replace(END_HEADER, END_HEADER + '\n' + PROCESS_POLYFILL + '\n' + FALLBACK + '\n' + IFRAME_PROXY + '\n');
    }
    return result;
};

// Domain-leak hardening for stylesheets. Hammerhead's CSS rewriter turns
// `url(/foo.png)` into `url(https://<proxy-host>/<sid>/<dest>/foo.png)`, again
// embedding the proxy hostname literally. We strip the leading proxy origin so
// the served CSS uses domain-relative URLs that the browser resolves against
// the page (and thus the proxy) origin transparently.
const _origStylesheetProcess = stylesheetProcessor.processResource.bind(stylesheetProcessor);
stylesheetProcessor.processResource = function patchedStylesheetProcessResource(css, ctx, charset, urlReplacer) {
    const out = _origStylesheetProcess(css, ctx, charset, urlReplacer);
    if (out && typeof out.then === 'function') {
        return out.then(r => _stripProxyOriginFromScript(r, ctx));
    }
    return _stripProxyOriginFromScript(out, ctx);
};
