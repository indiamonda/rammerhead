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
    'try{if(typeof crypto!=="undefined"&&!crypto.randomUUID){crypto.randomUUID=function(){var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;var h="";for(var i=0;i<16;i++){h+=(b[i]<16?"0":"")+b[i].toString(16);if(i===3||i===5||i===7||i===9)h+="-"}return h}}}catch(e){}',
    '})();</script>',
].join('\n');

const DEVTOOLS_SCRIPT = `<script>(function(){
if(typeof window==="undefined"||window.__rhC)return;window.__rhC=1;
window.__rhQ=[];window.__rhNet=[];window.__rhSrc=[];
var _oC=window.console||{},_srcSeen={};
var _proxyRe=/\\/[a-z0-9]{32}(?:![a-z]*)?\\/((https?):\\/\\/.+)/i;
function _cleanUrl(u){if(!u)return u;var m=u.match(_proxyRe);return m?m[1]:u}
function _ser(a){
if(a===void 0)return"undefined";if(a===null)return"null";
if(a instanceof Error)return(a.stack||a.message||""+a).slice(0,1500);
if(typeof a==="function")return"f "+(a.name||"anon");
if(typeof a==="symbol")return a.toString();
if(typeof a==="object"){try{var s=JSON.stringify(a);return s.length>2000?s.slice(0,2000)+"\\u2026":s}catch(e){return""+a}}
var s=""+a;return s.length>2000?s.slice(0,2000)+"\\u2026":s
}
function _esc(s){var d=document.createElement("span");d.textContent=s;return d.innerHTML}
var _lvlColor={log:"#fff",info:"#8cf",warn:"#fd6",error:"#f66",debug:"#aaa"};
function _addSrc(url,type){url=_cleanUrl(url);if(!url||typeof url!=="string"||_srcSeen[url])return;_srcSeen[url]=1;window.__rhSrc.push({u:url,tp:type})}

["log","warn","error","info","debug"].forEach(function(m){
var o=_oC[m]||function(){};
_oC[m]=function(){
try{o.apply(_oC,arguments)}catch(e){}
var a=[];for(var i=0;i<arguments.length;i++)a.push(_ser(arguments[i]));
window.__rhQ.push({l:m,a:a,t:Date.now()});
try{_panelLog(m,a.join(" "))}catch(e){}
}});
window.console=_oC;
window.addEventListener("error",function(e){
var msg=e.error?(e.error.stack||e.error.message):e.message;
window.__rhQ.push({l:"error",a:["[Uncaught] "+_ser(msg)],t:Date.now()});
try{_panelLog("error","[Uncaught] "+_ser(msg))}catch(e2){}
});
window.addEventListener("unhandledrejection",function(e){
var r=e.reason;
window.__rhQ.push({l:"error",a:["[Promise] "+_ser(r&&r.stack?r.stack:r)],t:Date.now()});
try{_panelLog("error","[Promise] "+_ser(r&&r.stack?r.stack:r))}catch(e2){}
});

if(typeof fetch==="function"){var _oF=fetch;
window.fetch=function(){var a=arguments,u="",m="GET",st=Date.now();
try{if(typeof a[0]==="string")u=a[0];else if(a[0]&&a[0].url)u=a[0].url;if(a[1]&&a[1].method)m=a[1].method}catch(e){}
var entry={m:m,u:_cleanUrl(u).slice(0,300),s:0,tp:"fetch",t0:st,t1:0};window.__rhNet.push(entry);
try{_panelNet(entry)}catch(e){}
return _oF.apply(this,a).then(function(r){entry.s=r.status;entry.t1=Date.now();try{var ct=r.headers.get("content-type");if(ct)entry.ct=ct.split(";")[0]}catch(e){}try{_panelNetUpdate(entry)}catch(e){}return r},function(e){entry.s=-1;entry.t1=Date.now();try{_panelNetUpdate(entry)}catch(e2){}throw e})}}
if(typeof XMLHttpRequest!=="undefined"){var _oXO=XMLHttpRequest.prototype.open,_oXS=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){this.__rhM=m;this.__rhU=(""+u).slice(0,300);this.__rhT0=Date.now();return _oXO.apply(this,arguments)};
XMLHttpRequest.prototype.send=function(){var x=this,entry={m:x.__rhM||"GET",u:_cleanUrl(x.__rhU||""),s:0,tp:"xhr",t0:x.__rhT0||Date.now(),t1:0};
window.__rhNet.push(entry);try{_panelNet(entry)}catch(e){}
x.addEventListener("loadend",function(){entry.s=x.status;entry.t1=Date.now();try{entry.ct=(x.getResponseHeader("content-type")||"").split(";")[0]}catch(e){}try{_panelNetUpdate(entry)}catch(e){}});return _oXS.apply(this,arguments)}}

function _scanDOM(){try{document.querySelectorAll("script[src]").forEach(function(e){_addSrc(e.src,"js")})}catch(e){}
try{document.querySelectorAll("link[rel=stylesheet]").forEach(function(e){_addSrc(e.href,"css")})}catch(e){}
try{document.querySelectorAll("img[src]").forEach(function(e){_addSrc(e.src,"img")})}catch(e){}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_scanDOM);else _scanDOM();

var _panelEl,_conBody,_netBody,_srcBody;
var _panelLog=function(){},_panelNet=function(){},_panelNetUpdate=function(){};
function _buildPanel(){
if(_panelEl)return;
var host=document.createElement("div");host.id="__rh_devpanel_host";
document.documentElement.appendChild(host);
var shadow=host.attachShadow?host.attachShadow({mode:"open"}):host;
var wrap=document.createElement("div");wrap.innerHTML='\\
<style>\\
*{margin:0;padding:0;box-sizing:border-box}\\
:host{all:initial}\\
.rh-panel{position:fixed;bottom:0;left:0;right:0;height:260px;background:#1e1e1e;color:#d4d4d4;\\
font:12px/1.4 Consolas,Monaco,"Courier New",monospace;z-index:2147483647;display:flex;flex-direction:column;\\
border-top:2px solid #007acc;transition:transform .2s;transform:translateY(0)}\\
.rh-panel.rh-hidden{transform:translateY(100%)}\\
.rh-tabs{display:flex;background:#252526;border-bottom:1px solid #3c3c3c;user-select:none;flex-shrink:0}\\
.rh-tab{padding:4px 14px;cursor:pointer;color:#969696;border-bottom:2px solid transparent;font-size:11px;letter-spacing:.3px}\\
.rh-tab:hover{color:#d4d4d4;background:#2a2d2e}\\
.rh-tab.active{color:#fff;border-bottom-color:#007acc}\\
.rh-actions{margin-left:auto;display:flex;align-items:center;gap:4px;padding:0 6px}\\
.rh-btn{background:none;border:none;color:#969696;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:3px}\\
.rh-btn:hover{color:#fff;background:#3c3c3c}\\
.rh-body{flex:1;overflow:hidden;position:relative}\\
.rh-pane{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;display:none;padding:2px 0}\\
.rh-pane.active{display:block}\\
.rh-row{padding:1px 8px;border-bottom:1px solid #2a2a2a;white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.5}\\
.rh-row.log{color:#d4d4d4}.rh-row.info{color:#88ccff}.rh-row.warn{color:#ffdd66;background:#332b00}\\
.rh-row.error{color:#ff6666;background:#2b0000}.rh-row.debug{color:#aaa}\\
.rh-row .ts{color:#666;margin-right:6px;font-size:10px}\\
.rh-net-row{display:flex;padding:2px 8px;border-bottom:1px solid #2a2a2a;font-size:11px;gap:8px;align-items:baseline}\\
.rh-net-row .method{color:#c586c0;width:36px;flex-shrink:0;font-weight:bold}\\
.rh-net-row .status{width:28px;flex-shrink:0;text-align:right}\\
.rh-net-row .status.s2{color:#4ec9b0}.rh-net-row .status.s3{color:#dcdcaa}.rh-net-row .status.s4{color:#ce9178}.rh-net-row .status.s5{color:#f44}.rh-net-row .status.sfail{color:#f44}\\
.rh-net-row .url{color:#9cdcfe;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}\\
.rh-net-row .time{color:#666;width:50px;flex-shrink:0;text-align:right}\\
.rh-src-row{padding:2px 8px;border-bottom:1px solid #2a2a2a;font-size:11px;display:flex;gap:8px}\\
.rh-src-row .tp{color:#c586c0;width:36px;flex-shrink:0}.rh-src-row .su{color:#9cdcfe;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\\
.rh-input-row{display:flex;border-top:1px solid #3c3c3c;flex-shrink:0;background:#1e1e1e}\\
.rh-input-row span{color:#007acc;padding:2px 6px;font-size:12px;line-height:24px}\\
.rh-input-row input{flex:1;background:transparent;border:none;color:#d4d4d4;font:12px Consolas,Monaco,monospace;outline:none;padding:2px 4px}\\
.rh-toggle{position:fixed;bottom:8px;right:8px;z-index:2147483646;width:32px;height:32px;border-radius:50%;\\
background:#007acc;border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}\\
.rh-toggle:hover{background:#0098ff}\\
</style>\\
<button class="rh-toggle" title="Toggle DevTools (Ctrl+Shift+D)">&#9881;</button>\\
<div class="rh-panel rh-hidden">\\
<div class="rh-tabs">\\
<div class="rh-tab active" data-pane="console">Console</div>\\
<div class="rh-tab" data-pane="network">Network</div>\\
<div class="rh-tab" data-pane="sources">Sources</div>\\
<div class="rh-actions"><button class="rh-btn" id="rh-clear" title="Clear">&#x1D5EB;</button><button class="rh-btn" id="rh-close" title="Close">&times;</button></div>\\
</div>\\
<div class="rh-body">\\
<div class="rh-pane active" id="rh-con"></div>\\
<div class="rh-pane" id="rh-net"></div>\\
<div class="rh-pane" id="rh-src"></div>\\
</div>\\
<div class="rh-input-row"><span>&gt;</span><input id="rh-eval" placeholder="Evaluate JavaScript..." autocomplete="off" spellcheck="false"></div>\\
</div>';
shadow.appendChild(wrap);
_panelEl=shadow.querySelector(".rh-panel");
_conBody=shadow.querySelector("#rh-con");
_netBody=shadow.querySelector("#rh-net");
_srcBody=shadow.querySelector("#rh-src");
var toggle=shadow.querySelector(".rh-toggle");
toggle.addEventListener("click",function(){_panelEl.classList.toggle("rh-hidden")});
shadow.querySelector("#rh-close").addEventListener("click",function(){_panelEl.classList.add("rh-hidden")});
shadow.querySelector("#rh-clear").addEventListener("click",function(){
var active=shadow.querySelector(".rh-pane.active");if(active)active.innerHTML=""});
shadow.querySelectorAll(".rh-tab").forEach(function(tab){
tab.addEventListener("click",function(){
shadow.querySelectorAll(".rh-tab").forEach(function(t){t.classList.remove("active")});
shadow.querySelectorAll(".rh-pane").forEach(function(p){p.classList.remove("active")});
tab.classList.add("active");
shadow.querySelector("#rh-"+tab.dataset.pane).classList.add("active");
if(tab.dataset.pane==="sources")_refreshSrc();
})});
var evalInput=shadow.querySelector("#rh-eval");
evalInput.addEventListener("keydown",function(e){
if(e.key==="Enter"&&this.value.trim()){
var code=this.value;this.value="";
_panelLog("log","> "+code);
try{var r=eval.call(window,code);_panelLog("log",_ser(r))}catch(err){_panelLog("error",err.message||""+err)}
}});
document.addEventListener("keydown",function(e){
if(e.ctrlKey&&e.shiftKey&&(e.key==="D"||e.key==="d")){e.preventDefault();_panelEl.classList.toggle("rh-hidden")}});
_panelLog=function(lvl,msg){if(!_conBody)return;
var d=document.createElement("div");d.className="rh-row "+lvl;
var t=new Date();var ts=("0"+t.getHours()).slice(-2)+":"+("0"+t.getMinutes()).slice(-2)+":"+("0"+t.getSeconds()).slice(-2);
d.innerHTML='<span class="ts">'+ts+"</span>"+_esc(msg);
_conBody.appendChild(d);if(_conBody.children.length>500)_conBody.removeChild(_conBody.firstChild);
d.scrollIntoView({block:"end",behavior:"auto"})};
var _netIdx=0;
_panelNet=function(entry){if(!_netBody)return;
entry.__idx=_netIdx++;
var d=document.createElement("div");d.className="rh-net-row";d.id="rh-nr-"+entry.__idx;
d.innerHTML='<span class="method">'+_esc(entry.m)+'</span><span class="status">...</span><span class="url" title="'+_esc(entry.u)+'">'+_esc(entry.u)+'</span><span class="time"></span>';
_netBody.appendChild(d);d.scrollIntoView({block:"end",behavior:"auto"})};
_panelNetUpdate=function(entry){if(!_netBody||entry.__idx===undefined)return;
var row=_netBody.querySelector("#rh-nr-"+entry.__idx);if(!row)return;
var sc=entry.s>=500?"s5":entry.s>=400?"s4":entry.s>=300?"s3":entry.s>=200?"s2":entry.s<0?"sfail":"";
var ms=entry.t1&&entry.t0?(entry.t1-entry.t0)+"ms":"";
row.querySelector(".status").className="status "+sc;row.querySelector(".status").textContent=entry.s<0?"ERR":entry.s||"";
row.querySelector(".time").textContent=ms};
function _refreshSrc(){if(!_srcBody)return;_srcBody.innerHTML="";
window.__rhSrc.forEach(function(s){var d=document.createElement("div");d.className="rh-src-row";
d.innerHTML='<span class="tp">'+_esc(s.tp)+'</span><span class="su" title="'+_esc(s.u)+'">'+_esc(s.u)+'</span>';
_srcBody.appendChild(d)})}
window.__rhQ.forEach(function(q){_panelLog(q.l,q.a.join(" "))});
window.__rhNet.forEach(function(n){_panelNet(n);if(n.s)_panelNetUpdate(n)});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_buildPanel);
else setTimeout(_buildPanel,0);
})()</script>`;

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

