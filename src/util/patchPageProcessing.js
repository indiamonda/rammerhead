/**
 * Patch Hammerhead's PageProcessor to inject DevTools instrumentation into
 * every proxied HTML page. The script is inserted right after <head> so it
 * runs BEFORE Hammerhead's own runtime and before any page scripts.
 *
 * Provides three data channels on `window`:
 *   __rhQ[]   - console messages  (polled by parent → /__rh_console)
 *   __rhNet[] - network requests  (polled by parent → DevTools Network tab)
 *   __rhSrc[] - resource URLs     (polled by parent → DevTools Sources tab)
 */

const pageProcessor = require('testcafe-hammerhead/lib/processing/resources/page');

const ANTIDETECT_SCRIPT = [
    '<script>',
    '(function(){',
    'if(typeof window==="undefined"||window.__rhAD)return;window.__rhAD=1;',
    'try{Object.defineProperty(navigator,"webdriver",{get:function(){return undefined},configurable:true})}catch(e){}',
    'try{if(!navigator.plugins||!navigator.plugins.length){',
        'var _mkP=function(n,d,fn,mt){var p=Object.create(Plugin.prototype);',
            'Object.defineProperties(p,{name:{value:n},description:{value:d},filename:{value:fn},length:{value:1}});',
            'var mi=Object.create(MimeType.prototype);',
            'Object.defineProperties(mi,{type:{value:mt},suffixes:{value:"pdf"},description:{value:d},enabledPlugin:{value:p}});',
            'p[0]=mi;return p};',
        'var _pList=[',
            '_mkP("Chrome PDF Plugin","Portable Document Format","internal-pdf-viewer","application/x-google-chrome-pdf"),',
            '_mkP("Chrome PDF Viewer","","mhjfbmdgcfjbbpaeojofohoefgiehjai","application/pdf"),',
            '_mkP("Native Client","","internal-nacl-plugin","application/x-nacl")];',
        'Object.defineProperty(navigator,"plugins",{get:function(){',
            'var a=Object.create(PluginArray.prototype);',
            'for(var i=0;i<_pList.length;i++){a[i]=_pList[i];a[_pList[i].name]=_pList[i]}',
            'Object.defineProperty(a,"length",{value:_pList.length});',
            'a.refresh=function(){};a.item=function(i){return a[i]};a.namedItem=function(n){return a[n]};',
            'return a},configurable:true})',
    '}}catch(e){}',
    'try{if(!window.chrome){window.chrome={runtime:{connect:function(){},sendMessage:function(){}},',
        'csi:function(){return{}},loadTimes:function(){return{}}}}}catch(e){}',
    'try{if(navigator.languages&&navigator.languages.length===0){',
        'Object.defineProperty(navigator,"languages",{get:function(){return["en-US","en"]},configurable:true})}}catch(e){}',
    'try{Object.defineProperty(window,"%hammerhead%",{enumerable:false,configurable:true,writable:true,value:void 0})}catch(e){}',
    'try{Object.defineProperty(window,"%is-hammerhead%",{enumerable:false,configurable:true,writable:true,value:void 0})}catch(e){}',
    '})();</script>',
].join('\n');

