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

// process / atob polyfill prepended to every Hammerhead-rewritten script.
// Keeps `process.env.NODE_ENV` references working in proxied React/Webpack/Vite
// bundles and prevents `atob()` crashes on corrupted base64 (TikTok, ad networks).
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

// Apparatus-style iframe safety net — catches dynamically created iframes that
// bypass hammerhead's URL rewriting (race conditions, __proc$Html fallback, etc.).
// Uses MutationObserver to detect iframes with unproxied src attributes.
// Fallback chain: proxy URL → blob URL (proxy content) → blob URL (raw content via /_a/rw with bridge).
const IFRAME_PROXY = [
    'if(typeof window!=="undefined"&&typeof document!=="undefined"&&!window.__SBRAND__ifi){window.__SBRAND__ifi=1;(function(){',
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
    'if(!el||el.tagName!=="IFRAME"||el.__SBRAND__if)return;',
    'var src=el.getAttribute("src")||"";',
    'if(!isAbs(src))return;',
    'if(getCtx()&&src.indexOf(_pOrig)===0)return;',
    'el.__SBRAND__if=1;',
    'if(!getHH()){var p=proxyUrl(src);if(p)try{el.setAttribute("src",p)}catch(e){}}',
    'var pu=proxyUrl(src);if(!pu)return;',
      'el.addEventListener("error",function(){',
        'fetch(pu,{credentials:"include"}).then(function(r){',
          'return r.ok?r.text():Promise.reject()}).then(function(h){blobLoad(el,h)',
        '}).catch(function(){',
          'if(!getCtx())return;',
          'var _rb=JSON.stringify({url:src,session:_sid});',
          'var _rh=function(p){return fetch(p,{method:"POST",headers:{"Content-Type":"application/json"},body:_rb}).then(function(r){return r.ok?r.text():null})};',
          '_rh("/_a/rw").catch(function(){return _rh("/__rh_raw")}).then(function(h){blobLoad(el,h)',
          '}).catch(function(){})',
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
            'var _ns=m.target.getAttribute("src")||"";if(isAbs(_ns)&&(!getCtx()||_ns.indexOf(_pOrig)!==0)){m.target.__SBRAND__if=0;fixIframe(m.target)}}',
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
    'aws-waf-token', 'awswaf\\.com', 'challenge\\.js',
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
// Domains using "lite" page processing — skip AST rewriting for their scripts too.
const LITE_DOMAIN_RE = /chatgpt\.com|chat\.openai\.com|oaistatic\.com|oaiusercontent\.com|claude\.ai|claudeusercontent\.com|anthropic\.com|poki\.com|poki-cdn\.com|bilibili\.com|bilibili\.cn|hdslb\.com|bilivideo|biliapi|szbdyd\.com|discord\.com|discordapp\.com|discord\.gg|github\.com|githubassets\.com|githubusercontent\.com|doubao\.com|volccdn\.com|volces\.com|volcengine\.com|ibytedtos\.com|duckduckgo\.com|qianwen\.com|tongyi\.aliyun\.com|alicdn\.com|itch\.io|itch\.zone|hwcdn\.net|gimkit\.com|turbowarp\.org|turbowarp\.xyz|deepseek\.com|deepseek\.ai|jmail\.world|mk48\.io|tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com/i;

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
const LITE_PATH_LITERAL_RE = /(["'])(\/(?:cdn(?:-cgi)?|assets|static|_next|build|dist|chunks|bundles|js|css|media|fonts|images)\/[^"'`\n\r\s<>]+)(["'])/g;
const LITE_IMPORT_DYNAMIC_RE = /(import\(\s*["'])(\/[^"'`\n\r]+)(["']\s*[,)])/g;

function _liteRewriteJs(script, ctx) {
    if (!script || typeof script !== 'string') return script;
    if (!ctx || !ctx.dest) return script;

    const proto = ctx.dest.protocol || 'https:';
    const dHost = ctx.dest.host || '';
    if (!dHost) return script;
    const origin = proto + '//' + dHost;

    const serverInfo = ctx.serverInfo || {};
    const proxyPort = serverInfo.port || '';
    const protocol = serverInfo.protocol || 'http:';
    const hostname = serverInfo.hostname || 'localhost';
    const proxyOrigin =
        protocol + '//' + hostname + (proxyPort == 443 || proxyPort == 80 ? '' : ':' + proxyPort);
    const sid = (ctx.session && ctx.session.id) || '';
    if (!sid) return script;
    const proxyPrefix = proxyOrigin + '/' + sid + '/';

    let result = script;
    result = result.replace(LITE_PATH_LITERAL_RE, (_m, q1, p, q2) => {
        // Skip already-proxied paths
        if (p.indexOf('/' + sid + '/') === 0) return _m;
        return q1 + proxyPrefix + origin + p + q2;
    });
    result = result.replace(LITE_IMPORT_DYNAMIC_RE, (_m, pre, p, post) => {
        if (p.indexOf('/' + sid + '/') === 0) return _m;
        return pre + proxyPrefix + origin + p + post;
    });
    return result;
}

// Install instance-level processResource that handles lite domains. We use
// Object.getPrototypeOf at call time so we always delegate to whatever sits on
// the prototype now (addJSDiskCache replaces it later when the proxy is built).
scriptProcessor.processResource = async function patchedProcessResource(script, ctx, charset, urlReplacer) {
    if (ctx && ctx.dest && ctx.dest.host && LITE_DOMAIN_RE.test(ctx.dest.host)) {
        let result = _liteRewriteJs(script, ctx);
        if (result.match(/\bprocess\b/) || result.match(/\batob\s*\(/)) {
            result = PROCESS_POLYFILL + '\n' + result;
        }
        return result;
    }
    const proto = Object.getPrototypeOf(this);
    if (proto && typeof proto.processResource === 'function') {
        return proto.processResource.call(this, script, ctx, charset, urlReplacer);
    }
    return script;
};

const config = require('../config');
const _BR = config.brand + '_';
const _brandSub = (s) => s.replace(/__SBRAND__/g, _BR);
const IFRAME_PROXY_BRANDED = _brandSub(IFRAME_PROXY);

const END_HEADER = headerModule.SCRIPT_PROCESSING_END_HEADER_COMMENT;
const originalAdd = headerModule.add;

headerModule.add = function patchedAdd(code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings) {
    let result = originalAdd.call(this, code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings);
    if (result.includes(END_HEADER)) {
        result = result.replace(END_HEADER, END_HEADER + '\n' + PROCESS_POLYFILL + '\n' + FALLBACK + '\n' + IFRAME_PROXY_BRANDED + '\n');
    }
    return result;
};