// Domains whose JS-heavy SPAs break under Hammerhead's full AST rewriting.
// These get "lite" processing: runtime scripts are injected but inline JS
// is NOT instrumented, preventing React/Next.js hydration mismatches.
const LITE_DOMAINS_EXACT = new Set([
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'poki.com',
    'bilibili.com',
    'doubao.com',
    'discord.com',
    'github.com',
    'duckduckgo.com',
    'qianwen.com',
]);
const LITE_DOMAINS_SUFFIX = [
    '.chatgpt.com',
    '.openai.com',
    '.claude.ai',
    '.poki.com',
    '.bilibili.com',
    '.doubao.com',
    '.discord.com',
    '.github.com',
    '.aliyun.com',
    '.duckduckgo.com',
    '.qianwen.com',
];
function _needsLiteProcessing(ctx) {
    if (!ctx || !ctx.dest) return false;
    const host = (ctx.dest.host || '').toLowerCase().replace(/:\d+$/, '');
    if (LITE_DOMAINS_EXACT.has(host)) return true;
    for (let i = 0; i < LITE_DOMAINS_SUFFIX.length; i++) {
        if (host.endsWith(LITE_DOMAINS_SUFFIX[i])) return true;
    }
    return false;
}

// Lite processing: leave inline JS untouched (prevents React hydration
// breakage), inject a bridge script for runtime fetch/XHR/EventSource
// interception + MutationObserver for dynamically added elements.
function _liteProcess(html, ctx, inject) {
    if (!ctx || !ctx.dest) return html.replace(/<head[^>]*>/i, '$&' + inject);

    const proto = ctx.dest.protocol || 'https:';
    const dHost = ctx.dest.host || '';
    const sessionId = ctx.session && ctx.session.id;
    const origin = dHost ? proto + '//' + dHost : '';

    // Build the proxy origin for the bridge script
    const serverInfo = ctx.serverInfo || {};
    const proxyPort = serverInfo.port || '';
    const protocol = serverInfo.protocol || 'http:';
    const hostname = serverInfo.hostname || 'localhost';
    const proxyOrigin = protocol + '//' + hostname + (proxyPort == 443 || proxyPort == 80 ? '' : ':' + proxyPort);
    const sid = sessionId || '';
    const proxyPrefix = proxyOrigin + '/' + sid + '/';

    // Strip integrity attributes — Hammerhead modifies CSS/JS content, invalidating SRI hashes
    html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
    // Strip nonce attributes — CSP nonces won't match through the proxy
    html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');

    // Single-pass rewrite for href/src/action/poster/data attributes, srcset, and CSS url()
    const ATTR_AND_URL_RE = /((?:href|src|action|poster|data)\s*=\s*["'])(\/\/[^"']+|\/(?!\/)[^"']*|https?:\/\/[^"']+)(["'])|(srcset\s*=\s*")([^"]*)(")|(url\(\s*['"]?)((?:https?:)?\/\/[^'")]+)(['"]?\s*\))/gi;
    html = html.replace(ATTR_AND_URL_RE, (_m, aPre, aUrl, aPost, ssPre, ssVal, ssPost, uPre, uUrl, uPost) => {
        if (aPre) {
            if (aUrl.startsWith('//')) return aPre + proxyPrefix + 'https:' + aUrl + aPost;
            if (/^https?:\/\//i.test(aUrl)) return aUrl.startsWith(proxyOrigin) ? _m : aPre + proxyPrefix + aUrl + aPost;
            if (origin && aUrl.startsWith('/')) return aPre + proxyPrefix + origin + aUrl + aPost;
            return _m;
        }
        if (ssPre) return ssPre + ssVal.replace(/((?:https?:)?\/\/[^\s,]+)/gi, u => {
            if (u.startsWith(proxyOrigin)) return u;
            if (u.startsWith('//')) return proxyPrefix + 'https:' + u;
            return proxyPrefix + u;
        }) + ssPost;
        if (uPre) {
            if (uUrl.startsWith(proxyOrigin)) return _m;
            if (uUrl.startsWith('//')) return uPre + proxyPrefix + 'https:' + uUrl + uPost;
            return uPre + proxyPrefix + uUrl + uPost;
        }
        return _m;
    });

    // Rewrite paths in ALL inline scripts — both module imports and JSON data
    // like __reactRouterManifest which contains "/cdn/assets/..." paths that
    // React Router uses for dynamic import() (which can't be monkey-patched).
    if (origin) {
        html = html.replace(
            /(<script(?:[^>]*)>)([\s\S]*?)(<\/script>)/gi,
            (_m, open, body, close) => {
                if (/type\s*=\s*["']application\/ld\+json["']/i.test(open)) return _m;
                // Rewrite relative /cdn/ and /cdn-cgi/ paths in string literals
                // (dynamic import() can't be intercepted by the bridge script)
                body = body.replace(/(["'])(\/cdn(?:-cgi)?\/[^"']+)(["'])/g,
                    (_m2, q1, path, q2) => q1 + proxyPrefix + origin + path + q2);
                // Rewrite import()/from/import statements in ALL scripts
                body = body.replace(/(import\(\s*["'])(\/[^"']+)(["']\s*\))/g,
                    (_m2, pre, path, post) => pre + proxyPrefix + origin + path + post);
                if (/type\s*=\s*["']module["']/i.test(open)) {
                    body = body.replace(/((?:^|[\s;,{(])import\s*["'])(\/[^"']+)(["'])/gm,
                        (_m2, pre, path, post) => pre + proxyPrefix + origin + path + post);
                    body = body.replace(/(from\s*["'])(\/[^"']+)(["'])/g,
                        (_m2, pre, path, post) => pre + proxyPrefix + origin + path + post);
                }
                return open + body + close;
            }
        );
    }

    const destUrl = ctx.dest.url || (origin + (ctx.dest.partAfterHost || '/'));

    const bridge = `<script>(function(){
var O=${JSON.stringify(proxyOrigin)},S=${JSON.stringify(sid)},D=${JSON.stringify(destUrl)};
try{document.cookie='__rh_sess='+S+'|'+D+';path=/'}catch(e){}
function px(u){return O+'/'+S+'/'+u}
function isExt(u){if(!u||typeof u!=='string')return false;u=u.trim();
return/^https?:\\/\\//i.test(u)&&u.indexOf(O)!==0}
function isProto(u){return typeof u==='string'&&u.length>2&&u.charCodeAt(0)===47&&u.charCodeAt(1)===47&&u.charCodeAt(2)!==47}
function rw(u){if(!u||typeof u!=='string')return u;u=u.trim();
if(u.indexOf(O+'/')===0)return u;
if(isProto(u))return px('https:'+u);if(isExt(u))return px(u);if(isRel(u))return pxRel(u);return u}
try{var du=new URL(D);var DO=du.origin;
try{history.replaceState(history.state,'',du.pathname+(du.search||'')+(du.hash||''))}catch(e){}
window.__rhDestUrl=du.href;
function isRel(u){return typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf('/'+S+'/')!==0}
function pxRel(u){return O+'/'+S+'/'+DO+u}
var _rl=window.location,_rr=_rl.replace.bind(_rl),_ra=_rl.assign.bind(_rl),_rrl=_rl.reload.bind(_rl);
var lp={href:{get:function(){return du.href},set:function(v){_rr(rw(v)||v)}},
hostname:{get:function(){return du.hostname}},host:{get:function(){return du.host}},
origin:{get:function(){return du.origin}},protocol:{get:function(){return du.protocol}},
pathname:{get:function(){return du.pathname},set:function(v){_rr(pxRel(v))}},
search:{get:function(){return du.search},set:function(v){du.search=v;_rr(pxRel(du.pathname+v))}},
hash:{get:function(){return du.hash},set:function(v){du.hash=v}},
port:{get:function(){return du.port}},
assign:{value:function(u){_ra(rw(u)||u)}},
replace:{value:function(u){_rr(rw(u)||u)}},
reload:{value:function(){_rrl()}},
toString:{value:function(){return du.href}}};
try{Object.defineProperty(window,'location',{configurable:true,enumerable:true,
get:function(){var o=Object.create(null);for(var k in lp){try{Object.defineProperty(o,k,lp[k])}catch(e){}}
o[Symbol.toPrimitive]=function(){return du.href};return o},
set:function(v){_rr(rw(''+v)||(''+v))}})}catch(e){}
try{Object.defineProperty(document,'location',{configurable:true,enumerable:true,
get:function(){return window.location},set:function(v){window.location=v}})}catch(e){}
try{Object.defineProperty(document,'domain',{get:function(){return du.hostname},set:function(){},configurable:true})}catch(e){}
var oF=window.fetch;if(oF)window.fetch=function(u,o){
if(typeof u==='string'){u=rw(u)}
else if(u&&typeof u==='object'&&u.url){var nu=rw(u.url);if(nu!==u.url)try{u=new Request(nu,u)}catch(e){}}
return oF.call(this,u,o)};
var XP=XMLHttpRequest.prototype,oX=XP.open;
XP.open=function(m,u){if(typeof u==='string'){arguments[1]=rw(u)}return oX.apply(this,arguments)};
if(typeof EventSource!=='undefined'){var oE=EventSource;
window.EventSource=function(u,o){return new oE(rw(u)||u,o)};
window.EventSource.prototype=oE.prototype;
try{Object.defineProperty(window.EventSource,'CONNECTING',{value:0});
Object.defineProperty(window.EventSource,'OPEN',{value:1});
Object.defineProperty(window.EventSource,'CLOSED',{value:2})}catch(e){}}
var oW=window.open;if(oW)window.open=function(u){
if(typeof u==='string'){arguments[0]=rw(u)}return oW.apply(this,arguments)};
var oWS=window.WebSocket;if(oWS){window.WebSocket=function(u,p){
if(typeof u==='string'){var hu=u;
if(/^wss?:\\/\\//i.test(u)){hu=u.replace(/^ws/i,'http')}
if(isProto(hu)){hu='https:'+hu}
if(isExt(hu)){u=O.replace(/^http/i,'ws')+'/'+S+'/'+hu}}
return p!==undefined?new oWS(u,p):new oWS(u)};
window.WebSocket.prototype=oWS.prototype;
Object.keys(oWS).forEach(function(k){try{window.WebSocket[k]=oWS[k]}catch(e){}});
['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){try{Object.defineProperty(window.WebSocket,k,{value:oWS[k]})}catch(e){}})}
try{if(navigator.serviceWorker){Object.defineProperty(navigator,'serviceWorker',{configurable:true,
get:function(){return{register:function(){return Promise.reject(new DOMException('blocked','SecurityError'))},
getRegistration:function(){return Promise.resolve(undefined)},
getRegistrations:function(){return Promise.resolve([])},
ready:new Promise(function(){}),controller:null,
addEventListener:function(){},removeEventListener:function(){}}}})}}catch(e){}
var oSB=navigator.sendBeacon;if(oSB){try{navigator.sendBeacon=function(u,d){return oSB.call(navigator,rw(u)||u,d)}}catch(e){}}
var oImg=window.Image;if(oImg){window.Image=function(w,h){var i=new oImg(w,h);
var oSet=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')||{};
if(oSet.set){var origSet=oSet.set;Object.defineProperty(i,'src',{get:function(){return oSet.get?oSet.get.call(i):''},
set:function(v){if(typeof v==='string')v=rw(v);origSet.call(i,v)},configurable:true})}
return i};window.Image.prototype=oImg.prototype}
var oWorker=window.Worker;if(oWorker){window.Worker=function(u,o){
if(typeof u==='string')u=rw(u);return new oWorker(u,o)};
window.Worker.prototype=oWorker.prototype}
var oSW=window.SharedWorker;if(oSW){window.SharedWorker=function(u,o){
if(typeof u==='string')u=rw(u);return new oSW(u,o)};
window.SharedWorker.prototype=oSW.prototype}
try{var oPS=history.pushState.bind(history);history.pushState=function(s,t,u){
if(typeof u==='string'){if(isExt(u)||isProto(u))u=rw(u);else if(isRel(u)){try{du=new URL(u,DO+'/')}catch(e){}window.__rhDestUrl=du.href}}return oPS(s,t,u)};
var oRS=history.replaceState.bind(history);history.replaceState=function(s,t,u){
if(typeof u==='string'){if(isExt(u)||isProto(u))u=rw(u);else if(isRel(u)){try{du=new URL(u,DO+'/')}catch(e){}window.__rhDestUrl=du.href}}return oRS(s,t,u)}}catch(e){}
window.addEventListener('popstate',function(){try{var l=window.location;du=new URL(l.pathname+(l.search||'')+(l.hash||''),DO+'/');window.__rhDestUrl=du.href}catch(e){}});
try{var sSA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){
var nl=n.toLowerCase();if((nl==='src'||nl==='href'||nl==='action'||nl==='data'||nl==='poster')&&typeof v==='string'){v=rw(v)}
return sSA.call(this,n,v)}}catch(e){}
try{['src','href','action','poster'].forEach(function(attr){
var els=[HTMLImageElement,HTMLScriptElement,HTMLLinkElement,HTMLAnchorElement,HTMLSourceElement,
HTMLVideoElement,HTMLAudioElement,HTMLIFrameElement,HTMLEmbedElement,HTMLAreaElement];
els.forEach(function(E){if(!E||!E.prototype)return;
var d=Object.getOwnPropertyDescriptor(E.prototype,attr);
if(d&&d.set){var oSet=d.set,oGet=d.get;Object.defineProperty(E.prototype,attr,{configurable:true,enumerable:true,
get:function(){return oGet?oGet.call(this):undefined},
set:function(v){if(typeof v==='string')v=rw(v);oSet.call(this,v)}})}})
})}catch(e){}
try{var dCookie=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
if(dCookie){var ogSet=dCookie.set,ogGet=dCookie.get;
Object.defineProperty(document,'cookie',{configurable:true,
get:function(){var c=ogGet.call(this);return c.replace(/__rh_[^;]*(;\\s*)?/g,'').replace(/;\\s*$/,'')},
set:function(v){ogSet.call(this,v)}})}}catch(e){}
}catch(e){}
function fixEl(el){if(!el||el.nodeType!==1||el.__rhLite)return;el.__rhLite=1;
var t=el.tagName;
['src','href','action','data','poster'].forEach(function(a){var v=el.getAttribute(a);if(v){var n=rw(v);if(n!==v)el.setAttribute(a,n)}});
var ss=el.getAttribute('srcset');if(ss){var nss=ss.replace(/((?:https?:)?\\/\\/[^\\s,]+)/gi,function(u){return rw(u)});
if(nss!==ss)el.setAttribute('srcset',nss)}
var bg=el.style&&el.style.backgroundImage;
if(bg&&/url\\(/i.test(bg)){var nbg=bg.replace(/url\\(['\"]?((?:https?:)?\\/\\/[^'\")]+)['\"]?\\)/gi,function(m,u){var n=rw(u);return n!==u?'url('+n+')':m});
if(nbg!==bg)el.style.backgroundImage=nbg}
if(t==='STYLE'&&el.sheet){try{var rules=el.sheet.cssRules;for(var i=0;i<rules.length;i++){
var txt=rules[i].cssText;if(/url\\(/i.test(txt)){var nt=txt.replace(/url\\(['\"]?((?:https?:)?\\/\\/[^'\")]+)['\"]?\\)/gi,function(m,u){var n=rw(u);return n!==u?'url('+n+')':m});
if(nt!==txt){try{el.sheet.deleteRule(i);el.sheet.insertRule(nt,i)}catch(e){}}}}}catch(e){}}
}
function fixTree(n){fixEl(n);try{var els=n.querySelectorAll('iframe,script,img,link,a,form,source,video,audio,embed,object,area,style');
for(var i=0;i<els.length;i++)fixEl(els[i])}catch(e){}}
function startObs(){var r=document.documentElement;if(!r){document.addEventListener('DOMContentLoaded',startObs);return}
fixTree(r);
new MutationObserver(function(ml){for(var i=0;i<ml.length;i++){var m=ml[i];
if(m.type==='childList'){for(var j=0;j<m.addedNodes.length;j++)fixTree(m.addedNodes[j])}
else if(m.type==='attributes'){m.target.__rhLite=0;fixEl(m.target)}}
}).observe(r,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href','action','data','poster','srcset']})}
startObs();
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');
if(a){var ah=a.getAttribute('href');var n=rw(ah);if(n!==ah)a.setAttribute('href',n)}},true);
document.addEventListener('submit',function(e){var f=e.target;
if(f&&f.tagName==='FORM'){var fa=f.getAttribute('action');if(fa){var n=rw(fa);if(n!==fa)f.setAttribute('action',n)}}},true);
})()</script>`;

    html = html.replace(/<head[^>]*>/i, '$&' + inject + bridge);
    return html;
}

const _DEV = !!process.env.DEVELOPMENT;
const INJECT_PROD = ANTIDETECT_SCRIPT;
const INJECT_DEV = ANTIDETECT_SCRIPT + DEVTOOLS_SCRIPT;

pageProcessor.processResource = function patchedProcessResource(html, ctx, charset, urlReplacer, isSrcdoc) {
    const inject = _DEV ? INJECT_DEV : INJECT_PROD;

    if (typeof html === 'string' && ctx && ctx.dest) {
        const destHost = (ctx.dest.host || '').toLowerCase();
        // Pre-process DDG HTML pages to fix result links before shuffling
        if (destHost === 'html.duckduckgo.com' || destHost === 'lite.duckduckgo.com') {
            html = _rewriteDdgLinks(html);
        }
        // Pre-process CF challenge URLs to absolute paths
        html = _fixCfChallengeUrls(html, ctx);
    }

    // Use lite processing for complex SPAs that break under full instrumentation
    if (typeof html === 'string' && _needsLiteProcessing(ctx) && !isSrcdoc) {
        return _liteProcess(html, ctx, inject);
    }

    let result;
    try {
        result = origProcess(html, ctx, charset, urlReplacer, isSrcdoc);
    } catch (e) {
        const host = ctx && ctx.dest && ctx.dest.host || '?';
        console.error(`[patchPageProcessing] processResource FAILED for ${host}: ${e.message}\n${e.stack}`);
        if (typeof html === 'string') {
            if (ctx && ctx.dest) {
                const proto = ctx.dest.protocol || 'https:';
                const dHost = ctx.dest.host || '';
                if (dHost) {
                    const origin = proto + '//' + dHost;
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
