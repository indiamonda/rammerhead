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

// Client-side console capture — runs once per window context (guard: __rhC).
// Overrides console.log/warn/error/info/debug + window.onerror + unhandledrejection.
// Batches messages and sends via fetch("/__rh_console") which hammerhead rewrites
// to go through the proxy. The pipeline handler in setupPipeline.js intercepts it.
const CONSOLE_CAPTURE = [
    'if(typeof window!=="undefined"&&!window.__rhC){window.__rhC=1;(function(){',
    'var C=window.console||{},Q=[],T=0,M=["log","warn","error","info","debug"];',
    'function S(a){',
      'if(a===void 0)return"undefined";',
      'if(a===null)return"null";',
      'if(a instanceof Error)return(a.stack||a.message||""+a).slice(0,1500);',
      'if(typeof a==="function")return"f "+( a.name||"anon");',
      'if(typeof a==="symbol")return a.toString();',
      'if(typeof a==="object"){try{var s=JSON.stringify(a);return s.length>2e3?s.slice(0,2e3)+"…":s}catch(e){return""+a}}',
      'var s=""+a;return s.length>2e3?s.slice(0,2e3)+"…":s',
    '}',
    'function F(){',
      'if(!Q.length)return;var b=Q.splice(0,50);',
      'try{fetch("/__rh_console",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b),keepalive:true})}catch(e){}',
    '}',
    'M.forEach(function(m){var o=C[m]||function(){};C[m]=function(){',
      'try{o.apply(C,arguments)}catch(e){}',
      'var a=[];for(var i=0;i<arguments.length;i++)a.push(S(arguments[i]));',
      'Q.push({l:m,a:a,u:(""+location.href).slice(0,200),t:Date.now()});',
      'if(!T)T=setTimeout(function(){T=0;F()},150)',
    '}});',
    'window.addEventListener("error",function(e){',
      'Q.push({l:"error",a:["[Uncaught] "+S(e.error||e.message)],u:(""+location.href).slice(0,200),t:Date.now()});',
      'if(!T)T=setTimeout(function(){T=0;F()},150)',
    '});',
    'window.addEventListener("unhandledrejection",function(e){',
      'var r=e.reason;',
      'Q.push({l:"error",a:["[Promise] "+S(r&&r.stack?r.stack:r)],u:(""+location.href).slice(0,200),t:Date.now()});',
      'if(!T)T=setTimeout(function(){T=0;F()},150)',
    '});',
    'window.console=C',
    '})()}'
].join('');

const END_HEADER = headerModule.SCRIPT_PROCESSING_END_HEADER_COMMENT;
const originalAdd = headerModule.add;

headerModule.add = function patchedAdd(code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings) {
    let result = originalAdd.call(this, code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings);
    if (result.includes(END_HEADER)) {
        result = result.replace(END_HEADER, END_HEADER + '\n' + FALLBACK + '\n' + CONSOLE_CAPTURE + '\n');
    }
    return result;
};