const DEVTOOLS_SCRIPT = [
    '<script>',
    '(function(){',
    'if(typeof window==="undefined"||window.__rhC)return;window.__rhC=1;',

    // ── Console capture ──────────────────────────────────────────────
    'window.__rhQ=[];',
    'var _oC=window.console||{};',
    'function _ser(a){',
        'if(a===void 0)return"undefined";if(a===null)return"null";',
        'if(a instanceof Error)return(a.stack||a.message||""+a).slice(0,1500);',
        'if(typeof a==="function")return"f "+(a.name||"anon");',
        'if(typeof a==="symbol")return a.toString();',
        'if(typeof a==="object"){try{var s=JSON.stringify(a);return s.length>2000?s.slice(0,2000)+"\\u2026":s}catch(e){return""+a}}',
        'var s=""+a;return s.length>2000?s.slice(0,2000)+"\\u2026":s',
    '}',
    '["log","warn","error","info","debug"].forEach(function(m){',
        'var o=_oC[m]||function(){};',
        '_oC[m]=function(){',
            'try{o.apply(_oC,arguments)}catch(e){}',
            'var a=[];for(var i=0;i<arguments.length;i++)a.push(_ser(arguments[i]));',
            'var u="";try{u=(""+location.href).slice(0,200)}catch(e){}',
            'window.__rhQ.push({l:m,a:a,u:u,t:Date.now()})',
        '}',
    '});',
    'window.console=_oC;',
    'window.addEventListener("error",function(e){',
        'var msg=e.error?(e.error.stack||e.error.message):e.message;',
        'var u="";try{u=(""+location.href).slice(0,200)}catch(e2){}',
        'window.__rhQ.push({l:"error",a:["[Uncaught] "+_ser(msg)],u:u,t:Date.now()})',
    '});',
    'window.addEventListener("unhandledrejection",function(e){',
        'var r=e.reason;var u="";try{u=(""+location.href).slice(0,200)}catch(e2){}',
        'window.__rhQ.push({l:"error",a:["[Promise] "+_ser(r&&r.stack?r.stack:r)],u:u,t:Date.now()})',
    '});',

    // ── Network capture (fetch + XHR) ────────────────────────────────
    'window.__rhNet=[];',
    // Wrap fetch
    'if(typeof fetch==="function"){',
        'var _oF=fetch;',
        'window.fetch=function(){',
            'var a=arguments,u="",m="GET",st=Date.now();',
            'try{if(typeof a[0]==="string")u=a[0];',
            'else if(a[0]&&a[0].url)u=a[0].url;',
            'if(a[1]&&a[1].method)m=a[1].method}catch(e){}',
            'var entry={m:m,u:_cleanUrl(u).slice(0,300),s:0,tp:"fetch",sz:0,t0:st,t1:0};',
            'window.__rhNet.push(entry);',
            'return _oF.apply(this,a).then(function(r){',
                'entry.s=r.status;entry.t1=Date.now();',
                'try{var ct=r.headers.get("content-type");if(ct)entry.ct=ct.split(";")[0]}catch(e){}',
                'return r',
            '},function(e){entry.s=-1;entry.t1=Date.now();throw e})',
        '}',
    '}',
    // Wrap XMLHttpRequest
    'if(typeof XMLHttpRequest!=="undefined"){',
        'var _oXO=XMLHttpRequest.prototype.open;',
        'var _oXS=XMLHttpRequest.prototype.send;',
        'XMLHttpRequest.prototype.open=function(m,u){',
            'this.__rhM=m;this.__rhU=(""+u).slice(0,300);this.__rhT0=Date.now();',
            'return _oXO.apply(this,arguments)',
        '};',
        'XMLHttpRequest.prototype.send=function(){',
            'var x=this,entry={m:x.__rhM||"GET",u:_cleanUrl(x.__rhU||""),s:0,tp:"xhr",sz:0,t0:x.__rhT0||Date.now(),t1:0};',
            'window.__rhNet.push(entry);',
            'x.addEventListener("loadend",function(){',
                'entry.s=x.status;entry.t1=Date.now();',
                'try{entry.sz=+(x.getResponseHeader("content-length"))||0}catch(e){}',
                'try{var ct=x.getResponseHeader("content-type");if(ct)entry.ct=ct.split(";")[0]}catch(e){}',
            '});',
            'return _oXS.apply(this,arguments)',
        '}',
    '}',

    // ── Source/resource URL collection ────────────────────────────────
    'window.__rhSrc=[];',
    'var _srcSeen={};',
    'var _proxyRe=/\\/[a-z0-9]{32}(?:![a-z]*)?\\/((https?):\\/\\/.+)/i;',
    'function _cleanUrl(u){if(!u)return u;var m=u.match(_proxyRe);return m?m[1]:u}',
    'function _addSrc(url,type){',
        'url=_cleanUrl(url);',
        'if(!url||typeof url!=="string"||_srcSeen[url])return;',
        '_srcSeen[url]=1;',
        'window.__rhSrc.push({u:url,tp:type})',
    '}',
    // Scan existing DOM on DOMContentLoaded
    'function _scanDOM(){',
        'try{document.querySelectorAll("script[src]").forEach(function(e){_addSrc(e.src,"js")})}catch(e){}',
        'try{document.querySelectorAll("link[rel=stylesheet]").forEach(function(e){_addSrc(e.href,"css")})}catch(e){}',
        'try{document.querySelectorAll("link[href]").forEach(function(e){_addSrc(e.href,"link")})}catch(e){}',
        'try{document.querySelectorAll("img[src]").forEach(function(e){_addSrc(e.src,"img")})}catch(e){}',
        'try{document.querySelectorAll("iframe[src]").forEach(function(e){_addSrc(e.src,"iframe")})}catch(e){}',
    '}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_scanDOM);',
    'else _scanDOM();',
    // MutationObserver for dynamically added resources
    'try{new MutationObserver(function(ml){',
        'for(var i=0;i<ml.length;i++){var m=ml[i];',
            'for(var j=0;j<m.addedNodes.length;j++){var n=m.addedNodes[j];',
                'if(n.nodeType!==1)continue;',
                'if(n.tagName==="SCRIPT"&&n.src)_addSrc(n.src,"js");',
                'else if(n.tagName==="LINK"&&n.href)_addSrc(n.href,n.rel==="stylesheet"?"css":"link");',
                'else if(n.tagName==="IMG"&&n.src)_addSrc(n.src,"img");',
                'else if(n.tagName==="IFRAME"&&n.src)_addSrc(n.src,"iframe");',
                'try{n.querySelectorAll&&n.querySelectorAll("script[src],link[href],img[src],iframe[src]").forEach(function(c){',
                    'if(c.tagName==="SCRIPT")_addSrc(c.src,"js");',
                    'else if(c.tagName==="LINK")_addSrc(c.href,c.rel==="stylesheet"?"css":"link");',
                    'else if(c.tagName==="IMG")_addSrc(c.src,"img");',
                    'else if(c.tagName==="IFRAME")_addSrc(c.src,"iframe");',
                '})}catch(e){}',
            '}',
        '}',
    '}).observe(document.documentElement||document.body,{childList:true,subtree:true})}catch(e){}',
    // PerformanceObserver for all fetched resources
    'try{new PerformanceObserver(function(list){',
        'list.getEntries().forEach(function(e){',
            'var n=e.name||"";',
            'var tp="other";',
            'if(e.initiatorType==="script")tp="js";',
            'else if(e.initiatorType==="css"||e.initiatorType==="link")tp="css";',
            'else if(e.initiatorType==="img")tp="img";',
            'else if(e.initiatorType==="xmlhttprequest"||e.initiatorType==="fetch")tp="xhr";',
            'else if(e.initiatorType==="iframe")tp="iframe";',
            'else if(n.match(/\\.js(\\?|$)/i))tp="js";',
            'else if(n.match(/\\.css(\\?|$)/i))tp="css";',
            'else if(n.match(/\\.(png|jpe?g|gif|svg|webp|ico)(\\?|$)/i))tp="img";',
            'else if(n.match(/\\.(woff2?|ttf|otf|eot)(\\?|$)/i))tp="font";',
            '_addSrc(n,tp)',
        '})',
    '}).observe({type:"resource",buffered:true})}catch(e){}',

    '})();</script>',
].join('\n');

