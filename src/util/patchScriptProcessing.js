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
// Fallback chain: proxy URL → blob URL (proxy content) → blob URL (raw content via /__rh_raw with bridge).
const IFRAME_PROXY = [
    'if(typeof window!=="undefined"&&typeof document!=="undefined"&&!window.__rhIframe){window.__rhIframe=1;(function(){',
    'function getHH(){try{return window["%hammerhead%"]}catch(e){return null}}',
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
    'if(!el||el.tagName!=="IFRAME"||el.__rhIf)return;',
    'var src=el.getAttribute("src")||"";',
    'if(!isAbs(src))return;',
    'if(getCtx()&&src.indexOf(_pOrig)===0)return;',
    'el.__rhIf=1;',
    'if(!getHH()){var p=proxyUrl(src);if(p)try{el.setAttribute("src",p)}catch(e){}}',
    'var pu=proxyUrl(src);if(!pu)return;',
      'el.addEventListener("error",function(){',
        'fetch(pu,{credentials:"include"}).then(function(r){',
          'return r.ok?r.text():Promise.reject()}).then(function(h){blobLoad(el,h)',
        '}).catch(function(){',
          'if(!getCtx())return;',
          'fetch("/__rh_raw",{method:"POST",headers:{"Content-Type":"application/json"},',
            'body:JSON.stringify({url:src,session:_sid})}).then(function(r){',
            'return r.ok?r.text():null}).then(function(h){blobLoad(el,h)',
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
            'var _ns=m.target.getAttribute("src")||"";if(isAbs(_ns)&&(!getCtx()||_ns.indexOf(_pOrig)!==0)){m.target.__rhIf=0;fixIframe(m.target)}}',
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
const LITE_DOMAIN_RE = /chatgpt\.com|chat\.openai\.com|oaistatic\.com|oaiusercontent\.com|claude\.ai|claudeusercontent\.com|anthropic\.com|poki\.com|poki-cdn\.com|bilibili\.com|bilibili\.cn|hdslb\.com|bilivideo|biliapi|szbdyd\.com|discord\.com|discordapp\.com|discord\.gg|github\.com|githubassets\.com|githubusercontent\.com|doubao\.com|volccdn\.com|volces\.com|volcengine\.com|ibytedtos\.com|duckduckgo\.com|qianwen\.com|tongyi\.aliyun\.com|alicdn\.com|itch\.io|itch\.zone|hwcdn\.net|gimkit\.com|turbowarp\.org|turbowarp\.xyz|deepseek\.com|deepseek\.ai|jmail\.world|mk48\.io/i;

const scriptProcessor = require('testcafe-hammerhead/lib/processing/resources/script');
const _origShouldProcess = scriptProcessor.shouldProcessResource.bind(scriptProcessor);
scriptProcessor.shouldProcessResource = function (ctx) {
    if (ctx && ctx.dest && ctx.dest.url && CF_SKIP_RE.test(ctx.dest.url)) return false;
    if (ctx && ctx.dest && ctx.dest.host && LITE_DOMAIN_RE.test(ctx.dest.host)) return false;
    return _origShouldProcess(ctx);
};

const END_HEADER = headerModule.SCRIPT_PROCESSING_END_HEADER_COMMENT;
const originalAdd = headerModule.add;

headerModule.add = function patchedAdd(code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings) {
    let result = originalAdd.call(this, code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings);
    if (result.includes(END_HEADER)) {
        result = result.replace(END_HEADER, END_HEADER + '\n' + FALLBACK + '\n' + IFRAME_PROXY + '\n');
    }
    return result;
};
