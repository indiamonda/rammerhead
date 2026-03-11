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

const END_HEADER = headerModule.SCRIPT_PROCESSING_END_HEADER_COMMENT;
const originalAdd = headerModule.add;

headerModule.add = function patchedAdd(code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings) {
    let result = originalAdd.call(this, code, isStrictMode, swScopeHeaderValue, nativeAutomation, workerSettings);
    if (result.includes(END_HEADER)) {
        result = result.replace(END_HEADER, END_HEADER + '\n' + FALLBACK + '\n');
    }
    return result;
};