// DDG HTML search: rewrite //duckduckgo.com/l/?uddg=<encoded-url>&rut=... → direct URL.
// Must happen BEFORE Hammerhead processes the page (URL shuffling corrupts uddg values).
const DDG_LINK_RE = /href="(\/\/duckduckgo\.com\/l\/\?[^"]*)"/gi;
function _rewriteDdgLinks(html) {
    return html.replace(DDG_LINK_RE, (_match, rawHref) => {
        try {
            const m = rawHref.match(/[?&]uddg=([^&"]+)/);
            if (m) {
                const decoded = decodeURIComponent(m[1]).replace(/"/g, '&quot;');
                return `href="${decoded}"`;
            }
        } catch (_) {}
        return _match;
    });
}

// CF challenge iframe fix: rewrite relative /cdn-cgi/ URLs inside inline challenge
// scripts to absolute proxy paths so they work in blank iframes without Hammerhead.
function _fixCfChallengeUrls(html, ctx) {
    if (!ctx || !ctx.dest) return html;
    if (!html.includes('challenge-platform') && !html.includes('cdn-cgi/challenge')) return html;

    const sessionId = ctx.session && ctx.session.id;
    const destProto = ctx.dest.protocol || 'https:';
    const destHost = ctx.dest.host || '';
    if (!sessionId || !destHost) return html;
    const origin = destProto + '//' + destHost;

    return html.replace(
        /(['"])(\/?cdn-cgi\/[^'"]+)(['"])/g,
        (_m, q1, path, q2) => {
            const cleanPath = path.startsWith('/') ? path : '/' + path;
            return q1 + origin + cleanPath + q2;
        }
    );
}

const origProcess = pageProcessor.processResource.bind(pageProcessor);

pageProcessor.processResource = function patchedProcessResource(html, ctx, charset, urlReplacer, isSrcdoc) {
    const inject = ANTIDETECT_SCRIPT + DEVTOOLS_SCRIPT;

    if (typeof html === 'string' && ctx && ctx.dest) {
        const destHost = (ctx.dest.host || '').toLowerCase();
        // Pre-process DDG HTML pages to fix result links before shuffling
        if (destHost === 'html.duckduckgo.com' || destHost === 'lite.duckduckgo.com') {
            html = _rewriteDdgLinks(html);
        }
        // Pre-process CF challenge URLs to absolute paths
        html = _fixCfChallengeUrls(html, ctx);
    }

    let result;
    try {
        result = origProcess(html, ctx, charset, urlReplacer, isSrcdoc);
    } catch (e) {
        const host = ctx && ctx.dest && ctx.dest.host || '?';
        console.error(`[patchPageProcessing] processResource FAILED for ${host}: ${e.message}\n${e.stack}`);
        if (typeof html === 'string') {
            // Hammerhead couldn't process the page. Do basic URL rewriting
            // so resources still load through the proxy.
            if (ctx && ctx.dest) {
                const proto = ctx.dest.protocol || 'https:';
                const dHost = ctx.dest.host || '';
                if (dHost) {
                    const origin = proto + '//' + dHost;
                    // Convert relative paths to absolute so Hammerhead's runtime
                    // (if loaded) can proxy them, or the pipeline handler catches them.
                    html = html.replace(
                        /((?:href|src|action)\s*=\s*["'])(\/(?!\/)[^"']*)(["'])/gi,
                        (_m, pre, path, post) => pre + origin + path + post
                    );
                }
            }
            return html.replace(/<head[^>]*>/i, '$&' + inject);
        }
        throw e;
    }
    if (typeof result !== 'string') return result;
    return result.replace(/<head[^>]*>/i, '$&' + inject);
};
