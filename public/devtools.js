(function(){
'use strict';
if(window.__rhDevTools)return;window.__rhDevTools=1;
var Q=window.__rhQ||[],NET=window.__rhNet||[],SRC=window.__rhSrc||[];
var _shadow,_panel,_activeTab='console';

function esc(s){var d=document.createElement('span');d.textContent=String(s);return d.innerHTML}
function formatBytes(n){if(!n||n<0)return'0 B';if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';return(n/1048576).toFixed(1)+' MB'}
function formatMs(ms){if(!ms&&ms!==0)return'';if(ms<1)return'<1 ms';if(ms<1000)return Math.round(ms)+' ms';return(ms/1000).toFixed(2)+' s'}
function $(sel,ctx){return(ctx||_shadow).querySelector(sel)}
function $$(sel,ctx){return Array.from((ctx||_shadow).querySelectorAll(sel))}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!==undefined)e.innerHTML=html;return e}
function ts(){var t=new Date();return('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2)+':'+('0'+t.getSeconds()).slice(-2)}
var _proxyRe=/\/[a-z0-9]{32}(?:![a-z]*)?\/((https?):\/\/.+)/i;
function cleanUrl(u){if(!u)return u;var m=String(u).match(_proxyRe);return m?m[1]:String(u)}
function _rhFetchSource(url){
  var qs='?url='+encodeURIComponent(url);
  return fetch('/_a/sr'+qs).then(function(r){
    if(!r.ok)throw new Error('s '+r.status);
    return r.text();
  }).catch(function(){
    return fetch('/__rh_sources'+qs).then(function(r){return r.text()});
  });
}

function serVal(v,depth){
  if(depth===undefined)depth=0;
  if(v===undefined)return'undefined';if(v===null)return'null';
  if(typeof v==='string')return depth>0?'"'+v.slice(0,500)+(v.length>500?'…':'')+'"':v;
  if(typeof v==='number'||typeof v==='boolean')return String(v);
  if(typeof v==='symbol')return v.toString();
  if(typeof v==='function')return'ƒ '+(v.name||'anonymous');
  if(v instanceof Error)return(v.stack||v.message||String(v)).slice(0,1500);
  if(Array.isArray(v))return depth>2?'[…]':'['+(v.length>5?v.length+' items':'…')+']';
  if(typeof v==='object'){try{var k=Object.keys(v);return depth>2?'{…}':'{'+k.slice(0,3).join(', ')+(k.length>3?', …':'')+'}';}catch(e){return String(v)}}
  return String(v).slice(0,500);
}

// ===== CSS =====
var CSS=`
*{margin:0;padding:0;box-sizing:border-box}
:host{all:initial}
.rh-panel{position:fixed;bottom:0;left:0;right:0;height:280px;background:#1e1e1e;color:#d4d4d4;font:12px/1.4 Consolas,Monaco,"Courier New",monospace;z-index:2147483647;display:flex;flex-direction:column;border-top:2px solid #007acc}
.rh-panel.rh-hidden{display:none}
.rh-resize{height:5px;cursor:ns-resize;background:transparent;flex-shrink:0;position:relative}
.rh-resize::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:3px;background:#555;border-radius:2px}
.rh-resize:hover::after{background:#007acc}
.rh-tabs{display:flex;background:#252526;border-bottom:1px solid #3c3c3c;user-select:none;flex-shrink:0;overflow-x:auto;scrollbar-width:none}
.rh-tabs::-webkit-scrollbar{display:none}
.rh-tab{padding:5px 10px;cursor:pointer;color:#969696;border-bottom:2px solid transparent;font-size:11px;white-space:nowrap;flex-shrink:0;letter-spacing:.3px}
.rh-tab:hover{color:#d4d4d4;background:#2a2d2e}
.rh-tab.active{color:#fff;border-bottom-color:#007acc}
.rh-actions{margin-left:auto;display:flex;align-items:center;gap:4px;padding:0 6px;flex-shrink:0}
.rh-btn{background:none;border:none;color:#969696;cursor:pointer;font-size:13px;padding:2px 6px;border-radius:3px;font-family:inherit}
.rh-btn:hover{color:#fff;background:#3c3c3c}
.rh-body{flex:1;overflow:hidden;position:relative;min-height:0}
.rh-pane{position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden}
.rh-pane.active{display:flex}
.rh-toggle{position:fixed;bottom:8px;right:8px;z-index:2147483646;width:32px;height:32px;border-radius:50%;background:#007acc;border:none;color:#fff;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.rh-toggle:hover{background:#0098ff}
.rh-toolbar{display:flex;gap:4px;padding:3px 8px;border-bottom:1px solid #3c3c3c;background:#252526;flex-shrink:0;align-items:center;overflow-x:auto}
.rh-fbtn{background:none;border:1px solid transparent;color:#969696;cursor:pointer;font:10px/1.2 inherit;padding:1px 7px;border-radius:10px}
.rh-fbtn:hover{color:#d4d4d4;border-color:#555}
.rh-fbtn.on{color:#fff;background:rgba(0,122,204,.25);border-color:#007acc}
.rh-search{background:#3c3c3c;border:1px solid #555;color:#d4d4d4;font:11px/1.2 inherit;padding:2px 6px;border-radius:3px;outline:none;min-width:100px;max-width:200px}
.rh-search:focus{border-color:#007acc}
.rh-scroll{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0}
.rh-eval-row{display:flex;border-top:1px solid #3c3c3c;flex-shrink:0;background:#1e1e1e;align-items:flex-start}
.rh-eval-row span{color:#007acc;padding:2px 6px;font-size:12px;line-height:24px}
.rh-eval-row textarea{flex:1;background:transparent;border:none;color:#d4d4d4;font:12px/1.4 inherit;outline:none;padding:4px;resize:none;min-height:24px;max-height:80px;overflow-y:auto}
.rh-label{color:#969696;font-size:10px;padding:0 4px}
.rh-sep{width:1px;height:16px;background:#3c3c3c;flex-shrink:0}
.rh-chk{accent-color:#007acc;margin-right:2px}

/* Console */
.c-row{padding:2px 8px;border-bottom:1px solid #2a2a2a;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.c-row.log{color:#d4d4d4}.c-row.info{color:#88ccff}.c-row.warn{color:#ffdd66;background:#332b00}
.c-row.error{color:#ff6666;background:#2b0000}.c-row.debug{color:#aaa}
.c-row .ts{color:#666;margin-right:6px;font-size:10px}
.c-group-hdr{font-weight:bold;cursor:pointer}.c-group-hdr::before{content:'▼ ';font-size:8px}
.c-group-hdr.collapsed::before{content:'▶ ';font-size:8px}
.c-group{margin-left:12px;border-left:1px solid #3c3c3c;padding-left:4px}
.c-group.collapsed{display:none}
.c-obj{cursor:pointer;color:#75beff}.c-obj:hover{text-decoration:underline}
.c-tree{margin-left:16px;font-size:11px}
.c-tree-row{padding:0 0 0 4px}
.c-key{color:#9cdcfe}.c-str{color:#ce9178}.c-num{color:#b5cea8}.c-bool{color:#569cd6}.c-null{color:#569cd6}.c-fn{color:#dcdcaa;font-style:italic}.c-sym{color:#b5cea8}
.c-table{border-collapse:collapse;margin:4px 0;font-size:11px}
.c-table th,.c-table td{border:1px solid #3c3c3c;padding:1px 8px;text-align:left;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.c-table th{background:#252526;color:#969696}

/* Network */
.n-header{display:flex;padding:2px 8px;border-bottom:1px solid #3c3c3c;font-size:10px;color:#969696;background:#252526;gap:6px;align-items:center;flex-shrink:0}
.n-header span{flex-shrink:0}
.n-header .url{flex:1}
.n-row{display:flex;padding:2px 8px;border-bottom:1px solid #2a2a2a;font-size:11px;gap:6px;align-items:baseline;cursor:pointer}
.n-row:hover{background:#2a2d2e}
.n-row .method{color:#c586c0;width:40px;flex-shrink:0;font-weight:bold}
.n-row .status{width:32px;flex-shrink:0;text-align:right}
.n-row .status.s2{color:#4ec9b0}.n-row .status.s3{color:#dcdcaa}.n-row .status.s4{color:#ce9178}.n-row .status.s5{color:#f44}.n-row .status.sfail{color:#f44}
.n-row .url{color:#9cdcfe;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.n-row .type{color:#969696;width:50px;flex-shrink:0;text-align:center;font-size:10px}
.n-row .size{color:#969696;width:55px;flex-shrink:0;text-align:right;font-size:10px}
.n-row .time{color:#666;width:55px;flex-shrink:0;text-align:right;font-size:10px}
.n-row .wf{flex-shrink:0;width:80px;height:8px;position:relative;background:#2a2a2a;border-radius:2px}
.n-row .wf-bar{position:absolute;height:100%;background:#007acc;border-radius:2px;min-width:1px}
.n-detail{background:#1a1a2e;border-bottom:2px solid #3c3c3c;padding:8px;font-size:11px;max-height:220px;overflow-y:auto}
.n-dtabs{display:flex;gap:12px;margin-bottom:8px;border-bottom:1px solid #3c3c3c;padding-bottom:4px}
.n-dtab{cursor:pointer;color:#969696;padding:2px 0}
.n-dtab:hover{color:#d4d4d4}
.n-dtab.on{color:#fff;border-bottom:1px solid #007acc}
.n-dpane{display:none;white-space:pre-wrap;word-break:break-all}
.n-dpane.show{display:block}
.n-hdr{display:flex;gap:4px;padding:1px 0}.n-hdr .hk{color:#c586c0;min-width:120px;flex-shrink:0}.n-hdr .hv{color:#d4d4d4}
.n-summary{padding:3px 8px;border-top:1px solid #3c3c3c;background:#252526;font-size:10px;color:#969696;flex-shrink:0;display:flex;gap:16px}

/* Elements */
.e-wrap{display:flex;flex:1;min-height:0;overflow:hidden}
.e-tree-panel{flex:1;overflow:auto;min-width:0;padding:2px 0}
.e-styles-panel{width:260px;border-left:1px solid #3c3c3c;overflow-y:auto;flex-shrink:0;padding:4px}
.e-node{padding:1px 0;cursor:default;font-size:11px;white-space:nowrap}
.e-node:hover{background:#2a2d2e}
.e-node.selected{background:#264f78}
.e-indent{display:inline-block;width:16px}
.e-arrow{display:inline-block;width:12px;cursor:pointer;color:#888;text-align:center;font-size:9px;vertical-align:middle}
.e-arrow:hover{color:#fff}
.e-tag{color:#569cd6}.e-attr{color:#9cdcfe}.e-aval{color:#ce9178}.e-text{color:#aaa;font-style:italic}.e-comment{color:#6a9955}
.e-bread{padding:3px 8px;border-bottom:1px solid #3c3c3c;font-size:10px;color:#969696;flex-shrink:0;overflow-x:auto;white-space:nowrap}
.e-bread span{cursor:pointer;padding:0 2px}.e-bread span:hover{color:#fff;text-decoration:underline}
.e-search{padding:3px 8px;border-bottom:1px solid #3c3c3c;flex-shrink:0;display:flex;gap:4px;align-items:center;background:#252526}
.e-highlight{position:fixed;pointer-events:none;z-index:2147483645;background:rgba(0,122,204,.2);border:1px solid rgba(0,122,204,.6)}
.e-sect{padding:4px;color:#969696;font-size:10px;text-transform:uppercase;border-bottom:1px solid #3c3c3c}
.e-box{margin:8px;text-align:center;font-size:10px}
.e-box-margin{background:rgba(246,178,107,.15);padding:10px;border:1px dashed #ce9178;position:relative}
.e-box-border{background:rgba(255,216,100,.15);padding:8px;border:1px dashed #dcdcaa}
.e-box-padding{background:rgba(78,201,176,.15);padding:8px;border:1px dashed #4ec9b0}
.e-box-content{background:rgba(86,156,214,.2);padding:4px 12px;color:#9cdcfe}
.e-box-label{position:absolute;font-size:9px;color:#888}
.e-style-row{padding:1px 4px;font-size:11px;display:flex;gap:4px}
.e-sprop{color:#9cdcfe;min-width:120px;flex-shrink:0}.e-sval{color:#ce9178;word-break:break-all}

/* Sources */
.s-wrap{display:flex;flex:1;min-height:0;overflow:hidden}
.s-tree{width:200px;border-right:1px solid #3c3c3c;overflow-y:auto;flex-shrink:0;padding:4px 0}
.s-tree-hdr{padding:3px 8px;color:#969696;font-size:10px;text-transform:uppercase;cursor:default}
.s-file{padding:2px 12px;cursor:pointer;font-size:11px;color:#969696;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s-file:hover{color:#d4d4d4;background:#2a2d2e}
.s-file.on{color:#fff;background:#264f78}
.s-viewer{flex:1;overflow:auto;min-width:0;font-size:11px}
.s-code{display:table;width:100%;border-collapse:collapse}
.s-line{display:table-row}.s-line:hover{background:#2a2d2e}
.s-ln{display:table-cell;color:#555;text-align:right;padding:0 8px 0 4px;user-select:none;white-space:nowrap;border-right:1px solid #333;width:1px}
.s-lc{display:table-cell;padding:0 8px;white-space:pre;tab-size:4;word-break:break-all}
.s-kw{color:#c586c0}.s-cm{color:#6a9955;font-style:italic}.s-st{color:#ce9178}.s-rx{color:#d16969}
.s-snip{border-top:1px solid #3c3c3c;padding:4px 8px;flex-shrink:0;display:flex;gap:4px;align-items:center;background:#252526}
.s-sbtn{background:#3c3c3c;border:1px solid #555;color:#d4d4d4;cursor:pointer;font:10px inherit;padding:2px 8px;border-radius:3px}
.s-sbtn:hover{background:#555}
.s-empty{padding:20px;text-align:center;color:#555;font-size:12px}

/* Performance */
.p-scroll{flex:1;overflow-y:auto;padding:8px}
.p-cards{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.p-card{background:#252526;border:1px solid #3c3c3c;border-radius:4px;padding:8px 12px;min-width:90px;text-align:center}
.p-card-label{font-size:10px;color:#969696;margin-bottom:2px}.p-card-value{font-size:16px;font-weight:bold}
.p-card-value.good{color:#4ec9b0}.p-card-value.ok{color:#dcdcaa}.p-card-value.bad{color:#f44}
.p-sect{color:#969696;font-size:10px;text-transform:uppercase;margin:8px 0 4px;padding-bottom:2px;border-bottom:1px solid #3c3c3c}
.p-row{display:flex;align-items:center;margin:3px 0;font-size:11px}
.p-row-label{width:100px;color:#969696;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p-row-bar{height:10px;border-radius:2px;min-width:1px;margin-right:6px}
.p-row-val{color:#d4d4d4;font-size:10px;white-space:nowrap}
.p-fps{font-size:20px;font-weight:bold;color:#4ec9b0;margin:4px 0}

/* Memory */
.m-scroll{flex:1;overflow-y:auto;padding:8px}
.m-stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.m-stat{background:#252526;border:1px solid #3c3c3c;border-radius:4px;padding:8px 12px;min-width:120px;text-align:center}
.m-stat-label{font-size:10px;color:#969696}.m-stat-value{font-size:16px;color:#4ec9b0;margin-top:2px}
.m-sect{color:#969696;font-size:10px;text-transform:uppercase;margin:8px 0 4px;padding-bottom:2px;border-bottom:1px solid #3c3c3c}
.m-gauge{text-align:center;margin:8px 0}
.m-gauge-bar{width:100%;height:20px;background:#333;border-radius:4px;overflow:hidden;position:relative}
.m-gauge-fill{height:100%;background:#007acc;border-radius:4px;transition:width .3s}
.m-gauge-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff}
.m-timeline{margin:8px 0}
.m-timeline canvas{width:100%;height:60px;background:#252526;border:1px solid #3c3c3c;border-radius:4px}
.m-snap-row{display:flex;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px solid #2a2a2a}
.m-snap-row .label{color:#969696;width:100px;flex-shrink:0}

/* Application */
.a-wrap{display:flex;flex:1;min-height:0;overflow:hidden}
.a-sidebar{width:180px;border-right:1px solid #3c3c3c;overflow-y:auto;flex-shrink:0}
.a-sect{padding:6px 8px 2px;color:#969696;font-size:10px;text-transform:uppercase}
.a-item{padding:3px 16px;cursor:pointer;font-size:11px;color:#d4d4d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a-item:hover{background:#2a2d2e}.a-item.on{background:#264f78;color:#fff}
.a-main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.a-bar{display:flex;gap:4px;padding:4px 8px;border-bottom:1px solid #3c3c3c;background:#252526;flex-shrink:0;align-items:center}
.a-abtn{background:#3c3c3c;border:1px solid #555;color:#d4d4d4;cursor:pointer;font:10px inherit;padding:2px 8px;border-radius:3px}
.a-abtn:hover{background:#555}
.a-scroll{flex:1;overflow:auto;min-height:0}
.a-table{width:100%;border-collapse:collapse;font-size:11px}
.a-table th{background:#252526;color:#969696;padding:3px 8px;text-align:left;border-bottom:1px solid #3c3c3c;position:sticky;top:0;z-index:1}
.a-table td{padding:2px 8px;border-bottom:1px solid #2a2a2a;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.a-table tr:hover{background:#2a2d2e}
.a-table tr.sel{background:#264f78}
.a-editable{cursor:pointer}.a-editable:hover{background:#333}
.a-empty{padding:20px;text-align:center;color:#555;font-size:12px}

/* Security */
.sec-scroll{flex:1;overflow-y:auto;padding:8px}
.sec-overview{text-align:center;margin-bottom:16px}
.sec-badge{display:inline-block;padding:8px 24px;border-radius:20px;font-size:14px;font-weight:bold;margin:8px 0}
.sec-badge.secure{background:#0e3d29;color:#4ec9b0;border:1px solid #4ec9b0}
.sec-badge.insecure{background:#3d0e0e;color:#f44;border:1px solid #f44}
.sec-badge.mixed{background:#3d3d0e;color:#dcdcaa;border:1px solid #dcdcaa}
.sec-sect{color:#969696;font-size:10px;text-transform:uppercase;margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #3c3c3c}
.sec-row{padding:3px 0;font-size:11px;display:flex;gap:8px;border-bottom:1px solid #2a2a2a}
.sec-icon{width:16px;text-align:center;flex-shrink:0}
.sec-pass{color:#4ec9b0}.sec-fail{color:#f44}.sec-warn{color:#dcdcaa}

/* Lighthouse */
.lh-scroll{flex:1;overflow-y:auto;padding:8px}
.lh-header{display:flex;justify-content:center;gap:20px;padding:8px 0 16px;flex-wrap:wrap}
.lh-score{text-align:center;width:72px}
.lh-score canvas{width:64px;height:64px;display:block;margin:0 auto}
.lh-score-label{font-size:10px;color:#969696;margin-top:4px}
.lh-sect{color:#969696;font-size:10px;text-transform:uppercase;margin:12px 0 4px;padding-bottom:2px;border-bottom:1px solid #3c3c3c}
.lh-check{padding:3px 8px;font-size:11px;display:flex;gap:8px;border-bottom:1px solid #2a2a2a;align-items:baseline}
.lh-check .icon{width:16px;flex-shrink:0;text-align:center}
.lh-pass{color:#4ec9b0}.lh-fail{color:#f44}.lh-warn{color:#dcdcaa}
.lh-run{text-align:center;padding:12px}
.lh-run-btn{background:#007acc;border:none;color:#fff;padding:8px 24px;border-radius:4px;cursor:pointer;font:12px inherit}
.lh-run-btn:hover{background:#0098ff}
.lh-run-btn:disabled{opacity:.5;cursor:default}
`;

var HTML=`<button class="rh-toggle" title="Toggle DevTools (Ctrl+Shift+D)">&#9881;</button>
<div class="rh-panel rh-hidden">
<div class="rh-resize"></div>
<div class="rh-tabs">
<div class="rh-tab" data-p="elements">Elements</div>
<div class="rh-tab active" data-p="console">Console</div>
<div class="rh-tab" data-p="sources">Sources</div>
<div class="rh-tab" data-p="network">Network</div>
<div class="rh-tab" data-p="performance">Performance</div>
<div class="rh-tab" data-p="memory">Memory</div>
<div class="rh-tab" data-p="application">Application</div>
<div class="rh-tab" data-p="security">Security</div>
<div class="rh-tab" data-p="lighthouse">Lighthouse</div>
<div class="rh-actions"><button class="rh-btn" id="rh-clear" title="Clear">&#x2715;</button><button class="rh-btn" id="rh-close" title="Close">&times;</button></div>
</div>
<div class="rh-body">
<div class="rh-pane" id="rh-elements"></div>
<div class="rh-pane active" id="rh-console"></div>
<div class="rh-pane" id="rh-sources"></div>
<div class="rh-pane" id="rh-network"></div>
<div class="rh-pane" id="rh-performance"></div>
<div class="rh-pane" id="rh-memory"></div>
<div class="rh-pane" id="rh-application"></div>
<div class="rh-pane" id="rh-security"></div>
<div class="rh-pane" id="rh-lighthouse"></div>
</div>
<div class="rh-eval-row"><span>&gt;</span><textarea id="rh-eval" placeholder="Evaluate JavaScript…" rows="1" spellcheck="false"></textarea></div>
</div>`;

// ===== PANEL SETUP =====
function buildPanel(){
  if(_panel)return;
  var host=document.createElement('div');host.id='__rh_devpanel_host';
  document.documentElement.appendChild(host);
  _shadow=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var style=document.createElement('style');style.textContent=CSS;_shadow.appendChild(style);
  var wrap=document.createElement('div');wrap.innerHTML=HTML;_shadow.appendChild(wrap);
  _panel=$('.rh-panel');

  // Resize
  var resizeHandle=$('.rh-resize');
  var resizing=false,startY=0,startH=0;
  resizeHandle.addEventListener('mousedown',function(e){resizing=true;startY=e.clientY;startH=_panel.offsetHeight;e.preventDefault()});
  document.addEventListener('mousemove',function(e){if(!resizing)return;var h=startH+(startY-e.clientY);h=Math.max(150,Math.min(window.innerHeight*0.8,h));_panel.style.height=h+'px'});
  document.addEventListener('mouseup',function(){resizing=false});

  // Tabs
  $$('.rh-tab').forEach(function(tab){tab.addEventListener('click',function(){
    $$('.rh-tab').forEach(function(t){t.classList.remove('active')});
    $$('.rh-pane').forEach(function(p){p.classList.remove('active')});
    tab.classList.add('active');$('#rh-'+tab.dataset.p).classList.add('active');
    _activeTab=tab.dataset.p;
    if(_tabInits[_activeTab])_tabInits[_activeTab]();
  })});

  // Toggle
  var toggle=$('.rh-toggle');
  toggle.addEventListener('click',function(){_panel.classList.toggle('rh-hidden');toggle.style.display=_panel.classList.contains('rh-hidden')?'flex':'none'});
  $('#rh-close').addEventListener('click',function(){_panel.classList.add('rh-hidden');toggle.style.display='flex'});
  $('#rh-clear').addEventListener('click',function(){clearActivePane()});
  document.addEventListener('keydown',function(e){if(e.ctrlKey&&e.shiftKey&&(e.key==='D'||e.key==='d')){e.preventDefault();_panel.classList.toggle('rh-hidden');toggle.style.display=_panel.classList.contains('rh-hidden')?'flex':'none'}});

  // Eval
  var evalTA=$('#rh-eval');
  evalTA.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey&&this.value.trim()){e.preventDefault();
      var code=this.value;this.value='';this.style.height='24px';
      addConsoleEntry({l:'log',raw:['> '+code],t:Date.now(),d:0});
      try{var r=eval.call(window,code);addConsoleEntry({l:'log',raw:[r],t:Date.now(),d:0})}catch(err){addConsoleEntry({l:'error',raw:[err],t:Date.now(),d:0})}
    }
  });
  evalTA.addEventListener('input',function(){this.style.height='24px';this.style.height=Math.min(80,this.scrollHeight)+'px'});

  initConsole();initNetwork();initElements();initSources();
  initPerformance();initMemory();initApplication();initSecurity();initLighthouse();
  replayBuffered();setupLiveHooks();
}

function clearActivePane(){
  if(_activeTab==='console'){_conScroll.innerHTML='';_conGroupStack.length=0}
  else if(_activeTab==='network'){_netScroll.innerHTML='';_netEntries=[];updateNetSummary()}
}

var _tabInits={};
function onTabActivate(name,fn){var done=false;_tabInits[name]=function(){if(done)return;done=true;fn()}}

// ===== CONSOLE TAB =====
var _conScroll,_conFilter='all',_conSearch='',_conPreserve=false,_conGroupStack=[];
function initConsole(){
  var pane=$('#rh-console');
  pane.innerHTML='<div class="rh-toolbar"><button class="rh-fbtn on" data-f="all">All</button><button class="rh-fbtn" data-f="error">Errors</button><button class="rh-fbtn" data-f="warn">Warnings</button><button class="rh-fbtn" data-f="info">Info</button><button class="rh-fbtn" data-f="debug">Debug</button><div class="rh-sep"></div><input class="rh-search" placeholder="Filter…" id="rh-con-search"><div class="rh-sep"></div><label class="rh-label"><input type="checkbox" class="rh-chk" id="rh-con-preserve">Preserve</label></div><div class="rh-scroll" id="rh-con-scroll"></div>';
  _conScroll=$('#rh-con-scroll');
  pane.querySelectorAll('.rh-fbtn').forEach(function(b){b.addEventListener('click',function(){
    pane.querySelectorAll('.rh-fbtn').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');_conFilter=b.dataset.f;filterConsole()})});
  $('#rh-con-search').addEventListener('input',function(){_conSearch=this.value.toLowerCase();filterConsole()});
  $('#rh-con-preserve').addEventListener('change',function(){_conPreserve=this.checked});
}

function filterConsole(){
  if(!_conScroll)return;
  var rows=_conScroll.querySelectorAll('.c-row,.c-group-hdr');
  rows.forEach(function(r){
    var lvl=r.dataset.lvl||'log';
    var text=(r.textContent||'').toLowerCase();
    var showLevel=_conFilter==='all'||lvl===_conFilter;
    var showSearch=!_conSearch||text.includes(_conSearch);
    r.style.display=(showLevel&&showSearch)?'':'none';
  });
}

function renderValue(v,depth){
  if(depth===undefined)depth=0;
  if(v===undefined)return'<span class="c-null">undefined</span>';
  if(v===null)return'<span class="c-null">null</span>';
  if(typeof v==='string')return depth>0?'<span class="c-str">"'+esc(v.slice(0,500))+(v.length>500?'…':'')+'"</span>':esc(v);
  if(typeof v==='number')return'<span class="c-num">'+v+'</span>';
  if(typeof v==='boolean')return'<span class="c-bool">'+v+'</span>';
  if(typeof v==='symbol')return'<span class="c-sym">'+esc(v.toString())+'</span>';
  if(typeof v==='function')return'<span class="c-fn">ƒ '+esc(v.name||'anonymous')+'()</span>';
  if(v instanceof Error)return'<span class="c-str">'+esc((v.stack||v.message||String(v)).slice(0,1500))+'</span>';
  if(typeof v==='object'){
    if(depth>3)return esc(serVal(v,depth));
    var preview=serVal(v,1);
    var span=document.createElement('span');span.className='c-obj';span.textContent=preview;
    span.addEventListener('click',function(e){
      e.stopPropagation();
      var next=this.nextElementSibling;
      if(next&&next.classList.contains('c-tree')){next.remove();return}
      var tree=document.createElement('div');tree.className='c-tree';
      try{
        var keys=Object.getOwnPropertyNames(v).slice(0,100);
        keys.forEach(function(k){
          var row=document.createElement('div');row.className='c-tree-row';
          try{row.innerHTML='<span class="c-key">'+esc(k)+'</span>: '+renderValueStr(v[k],depth+1)}catch(e){row.innerHTML='<span class="c-key">'+esc(k)+'</span>: <span class="c-str">[error]</span>'}
          tree.appendChild(row);
        });
        if(Object.getOwnPropertyNames(v).length>100){var more=el('div','c-tree-row','<span class="c-null">…'+(Object.getOwnPropertyNames(v).length-100)+' more</span>');tree.appendChild(more)}
        var proto=Object.getPrototypeOf(v);
        if(proto&&proto!==Object.prototype){var prow=el('div','c-tree-row','<span class="c-key">[[Prototype]]</span>: <span class="c-fn">'+esc(proto.constructor?proto.constructor.name:'Object')+'</span>');tree.appendChild(prow)}
      }catch(e){tree.innerHTML='<span class="c-str">['+esc(e.message)+']</span>'}
      this.after(tree);
    });
    return span.outerHTML;
  }
  return esc(String(v).slice(0,500));
}

function renderValueStr(v,depth){
  if(v===undefined)return'<span class="c-null">undefined</span>';
  if(v===null)return'<span class="c-null">null</span>';
  if(typeof v==='string')return'<span class="c-str">"'+esc(v.slice(0,200))+(v.length>200?'…':'')+'"</span>';
  if(typeof v==='number')return'<span class="c-num">'+v+'</span>';
  if(typeof v==='boolean')return'<span class="c-bool">'+v+'</span>';
  if(typeof v==='symbol')return'<span class="c-sym">'+esc(v.toString())+'</span>';
  if(typeof v==='function')return'<span class="c-fn">ƒ '+esc(v.name||'anonymous')+'</span>';
  if(v instanceof Error)return'<span class="c-str">'+esc(v.message||String(v))+'</span>';
  if(typeof v==='object')return'<span class="c-obj">'+esc(serVal(v,depth||1))+'</span>';
  return esc(String(v));
}

function addConsoleEntry(entry){
  if(!_conScroll)return;
  if(entry.l==='clear'){_conScroll.innerHTML='';_conGroupStack.length=0;return}
  if(entry.l==='groupEnd'){_conGroupStack.pop();return}

  var container=_conGroupStack.length>0?_conGroupStack[_conGroupStack.length-1]:_conScroll;

  if(entry.l==='group'){
    var hdr=el('div','c-group-hdr c-row log');hdr.dataset.lvl='log';
    hdr.innerHTML='<span class="ts">'+ts()+'</span>'+(entry.raw||[]).map(function(a){return renderValue(a,0)}).join(' ');
    var grp=el('div','c-group');
    hdr.addEventListener('click',function(){hdr.classList.toggle('collapsed');grp.classList.toggle('collapsed')});
    container.appendChild(hdr);container.appendChild(grp);
    _conGroupStack.push(grp);
    hdr.scrollIntoView({block:'end',behavior:'auto'});return;
  }

  if(entry.l==='table'&&entry.raw&&entry.raw[0]&&typeof entry.raw[0]==='object'){
    var d=el('div','c-row log');d.dataset.lvl='log';
    var data=entry.raw[0],cols=entry.raw[1];
    var table=document.createElement('table');table.className='c-table';
    var allKeys=cols||Object.keys(Array.isArray(data)?data[0]||{}:data);
    var thead=document.createElement('tr');
    thead.innerHTML='<th>(index)</th>'+allKeys.map(function(k){return'<th>'+esc(k)+'</th>'}).join('');
    table.appendChild(thead);
    var items=Array.isArray(data)?data:Object.keys(data).map(function(k){return data[k]});
    items.slice(0,100).forEach(function(row,i){
      var tr=document.createElement('tr');
      tr.innerHTML='<td>'+i+'</td>'+allKeys.map(function(k){return'<td>'+esc(serVal(row[k],1))+'</td>'}).join('');
      table.appendChild(tr);
    });
    d.appendChild(table);container.appendChild(d);
    d.scrollIntoView({block:'end',behavior:'auto'});return;
  }

  var row=el('div','c-row '+(entry.l||'log'));
  row.dataset.lvl=entry.l||'log';
  var parts=['<span class="ts">'+ts()+'</span>'];
  if(entry.raw){entry.raw.forEach(function(a){parts.push(renderValue(a,0))})}
  row.innerHTML=parts.join(' ');

  // Re-attach click listeners for c-obj spans
  row.querySelectorAll('.c-obj').forEach(function(span,idx){
    if(entry.raw&&entry.raw[idx]&&typeof entry.raw[idx]==='object'){
      var val=entry.raw[idx];
      span.addEventListener('click',function(e){
        e.stopPropagation();
        var next=this.nextElementSibling;
        if(next&&next.classList.contains('c-tree')){next.remove();return}
        var tree=document.createElement('div');tree.className='c-tree';
        try{
          Object.getOwnPropertyNames(val).slice(0,100).forEach(function(k){
            var r=el('div','c-tree-row');
            try{r.innerHTML='<span class="c-key">'+esc(k)+'</span>: '+renderValueStr(val[k],1)}catch(e2){r.textContent=k+': [error]'}
            tree.appendChild(r);
          });
        }catch(e2){tree.textContent='[Cannot inspect]'}
        this.after(tree);
      });
    }
  });

  container.appendChild(row);
  if(_conScroll.children.length>1000)_conScroll.removeChild(_conScroll.firstChild);
  row.scrollIntoView({block:'end',behavior:'auto'});
}

// ===== NETWORK TAB =====
var _netScroll,_netEntries=[],_netFilter='all',_netSearch='',_netIdx=0,_netStartTime=0;
function initNetwork(){
  var pane=$('#rh-network');
  pane.innerHTML='<div class="rh-toolbar"><button class="rh-fbtn on" data-f="all">All</button><button class="rh-fbtn" data-f="fetch">Fetch/XHR</button><button class="rh-fbtn" data-f="js">JS</button><button class="rh-fbtn" data-f="css">CSS</button><button class="rh-fbtn" data-f="img">Img</button><button class="rh-fbtn" data-f="font">Font</button><button class="rh-fbtn" data-f="media">Media</button><div class="rh-sep"></div><input class="rh-search" placeholder="Filter URL…" id="rh-net-search"><div class="rh-sep"></div><label class="rh-label"><input type="checkbox" class="rh-chk" id="rh-net-preserve">Preserve</label></div><div class="n-header"><span class="method" style="width:40px">Method</span><span class="status" style="width:32px">Status</span><span class="url">URL</span><span style="width:50px;text-align:center">Type</span><span style="width:55px;text-align:right">Size</span><span style="width:55px;text-align:right">Time</span><span style="width:80px">Waterfall</span></div><div class="rh-scroll" id="rh-net-scroll"></div><div class="n-summary" id="rh-net-summary"></div>';
  _netScroll=$('#rh-net-scroll');
  pane.querySelectorAll('.rh-fbtn').forEach(function(b){b.addEventListener('click',function(){
    pane.querySelectorAll('.rh-fbtn').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');_netFilter=b.dataset.f;filterNetwork()})});
  $('#rh-net-search').addEventListener('input',function(){_netSearch=this.value.toLowerCase();filterNetwork()});
}

function getNetType(entry){
  var ct=(entry.ct||'').toLowerCase();var u=(entry.u||'').toLowerCase();
  if(entry.tp==='fetch'||entry.tp==='xhr')return'fetch';
  if(ct.includes('javascript')||u.endsWith('.js'))return'js';
  if(ct.includes('css')||u.endsWith('.css'))return'css';
  if(ct.includes('image')||/\.(png|jpg|jpeg|gif|webp|svg|ico)/.test(u))return'img';
  if(ct.includes('font')||/\.(woff|woff2|ttf|otf|eot)/.test(u))return'font';
  if(ct.includes('video')||ct.includes('audio')||/\.(mp4|webm|ogg|mp3|wav)/.test(u))return'media';
  if(ct.includes('html'))return'doc';
  if(ct.includes('json'))return'fetch';
  return'other';
}

function filterNetwork(){
  if(!_netScroll)return;
  var rows=_netScroll.querySelectorAll('.n-row,.n-detail');
  rows.forEach(function(r){
    if(r.classList.contains('n-detail')){return}
    var type=r.dataset.type||'other';var url=(r.dataset.url||'').toLowerCase();
    var showType=_netFilter==='all'||type===_netFilter;
    var showSearch=!_netSearch||url.includes(_netSearch);
    r.style.display=(showType&&showSearch)?'':'none';
  });
}

function addNetEntry(entry){
  if(!_netScroll)return;
  entry.__idx=_netIdx++;
  if(!_netStartTime||entry.t0<_netStartTime)_netStartTime=entry.t0;
  _netEntries.push(entry);
  var type=getNetType(entry);
  var row=el('div','n-row');row.id='rh-nr-'+entry.__idx;row.dataset.type=type;row.dataset.url=entry.u||'';
  row.innerHTML='<span class="method">'+esc(entry.m)+'</span><span class="status">…</span><span class="url" title="'+esc(entry.u)+'">'+esc(entry.u)+'</span><span class="type">'+esc(type)+'</span><span class="size"></span><span class="time"></span><span class="wf"><span class="wf-bar"></span></span>';
  var detail=el('div','n-detail');detail.id='rh-nd-'+entry.__idx;
  row.addEventListener('click',function(){
    var d=$('#rh-nd-'+entry.__idx);
    if(!d)return;
    if(d.style.display==='block'){d.style.display='none';row.classList.remove('expanded');return}
    d.style.display='block';row.classList.add('expanded');
    renderNetDetail(entry,d);
  });
  _netScroll.appendChild(row);_netScroll.appendChild(detail);
  row.scrollIntoView({block:'end',behavior:'auto'});
  updateNetSummary();
}

function updateNetEntry(entry){
  if(!_netScroll||entry.__idx===undefined)return;
  var row=$('#rh-nr-'+entry.__idx);if(!row)return;
  var sc=entry.s>=500?'s5':entry.s>=400?'s4':entry.s>=300?'s3':entry.s>=200?'s2':entry.s<0?'sfail':'';
  var ms=entry.t1&&entry.t0?entry.t1-entry.t0:0;
  row.querySelector('.status').className='status '+sc;
  row.querySelector('.status').textContent=entry.s<0?'ERR':(entry.s||'');
  row.querySelector('.time').textContent=ms?formatMs(ms):'';
  row.querySelector('.size').textContent=entry.sz?formatBytes(entry.sz):'';
  row.dataset.type=getNetType(entry);
  row.querySelector('.type').textContent=getNetType(entry);
  var maxTime=0;_netEntries.forEach(function(e){if(e.t1&&e.t0){var d=e.t1-_netStartTime;if(d>maxTime)maxTime=d}});
  if(maxTime>0){
    var bar=row.querySelector('.wf-bar');
    var left=((entry.t0-_netStartTime)/maxTime*100);
    var width=(ms/maxTime*100);
    bar.style.left=Math.max(0,left)+'%';bar.style.width=Math.max(1,width)+'%';
  }
  updateNetSummary();
}

function renderNetDetail(entry,container){
  container.innerHTML='';
  var tabs=el('div','n-dtabs');
  ['Headers','Preview','Response'].forEach(function(name,i){
    var t=el('div','n-dtab'+(i===0?' on':''),name);
    t.addEventListener('click',function(){
      container.querySelectorAll('.n-dtab').forEach(function(x){x.classList.remove('on')});
      container.querySelectorAll('.n-dpane').forEach(function(x){x.classList.remove('show')});
      t.classList.add('on');container.querySelectorAll('.n-dpane')[i].classList.add('show');
    });
    tabs.appendChild(t);
  });
  container.appendChild(tabs);

  // Headers pane
  var hp=el('div','n-dpane show');
  var hhtml='<div style="margin-bottom:8px"><strong style="color:#969696">Request Headers</strong></div>';
  if(entry.reqH){Object.keys(entry.reqH).forEach(function(k){hhtml+='<div class="n-hdr"><span class="hk">'+esc(k)+':</span><span class="hv">'+esc(entry.reqH[k])+'</span></div>'})}
  if(!entry.reqH||!Object.keys(entry.reqH).length)hhtml+='<div style="color:#555">(no request headers captured)</div>';
  hhtml+='<div style="margin:8px 0"><strong style="color:#969696">Response Headers</strong></div>';
  if(entry.resH){Object.keys(entry.resH).forEach(function(k){hhtml+='<div class="n-hdr"><span class="hk">'+esc(k)+':</span><span class="hv">'+esc(entry.resH[k])+'</span></div>'})}
  if(!entry.resH||!Object.keys(entry.resH).length)hhtml+='<div style="color:#555">(no response headers captured)</div>';
  hp.innerHTML=hhtml;container.appendChild(hp);

  // Preview pane
  var pp=el('div','n-dpane');
  pp.innerHTML='<div style="color:#555">Click to load preview…</div>';
  pp.style.cursor='pointer';
  pp.addEventListener('click',function(){
    if(pp.dataset.loaded)return;pp.dataset.loaded='1';pp.style.cursor='default';
    pp.innerHTML='<div style="color:#969696">Loading…</div>';
    _rhFetchSource(entry.u).then(function(text){
      var ct=(entry.ct||'').toLowerCase();
      if(ct.includes('json')){try{pp.innerHTML='<pre style="white-space:pre-wrap;word-break:break-all;color:#d4d4d4">'+esc(JSON.stringify(JSON.parse(text),null,2))+'</pre>'}catch(e){pp.innerHTML='<pre style="white-space:pre-wrap;color:#d4d4d4">'+esc(text.slice(0,5000))+'</pre>'}}
      else if(ct.includes('image')){pp.innerHTML='<img src="'+esc(entry.u)+'" style="max-width:100%;max-height:200px">'}
      else{pp.innerHTML='<pre style="white-space:pre-wrap;word-break:break-all;color:#d4d4d4">'+esc(text.slice(0,5000))+'</pre>'}
    }).catch(function(e){pp.innerHTML='<div style="color:#f44">Failed to load: '+esc(e.message)+'</div>'});
  },false);
  container.appendChild(pp);

  // Response pane
  var rp=el('div','n-dpane');
  rp.innerHTML='<div style="color:#555">Click to load response…</div>';
  rp.style.cursor='pointer';
  rp.addEventListener('click',function(){
    if(rp.dataset.loaded)return;rp.dataset.loaded='1';rp.style.cursor='default';
    rp.innerHTML='<div style="color:#969696">Loading…</div>';
    _rhFetchSource(entry.u).then(function(text){
      rp.innerHTML='<pre style="white-space:pre-wrap;word-break:break-all;color:#d4d4d4;max-height:200px;overflow:auto">'+esc(text.slice(0,10000))+(text.length>10000?'\n…truncated':'')+'</pre>';
    }).catch(function(e){rp.innerHTML='<div style="color:#f44">Failed: '+esc(e.message)+'</div>'});
  },false);
  container.appendChild(rp);
}

function updateNetSummary(){
  var el=$('#rh-net-summary');if(!el)return;
  var count=_netEntries.length,sz=0,maxTime=0;
  _netEntries.forEach(function(e){sz+=e.sz||0;if(e.t1&&e.t0){var d=e.t1-_netStartTime;if(d>maxTime)maxTime=d}});
  el.innerHTML='<span>'+count+' requests</span><span>'+formatBytes(sz)+' transferred</span><span>Finish: '+formatMs(maxTime)+'</span>';
}

// ===== ELEMENTS TAB =====
var _elemSelected=null,_elemHighlight=null,_elemInspecting=false;
function initElements(){
  var pane=$('#rh-elements');
  pane.innerHTML='<div class="e-search"><input class="rh-search" placeholder="Search by selector…" id="rh-elem-search" style="flex:1"><button class="rh-fbtn" id="rh-elem-inspect" title="Select element">&#8982;</button></div><div class="e-bread" id="rh-elem-bread"></div><div class="e-wrap"><div class="e-tree-panel" id="rh-elem-tree"></div><div class="e-styles-panel" id="rh-elem-styles"></div></div>';

  var treePanel=$('#rh-elem-tree');
  var stylesPanel=$('#rh-elem-styles');

  onTabActivate('elements',function(){
    renderDomTree(document.documentElement,treePanel,0);
  });

  $('#rh-elem-search').addEventListener('keydown',function(e){
    if(e.key==='Enter'&&this.value.trim()){
      try{var found=document.querySelector(this.value);if(found)selectElement(found)}catch(e2){}
    }
  });

  $('#rh-elem-inspect').addEventListener('click',function(){
    _elemInspecting=!_elemInspecting;
    this.classList.toggle('on',_elemInspecting);
    if(_elemInspecting)startInspect();else stopInspect();
  });
}

function renderDomTree(root,container,depth){
  container.innerHTML='';
  renderNode(root,container,depth,true);
}

function renderNode(node,container,depth,expanded){
  if(!node)return;
  if(node.nodeType===3){
    var txt=node.textContent.trim();
    if(!txt)return;
    var tNode=el('div','e-node');
    tNode.style.paddingLeft=(depth*16+20)+'px';
    tNode.innerHTML='<span class="e-text">"'+esc(txt.slice(0,80))+(txt.length>80?'…':'')+'"</span>';
    container.appendChild(tNode);return;
  }
  if(node.nodeType===8){
    var cNode=el('div','e-node');
    cNode.style.paddingLeft=(depth*16+20)+'px';
    cNode.innerHTML='<span class="e-comment">&lt;!-- '+esc(node.textContent.slice(0,60))+' --&gt;</span>';
    container.appendChild(cNode);return;
  }
  if(node.nodeType!==1)return;
  if(node.id==='__rh_devpanel_host')return;

  var tag=node.tagName.toLowerCase();
  var hasChildren=node.childNodes.length>0;
  var isVoid=/^(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)$/.test(tag);

  var row=el('div','e-node');
  row.style.paddingLeft=(depth*16)+'px';
  row.__domNode=node;

  var arrow=hasChildren&&!isVoid?'<span class="e-arrow">'+(expanded?'▼':'▶')+'</span>':'<span style="display:inline-block;width:12px"></span>';
  var attrs='';
  for(var i=0;i<Math.min(node.attributes.length,5);i++){
    var a=node.attributes[i];
    attrs+=' <span class="e-attr">'+esc(a.name)+'</span>=<span class="e-aval">"'+esc(a.value.slice(0,60))+(a.value.length>60?'…':'')+'"</span>';
  }
  if(node.attributes.length>5)attrs+=' <span class="e-attr">…</span>';
  row.innerHTML=arrow+'<span class="e-tag">&lt;'+esc(tag)+'</span>'+attrs+'<span class="e-tag">&gt;</span>';

  if(hasChildren&&!isVoid){
    var childContainer=el('div','');childContainer.style.display=expanded?'block':'none';
    row.querySelector('.e-arrow').addEventListener('click',function(e){
      e.stopPropagation();
      var exp=childContainer.style.display!=='none';
      childContainer.style.display=exp?'none':'block';
      this.textContent=exp?'▶':'▼';
      if(!exp&&!childContainer.dataset.loaded){
        childContainer.dataset.loaded='1';
        for(var c=node.firstChild;c;c=c.nextSibling)renderNode(c,childContainer,depth+1,false);
        var closeTag=el('div','e-node');
        closeTag.style.paddingLeft=(depth*16+12)+'px';
        closeTag.innerHTML='<span class="e-tag">&lt;/'+esc(tag)+'&gt;</span>';
        childContainer.appendChild(closeTag);
      }
    });
    if(expanded){
      childContainer.dataset.loaded='1';
      for(var c=node.firstChild;c;c=c.nextSibling)renderNode(c,childContainer,depth+1,depth<1);
      var closeTag=el('div','e-node');
      closeTag.style.paddingLeft=(depth*16+12)+'px';
      closeTag.innerHTML='<span class="e-tag">&lt;/'+esc(tag)+'&gt;</span>';
      childContainer.appendChild(closeTag);
    }
  }

  row.addEventListener('click',function(e){
    if(e.target.classList.contains('e-arrow'))return;
    selectElement(node);
  });
  row.addEventListener('dblclick',function(){
    var attrSpan=row.querySelector('.e-attr');
    if(!attrSpan)return;
    var inp=document.createElement('input');inp.value=node.outerHTML.match(/^<[^>]+>/)[0];
    inp.style.cssText='width:100%;background:#333;color:#d4d4d4;border:1px solid #007acc;font:11px Consolas,monospace;padding:2px';
    row.innerHTML='';row.appendChild(inp);inp.focus();
    inp.addEventListener('keydown',function(ev){
      if(ev.key==='Enter'){try{var tmp=document.createElement('div');tmp.innerHTML=inp.value;if(tmp.firstElementChild){for(var i=0;i<tmp.firstElementChild.attributes.length;i++){var a=tmp.firstElementChild.attributes[i];node.setAttribute(a.name,a.value)}}}catch(e2){}renderDomTree(document.documentElement,$('#rh-elem-tree'),0);selectElement(node)}
      if(ev.key==='Escape'){renderDomTree(document.documentElement,$('#rh-elem-tree'),0);selectElement(node)}
    });
  });

  container.appendChild(row);
  if(hasChildren&&!isVoid)container.appendChild(childContainer);
}

function selectElement(node){
  _elemSelected=node;
  $$('.e-node').forEach(function(n){n.classList.remove('selected')});
  $$('.e-node').forEach(function(n){if(n.__domNode===node)n.classList.add('selected')});
  updateBreadcrumbs(node);
  updateStylesPanel(node);
  highlightElement(node);
}

function updateBreadcrumbs(node){
  var bread=$('#rh-elem-bread');if(!bread)return;
  var chain=[];var n=node;
  while(n&&n.nodeType===1){chain.unshift(n);n=n.parentElement}
  bread.innerHTML=chain.map(function(el){
    var tag=el.tagName.toLowerCase();
    var id=el.id?'#'+el.id:'';
    var cls=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'';
    return'<span>'+esc(tag+id+cls)+'</span>';
  }).join(' &gt; ');
  bread.querySelectorAll('span').forEach(function(sp,i){
    sp.addEventListener('click',function(){selectElement(chain[i])});
  });
}

function updateStylesPanel(node){
  var panel=$('#rh-elem-styles');if(!panel)return;
  var html='<div class="e-sect">Box Model</div>';
  try{
    var cs=window.getComputedStyle(node);
    var m=cs.margin,b=cs.borderWidth,p=cs.padding;
    var w=node.offsetWidth,h=node.offsetHeight;
    html+='<div class="e-box"><div class="e-box-margin">margin: '+esc(m)+'<div class="e-box-border">border: '+esc(b)+'<div class="e-box-padding">padding: '+esc(p)+'<div class="e-box-content">'+w+' x '+h+'</div></div></div></div></div>';
    html+='<div class="e-sect">Computed Styles</div>';
    var props=['display','position','width','height','margin','padding','border','color','background','font-size','font-family','line-height','text-align','overflow','z-index','opacity','transform','flex','grid-template-columns','box-sizing'];
    props.forEach(function(p){
      var v=cs.getPropertyValue(p);
      if(v&&v!=='none'&&v!=='normal'&&v!=='auto'&&v!=='0px'&&v!=='rgba(0, 0, 0, 0)')
        html+='<div class="e-style-row"><span class="e-sprop">'+esc(p)+':</span><span class="e-sval">'+esc(v)+'</span></div>';
    });
  }catch(e){html+='<div style="color:#555;padding:8px">Cannot compute styles</div>'}
  panel.innerHTML=html;
}

function highlightElement(node){
  if(!_elemHighlight){_elemHighlight=document.createElement('div');_elemHighlight.className='e-highlight';document.documentElement.appendChild(_elemHighlight)}
  try{
    var r=node.getBoundingClientRect();
    _elemHighlight.style.cssText='position:fixed;pointer-events:none;z-index:2147483645;background:rgba(0,122,204,.2);border:1px solid rgba(0,122,204,.6);left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;display:block';
    setTimeout(function(){if(_elemHighlight)_elemHighlight.style.display='none'},2000);
  }catch(e){}
}

function startInspect(){
  document.addEventListener('mouseover',_inspectOver,true);
  document.addEventListener('click',_inspectClick,true);
}
function stopInspect(){
  document.removeEventListener('mouseover',_inspectOver,true);
  document.removeEventListener('click',_inspectClick,true);
  if(_elemHighlight)_elemHighlight.style.display='none';
}
function _inspectOver(e){
  if(e.target.id==='__rh_devpanel_host'||e.target.closest&&e.target.closest('#__rh_devpanel_host'))return;
  highlightElement(e.target);
}
function _inspectClick(e){
  if(e.target.id==='__rh_devpanel_host'||e.target.closest&&e.target.closest('#__rh_devpanel_host'))return;
  e.preventDefault();e.stopPropagation();
  selectElement(e.target);
  _elemInspecting=false;
  stopInspect();
  try{$('#rh-elem-inspect').classList.remove('on')}catch(e2){}
}

// ===== SOURCES TAB =====
var _srcCurrentUrl=null;
function initSources(){
  var pane=$('#rh-sources');
  pane.innerHTML='<div class="s-wrap"><div class="s-tree" id="rh-src-tree"></div><div class="s-viewer" id="rh-src-viewer"><div class="s-empty">Select a file to view source</div></div></div><div class="s-snip"><span class="rh-label">Snippets:</span><button class="s-sbtn" id="rh-snip-new">+ New</button><button class="s-sbtn" id="rh-snip-run">&#9654; Run</button><select id="rh-snip-sel" style="background:#3c3c3c;color:#d4d4d4;border:1px solid #555;font:10px inherit;padding:1px 4px;border-radius:3px"></select></div>';

  onTabActivate('sources',function(){refreshSourceTree()});

  $('#rh-snip-new').addEventListener('click',function(){
    var name=prompt('Snippet name:');if(!name)return;
    var code=prompt('JavaScript code:');if(code===null)return;
    var snips=getSnippets();snips[name]=code;saveSnippets(snips);refreshSnippetSelect();
  });
  $('#rh-snip-run').addEventListener('click',function(){
    var sel=$('#rh-snip-sel');var name=sel.value;if(!name)return;
    var snips=getSnippets();var code=snips[name];if(!code)return;
    addConsoleEntry({l:'log',raw:['[Snippet: '+name+'] > '+code],t:Date.now(),d:0});
    try{var r=eval.call(window,code);addConsoleEntry({l:'log',raw:[r],t:Date.now(),d:0})}catch(e){addConsoleEntry({l:'error',raw:[e],t:Date.now(),d:0})}
  });
  refreshSnippetSelect();
}

function getSnippets(){try{return JSON.parse(localStorage.getItem('__rh_snippets')||'{}')}catch(e){return{}}}
function saveSnippets(s){try{localStorage.setItem('__rh_snippets',JSON.stringify(s))}catch(e){}}
function refreshSnippetSelect(){
  var sel=$('#rh-snip-sel');if(!sel)return;
  var snips=getSnippets();sel.innerHTML='<option value="">--</option>'+Object.keys(snips).map(function(k){return'<option value="'+esc(k)+'">'+esc(k)+'</option>'}).join('');
}

function refreshSourceTree(){
  var tree=$('#rh-src-tree');if(!tree)return;
  tree.innerHTML='';
  var groups={js:[],css:[],img:[],font:[],media:[],other:[]};
  SRC.forEach(function(s){(groups[s.tp]||groups.other).push(s)});
  Object.keys(groups).forEach(function(tp){
    if(!groups[tp].length)return;
    var hdr=el('div','s-tree-hdr',tp.toUpperCase()+' ('+groups[tp].length+')');
    tree.appendChild(hdr);
    groups[tp].forEach(function(s){
      var f=el('div','s-file');f.textContent=s.u.split('/').pop()||s.u;f.title=s.u;
      f.addEventListener('click',function(){
        tree.querySelectorAll('.s-file').forEach(function(x){x.classList.remove('on')});
        f.classList.add('on');loadSource(s.u,s.tp);
      });
      tree.appendChild(f);
    });
  });
  if(!SRC.length)tree.innerHTML='<div class="s-empty">No sources detected</div>';
}

function loadSource(url,type){
  _srcCurrentUrl=url;
  var viewer=$('#rh-src-viewer');if(!viewer)return;
  viewer.innerHTML='<div style="padding:8px;color:#969696">Loading '+esc(url.split('/').pop())+'…</div>';
  _rhFetchSource(url).then(function(text){
    if(_srcCurrentUrl!==url)return;
    var lines=text.split('\n');
    var code=el('div','s-code');
    lines.slice(0,5000).forEach(function(line,i){
      var row=el('div','s-line');
      row.innerHTML='<span class="s-ln">'+(i+1)+'</span><span class="s-lc">'+highlightLine(line,type)+'</span>';
      code.appendChild(row);
    });
    if(lines.length>5000){var more=el('div','s-line');more.innerHTML='<span class="s-ln"></span><span class="s-lc" style="color:#555">…'+(lines.length-5000)+' more lines</span>';code.appendChild(more)}
    viewer.innerHTML='';viewer.appendChild(code);
  }).catch(function(e){viewer.innerHTML='<div style="padding:8px;color:#f44">Failed to load: '+esc(e.message)+'</div>'});
}

function highlightLine(line,type){
  line=esc(line);
  if(type==='css'){
    line=line.replace(/\/\*[\s\S]*?\*\//g,'<span class="s-cm">$&</span>');
    line=line.replace(/([\w-]+)\s*:/g,'<span class="s-kw">$1</span>:');
    line=line.replace(/"([^"]*)"|'([^']*)'/g,'<span class="s-st">$&</span>');
  }else{
    line=line.replace(/(\/\/.*)/g,'<span class="s-cm">$1</span>');
    line=line.replace(/\b(function|var|let|const|if|else|for|while|return|import|export|from|class|new|this|try|catch|throw|async|await|typeof|instanceof|switch|case|break|continue|default|do|in|of|yield|delete|void|with|debugger)\b/g,'<span class="s-kw">$1</span>');
    line=line.replace(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g,'<span class="s-st">$&</span>');
    line=line.replace(/\/[^/\n]+\/[gimsuy]*/g,'<span class="s-rx">$&</span>');
  }
  return line;
}

// ===== PERFORMANCE TAB =====
var _perfFpsRunning=false,_perfFps=0;
function initPerformance(){
  var pane=$('#rh-performance');
  pane.innerHTML='<div class="rh-toolbar"><button class="rh-fbtn on" id="rh-perf-refresh">Refresh Metrics</button><button class="rh-fbtn" id="rh-perf-fps-toggle">Start FPS Monitor</button></div><div class="p-scroll" id="rh-perf-scroll"></div>';
  $('#rh-perf-refresh').addEventListener('click',refreshPerformance);
  $('#rh-perf-fps-toggle').addEventListener('click',function(){
    _perfFpsRunning=!_perfFpsRunning;
    this.textContent=_perfFpsRunning?'Stop FPS Monitor':'Start FPS Monitor';
    this.classList.toggle('on',!_perfFpsRunning);
    if(_perfFpsRunning)startFpsMonitor();
  });
  onTabActivate('performance',refreshPerformance);
}

function refreshPerformance(){
  var scroll=$('#rh-perf-scroll');if(!scroll)return;
  var html='';
  var perf=window.__rhPerf||{};
  var nav=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];
  var paint=performance.getEntriesByType&&performance.getEntriesByType('paint')||[];

  // Web Vitals cards
  html+='<div class="p-cards">';
  var fcp=0;paint.forEach(function(p){if(p.name==='first-contentful-paint')fcp=p.startTime});
  if(!fcp&&perf.fcp)fcp=perf.fcp;
  html+=metricCard('FCP',fcp,1800,3000);
  html+=metricCard('LCP',perf.lcp||0,2500,4000);
  html+=metricCard('CLS',(perf.cls||0).toFixed(3),0.1,0.25,true);
  html+=metricCard('FID',perf.fid||0,100,300);
  if(nav){
    var ttfb=nav.responseStart-nav.requestStart;
    html+=metricCard('TTFB',Math.round(ttfb),200,600);
    html+=metricCard('DOM Load',Math.round(nav.domContentLoadedEventEnd-nav.fetchStart),1500,3000);
    html+=metricCard('Full Load',Math.round(nav.loadEventEnd-nav.fetchStart),3000,6000);
  }
  html+=metricCard('FPS',_perfFps||'—',0,0,false,true);
  html+='</div>';

  // Navigation Timing
  if(nav){
    html+='<div class="p-sect">Navigation Timing</div><div class="p-timing">';
    var total=nav.loadEventEnd-nav.fetchStart||1;
    var timings=[
      {label:'DNS',start:nav.domainLookupStart-nav.fetchStart,end:nav.domainLookupEnd-nav.fetchStart,color:'#4ec9b0'},
      {label:'TCP',start:nav.connectStart-nav.fetchStart,end:nav.connectEnd-nav.fetchStart,color:'#dcdcaa'},
      {label:'TLS',start:nav.secureConnectionStart?nav.secureConnectionStart-nav.fetchStart:0,end:nav.secureConnectionStart?nav.connectEnd-nav.fetchStart:0,color:'#c586c0'},
      {label:'Request',start:nav.requestStart-nav.fetchStart,end:nav.responseStart-nav.fetchStart,color:'#569cd6'},
      {label:'Response',start:nav.responseStart-nav.fetchStart,end:nav.responseEnd-nav.fetchStart,color:'#9cdcfe'},
      {label:'DOM',start:nav.domInteractive-nav.fetchStart,end:nav.domContentLoadedEventEnd-nav.fetchStart,color:'#ce9178'},
      {label:'Load',start:nav.loadEventStart-nav.fetchStart,end:nav.loadEventEnd-nav.fetchStart,color:'#f44747'}
    ];
    timings.forEach(function(t){
      if(t.end<=0)return;
      var left=(t.start/total*100);var width=((t.end-t.start)/total*100);
      html+='<div class="p-row"><span class="p-row-label">'+t.label+'</span><div class="p-row-bar" style="background:'+t.color+';width:'+Math.max(1,width)+'%;margin-left:'+left+'%"></div><span class="p-row-val">'+Math.round(t.end-t.start)+' ms</span></div>';
    });
    html+='</div>';
  }

  // Resource Timing
  var resources=performance.getEntriesByType&&performance.getEntriesByType('resource')||[];
  if(resources.length){
    html+='<div class="p-sect">Resources ('+resources.length+')</div><div class="p-timing">';
    var maxEnd=0;resources.forEach(function(r){if(r.responseEnd>maxEnd)maxEnd=r.responseEnd});
    resources.slice(0,50).forEach(function(r){
      var name=r.name.split('/').pop()||r.name;if(name.length>40)name=name.slice(0,37)+'…';
      var dur=r.responseEnd-r.startTime;
      var left=(r.startTime/maxEnd*100);var width=(dur/maxEnd*100);
      html+='<div class="p-row"><span class="p-row-label" title="'+esc(r.name)+'">'+esc(name)+'</span><div class="p-row-bar" style="background:#007acc;width:'+Math.max(1,width)+'%;margin-left:'+left+'%"></div><span class="p-row-val">'+Math.round(dur)+' ms</span></div>';
    });
    if(resources.length>50)html+='<div style="color:#555;padding:4px">…'+(resources.length-50)+' more</div>';
    html+='</div>';
  }

  // Long Tasks
  html+='<div class="p-sect">Long Tasks</div><div class="p-timing" id="rh-perf-longtasks"><div style="color:#555">Monitoring…</div></div>';

  scroll.innerHTML=html;

  try{new PerformanceObserver(function(l){
    var container=$('#rh-perf-longtasks');if(!container)return;
    l.getEntries().forEach(function(e){
      if(container.querySelector('[data-st="'+e.startTime+'"]'))return;
      var row=el('div','p-row');row.dataset.st=e.startTime;
      row.innerHTML='<span class="p-row-label">Long Task</span><span class="p-row-val" style="color:#f44">'+Math.round(e.duration)+' ms at '+Math.round(e.startTime)+' ms</span>';
      if(container.firstChild&&container.firstChild.style)container.firstChild.style.display='none';
      container.appendChild(row);
    });
  }).observe({type:'longtask',buffered:true})}catch(e){}
}

function metricCard(label,value,good,bad,isCls,isFps){
  var cls='good';
  if(!isFps){
    var num=parseFloat(value);
    if(isCls){cls=num<=good?'good':num<=bad?'ok':'bad'}
    else{cls=num<=good?'good':num<=bad?'ok':'bad'}
  }
  var display=typeof value==='number'?Math.round(value):value;
  if(isCls)display=value;
  return'<div class="p-card"><div class="p-card-label">'+label+'</div><div class="p-card-value '+cls+'">'+(display||'—')+(typeof value==='number'&&!isCls&&!isFps?' ms':'')+'</div></div>';
}

function startFpsMonitor(){
  var frames=0,last=performance.now();
  function tick(){
    frames++;
    var now=performance.now();
    if(now-last>=1000){_perfFps=Math.round(frames*1000/(now-last));frames=0;last=now;
      try{var el=$('.p-card-value.good,.p-card-value.ok,.p-card-value.bad',$$('.p-card')[$$('.p-card').length-1]);
        if(!el){var cards=$$('.p-card');if(cards.length){var last2=cards[cards.length-1];var v=last2.querySelector('.p-card-value');if(v)v.textContent=_perfFps}}}catch(e){}}
    if(_perfFpsRunning)requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ===== MEMORY TAB =====
var _memSnapshots=[],_memTimeline=[],_memIntervalId=null;
function initMemory(){
  var pane=$('#rh-memory');
  pane.innerHTML='<div class="rh-toolbar"><button class="rh-fbtn on" id="rh-mem-refresh">Refresh</button><button class="rh-fbtn" id="rh-mem-snap">Take Snapshot</button><button class="rh-fbtn" id="rh-mem-timeline-toggle">Start Timeline</button></div><div class="m-scroll" id="rh-mem-scroll"></div>';
  $('#rh-mem-refresh').addEventListener('click',refreshMemory);
  $('#rh-mem-snap').addEventListener('click',takeMemorySnapshot);
  $('#rh-mem-timeline-toggle').addEventListener('click',function(){
    if(_memIntervalId){clearInterval(_memIntervalId);_memIntervalId=null;this.textContent='Start Timeline';return}
    this.textContent='Stop Timeline';
    _memIntervalId=setInterval(function(){
      var sample=getMemorySample();_memTimeline.push(sample);
      if(_memTimeline.length>60)_memTimeline.shift();
      drawMemoryTimeline();
    },2000);
  });
  onTabActivate('memory',refreshMemory);
}

function getMemorySample(){
  var heap=0,heapTotal=0,heapLimit=0;
  if(performance.memory){heap=performance.memory.usedJSHeapSize;heapTotal=performance.memory.totalJSHeapSize;heapLimit=performance.memory.jsHeapSizeLimit}
  var domNodes=0;try{domNodes=document.querySelectorAll('*').length}catch(e){}
  return{t:Date.now(),heap:heap,heapTotal:heapTotal,heapLimit:heapLimit,dom:domNodes,listeners:window.__rhListeners||0,timers:window.__rhTimerCount||{timeout:0,interval:0}};
}

function refreshMemory(){
  var scroll=$('#rh-mem-scroll');if(!scroll)return;
  var s=getMemorySample();var html='';

  html+='<div class="m-stats">';
  if(s.heapLimit){
    var pct=Math.round(s.heap/s.heapLimit*100);
    html+='<div class="m-stat"><div class="m-stat-label">JS Heap</div><div class="m-stat-value">'+formatBytes(s.heap)+'</div><div style="font-size:10px;color:#969696">'+pct+'% of '+formatBytes(s.heapLimit)+'</div></div>';
    html+='<div class="m-stat"><div class="m-stat-label">Heap Allocated</div><div class="m-stat-value">'+formatBytes(s.heapTotal)+'</div></div>';
  }else{
    html+='<div class="m-stat"><div class="m-stat-label">JS Heap</div><div class="m-stat-value" style="font-size:11px;color:#969696">Not available</div><div style="font-size:10px;color:#555">Chrome only</div></div>';
  }
  html+='<div class="m-stat"><div class="m-stat-label">DOM Nodes</div><div class="m-stat-value">'+s.dom.toLocaleString()+'</div></div>';
  html+='<div class="m-stat"><div class="m-stat-label">Event Listeners</div><div class="m-stat-value">'+s.listeners.toLocaleString()+'</div></div>';
  html+='<div class="m-stat"><div class="m-stat-label">Timeouts Created</div><div class="m-stat-value">'+s.timers.timeout+'</div></div>';
  html+='<div class="m-stat"><div class="m-stat-label">Intervals Created</div><div class="m-stat-value">'+s.timers.interval+'</div></div>';
  html+='</div>';

  // Heap gauge
  if(s.heapLimit){
    var pct2=Math.min(100,Math.round(s.heap/s.heapLimit*100));
    var color=pct2<60?'#4ec9b0':pct2<80?'#dcdcaa':'#f44';
    html+='<div class="m-sect">Heap Usage</div>';
    html+='<div class="m-gauge"><div class="m-gauge-bar"><div class="m-gauge-fill" style="width:'+pct2+'%;background:'+color+'"></div><div class="m-gauge-text">'+formatBytes(s.heap)+' / '+formatBytes(s.heapLimit)+' ('+pct2+'%)</div></div></div>';
  }

  // Timeline
  html+='<div class="m-sect">Timeline</div><div class="m-timeline"><canvas id="rh-mem-canvas" width="600" height="60"></canvas></div>';

  // Snapshots
  if(_memSnapshots.length){
    html+='<div class="m-sect">Snapshots</div>';
    _memSnapshots.forEach(function(snap,i){
      html+='<div class="m-snap-row"><span class="label">Snap #'+(i+1)+'</span><span>Heap: '+formatBytes(snap.heap)+'</span><span>DOM: '+snap.dom+'</span><span>Listeners: '+snap.listeners+'</span></div>';
    });
    if(_memSnapshots.length>=2){
      var a=_memSnapshots[_memSnapshots.length-2],b=_memSnapshots[_memSnapshots.length-1];
      var dHeap=b.heap-a.heap,dDom=b.dom-a.dom,dList=b.listeners-a.listeners;
      html+='<div class="m-snap-row"><span class="label" style="color:#007acc">Delta</span><span style="color:'+(dHeap>0?'#f44':'#4ec9b0')+'">Heap: '+(dHeap>0?'+':'')+formatBytes(dHeap)+'</span><span style="color:'+(dDom>0?'#f44':'#4ec9b0')+'">DOM: '+(dDom>0?'+':'')+dDom+'</span><span style="color:'+(dList>0?'#dcdcaa':'#4ec9b0')+'">Listeners: '+(dList>0?'+':'')+dList+'</span></div>';
    }
  }

  scroll.innerHTML=html;
  drawMemoryTimeline();
}

function takeMemorySnapshot(){
  _memSnapshots.push(getMemorySample());
  refreshMemory();
}

function drawMemoryTimeline(){
  var canvas=$('#rh-mem-canvas');if(!canvas||!canvas.getContext)return;
  var ctx=canvas.getContext('2d');
  var w=canvas.width=canvas.offsetWidth||600;var h=canvas.height=60;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#252526';ctx.fillRect(0,0,w,h);
  if(_memTimeline.length<2)return;
  var maxHeap=0;_memTimeline.forEach(function(s){if(s.heap>maxHeap)maxHeap=s.heap});
  if(!maxHeap)return;
  ctx.strokeStyle='#007acc';ctx.lineWidth=1.5;ctx.beginPath();
  _memTimeline.forEach(function(s,i){
    var x=i/(Math.max(1,_memTimeline.length-1))*w;
    var y=h-(s.heap/maxHeap)*(h-4)-2;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  ctx.stroke();
  ctx.fillStyle='#007acc22';ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();
}

// ===== APPLICATION TAB =====
var _appCurrentView='localStorage';
function initApplication(){
  var pane=$('#rh-application');
  pane.innerHTML='<div class="a-wrap"><div class="a-sidebar" id="rh-app-sidebar"><div class="a-sect">Storage</div><div class="a-item on" data-v="localStorage">Local Storage</div><div class="a-item" data-v="sessionStorage">Session Storage</div><div class="a-item" data-v="cookies">Cookies</div><div class="a-sect">Database</div><div class="a-item" data-v="indexedDB">IndexedDB</div><div class="a-sect">Cache</div><div class="a-item" data-v="serviceWorkers">Service Workers</div><div class="a-item" data-v="cacheStorage">Cache Storage</div><div class="a-sect">Other</div><div class="a-item" data-v="manifest">Manifest</div></div><div class="a-main" id="rh-app-main"></div></div>';
  $$('.a-item',pane).forEach(function(item){item.addEventListener('click',function(){
    $$('.a-item',pane).forEach(function(x){x.classList.remove('on')});
    item.classList.add('on');_appCurrentView=item.dataset.v;refreshAppView();
  })});
  onTabActivate('application',refreshAppView);
}

function refreshAppView(){
  var main=$('#rh-app-main');if(!main)return;
  switch(_appCurrentView){
    case'localStorage':showStorageView(main,localStorage,'localStorage');break;
    case'sessionStorage':showStorageView(main,sessionStorage,'sessionStorage');break;
    case'cookies':showCookiesView(main);break;
    case'indexedDB':showIndexedDBView(main);break;
    case'serviceWorkers':showServiceWorkersView(main);break;
    case'cacheStorage':showCacheStorageView(main);break;
    case'manifest':showManifestView(main);break;
  }
}

function showStorageView(main,storage,name){
  var html='<div class="a-bar"><button class="a-abtn" id="rh-app-add">+ Add</button><button class="a-abtn" id="rh-app-clear">Clear All</button><button class="a-abtn" id="rh-app-refresh">Refresh</button></div>';
  html+='<div class="a-scroll"><table class="a-table"><tr><th style="width:200px">Key</th><th>Value</th><th style="width:50px"></th></tr>';
  try{
    for(var i=0;i<storage.length;i++){
      var k=storage.key(i);var v=storage.getItem(k);
      html+='<tr data-key="'+esc(k)+'"><td class="a-editable">'+esc(k)+'</td><td class="a-editable" title="'+esc(v)+'">'+esc((v||'').slice(0,200))+'</td><td><button class="a-abtn" data-del="'+esc(k)+'" style="padding:0 4px;font-size:10px">✕</button></td></tr>';
    }
  }catch(e){html+='<tr><td colspan="3" style="color:#f44">'+esc(e.message)+'</td></tr>'}
  if(!storage.length)html+='<tr><td colspan="3" class="a-empty">No entries</td></tr>';
  html+='</table></div>';
  main.innerHTML=html;

  main.querySelectorAll('[data-del]').forEach(function(btn){btn.addEventListener('click',function(){
    try{storage.removeItem(btn.dataset.del)}catch(e){}showStorageView(main,storage,name);
  })});
  main.querySelectorAll('.a-editable').forEach(function(td){td.addEventListener('dblclick',function(){
    var row=td.parentElement;var key=row.dataset.key;
    var isKey=td===row.children[0];var current=isKey?key:storage.getItem(key);
    var inp=document.createElement('input');inp.value=current||'';
    inp.style.cssText='width:100%;background:#333;color:#d4d4d4;border:1px solid #007acc;font:11px Consolas,monospace;padding:2px';
    td.textContent='';td.appendChild(inp);inp.focus();
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){try{if(isKey){var val=storage.getItem(key);storage.removeItem(key);storage.setItem(inp.value,val)}else{storage.setItem(key,inp.value)}}catch(e2){}showStorageView(main,storage,name)}
      if(e.key==='Escape')showStorageView(main,storage,name);
    });
    inp.addEventListener('blur',function(){showStorageView(main,storage,name)});
  })});
  var addBtn=main.querySelector('#rh-app-add');if(addBtn)addBtn.addEventListener('click',function(){
    var k=prompt('Key:');if(!k)return;var v=prompt('Value:');if(v===null)return;
    try{storage.setItem(k,v)}catch(e){}showStorageView(main,storage,name);
  });
  var clearBtn=main.querySelector('#rh-app-clear');if(clearBtn)clearBtn.addEventListener('click',function(){
    if(confirm('Clear all '+name+'?')){try{storage.clear()}catch(e){}}showStorageView(main,storage,name);
  });
  var refreshBtn=main.querySelector('#rh-app-refresh');if(refreshBtn)refreshBtn.addEventListener('click',function(){showStorageView(main,storage,name)});
}

function showCookiesView(main){
  var html='<div class="a-bar"><button class="a-abtn" id="rh-app-cookie-add">+ Add</button><button class="a-abtn" id="rh-app-cookie-refresh">Refresh</button></div>';
  html+='<div class="a-scroll"><table class="a-table"><tr><th>Name</th><th>Value</th><th>Flags</th><th style="width:50px"></th></tr>';
  try{
    var cookies=document.cookie.split(';').filter(function(c){return c.trim()});
    cookies.forEach(function(c){
      var parts=c.trim().split('=');var name=parts[0];var val=parts.slice(1).join('=');
      html+='<tr><td>'+esc(name)+'</td><td title="'+esc(val)+'">'+esc(val.slice(0,100))+'</td><td style="color:#555">JS-accessible</td><td><button class="a-abtn" data-cdel="'+esc(name)+'" style="padding:0 4px;font-size:10px">✕</button></td></tr>';
    });
    if(!cookies.length)html+='<tr><td colspan="4" class="a-empty">No JS-accessible cookies</td></tr>';
  }catch(e){html+='<tr><td colspan="4" style="color:#f44">'+esc(e.message)+'</td></tr>'}
  html+='</table></div>';
  main.innerHTML=html;
  main.querySelectorAll('[data-cdel]').forEach(function(btn){btn.addEventListener('click',function(){
    document.cookie=btn.dataset.cdel+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';showCookiesView(main);
  })});
  var addBtn=main.querySelector('#rh-app-cookie-add');if(addBtn)addBtn.addEventListener('click',function(){
    var name=prompt('Cookie name:');if(!name)return;var val=prompt('Cookie value:');if(val===null)return;
    document.cookie=name+'='+val+';path=/';showCookiesView(main);
  });
  var refreshBtn=main.querySelector('#rh-app-cookie-refresh');if(refreshBtn)refreshBtn.addEventListener('click',function(){showCookiesView(main)});
}

function showIndexedDBView(main){
  main.innerHTML='<div class="a-bar"><button class="a-abtn" id="rh-app-idb-refresh">Refresh</button></div><div class="a-scroll" id="rh-app-idb-content"><div style="padding:8px;color:#969696">Loading IndexedDB info…</div></div>';
  var content=main.querySelector('#rh-app-idb-content');
  main.querySelector('#rh-app-idb-refresh').addEventListener('click',function(){showIndexedDBView(main)});
  if(indexedDB.databases){
    indexedDB.databases().then(function(dbs){
      if(!dbs.length){content.innerHTML='<div class="a-empty">No IndexedDB databases</div>';return}
      var html='<table class="a-table"><tr><th>Database</th><th>Version</th></tr>';
      dbs.forEach(function(db){html+='<tr><td>'+esc(db.name)+'</td><td>'+(db.version||'?')+'</td></tr>'});
      html+='</table>';content.innerHTML=html;
    }).catch(function(e){content.innerHTML='<div style="padding:8px;color:#f44">'+esc(e.message)+'</div>'});
  }else{content.innerHTML='<div class="a-empty">indexedDB.databases() not supported</div>'}
}

function showServiceWorkersView(main){
  main.innerHTML='<div class="a-bar"><button class="a-abtn" id="rh-app-sw-refresh">Refresh</button></div><div class="a-scroll" id="rh-app-sw-content"><div style="padding:8px;color:#969696">Loading…</div></div>';
  var content=main.querySelector('#rh-app-sw-content');
  main.querySelector('#rh-app-sw-refresh').addEventListener('click',function(){showServiceWorkersView(main)});
  if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){
    navigator.serviceWorker.getRegistrations().then(function(regs){
      if(!regs.length){content.innerHTML='<div class="a-empty">No service workers registered</div>';return}
      var html='<table class="a-table"><tr><th>Scope</th><th>Status</th><th></th></tr>';
      regs.forEach(function(r){
        var sw=r.active||r.waiting||r.installing;
        html+='<tr><td>'+esc(r.scope)+'</td><td>'+(sw?sw.state:'unknown')+'</td><td><button class="a-abtn sw-unreg" data-scope="'+esc(r.scope)+'" style="padding:0 4px;font-size:10px">Unregister</button></td></tr>';
      });
      html+='</table>';content.innerHTML=html;
      content.querySelectorAll('.sw-unreg').forEach(function(btn){btn.addEventListener('click',function(){
        regs.forEach(function(r){if(r.scope===btn.dataset.scope)r.unregister()});
        setTimeout(function(){showServiceWorkersView(main)},500);
      })});
    }).catch(function(e){content.innerHTML='<div style="padding:8px;color:#f44">'+esc(e.message)+'</div>'});
  }else{content.innerHTML='<div class="a-empty">Service Worker API not available</div>'}
}

function showCacheStorageView(main){
  main.innerHTML='<div class="a-bar"><button class="a-abtn" id="rh-app-cache-refresh">Refresh</button></div><div class="a-scroll" id="rh-app-cache-content"><div style="padding:8px;color:#969696">Loading…</div></div>';
  var content=main.querySelector('#rh-app-cache-content');
  main.querySelector('#rh-app-cache-refresh').addEventListener('click',function(){showCacheStorageView(main)});
  if(window.caches){
    caches.keys().then(function(names){
      if(!names.length){content.innerHTML='<div class="a-empty">No cache storage entries</div>';return}
      var html='<table class="a-table"><tr><th>Cache Name</th><th>Actions</th></tr>';
      names.forEach(function(name){
        html+='<tr><td>'+esc(name)+'</td><td><button class="a-abtn cache-del" data-name="'+esc(name)+'" style="padding:0 4px;font-size:10px">Delete</button> <button class="a-abtn cache-view" data-name="'+esc(name)+'" style="padding:0 4px;font-size:10px">View</button></td></tr>';
      });
      html+='</table><div id="rh-cache-detail"></div>';content.innerHTML=html;
      content.querySelectorAll('.cache-del').forEach(function(btn){btn.addEventListener('click',function(){
        caches.delete(btn.dataset.name).then(function(){showCacheStorageView(main)});
      })});
      content.querySelectorAll('.cache-view').forEach(function(btn){btn.addEventListener('click',function(){
        var detail=content.querySelector('#rh-cache-detail');
        caches.open(btn.dataset.name).then(function(cache){return cache.keys()}).then(function(requests){
          var h='<div style="padding:4px 0;color:#969696;font-size:10px">Cache: '+esc(btn.dataset.name)+' ('+requests.length+' entries)</div><table class="a-table"><tr><th>URL</th></tr>';
          requests.slice(0,50).forEach(function(r){h+='<tr><td title="'+esc(r.url)+'">'+esc(cleanUrl(r.url))+'</td></tr>'});
          if(requests.length>50)h+='<tr><td style="color:#555">…'+(requests.length-50)+' more</td></tr>';
          h+='</table>';detail.innerHTML=h;
        });
      })});
    }).catch(function(e){content.innerHTML='<div style="padding:8px;color:#f44">'+esc(e.message)+'</div>'});
  }else{content.innerHTML='<div class="a-empty">Cache Storage API not available</div>'}
}

function showManifestView(main){
  main.innerHTML='<div class="a-scroll" id="rh-app-manifest-content"><div style="padding:8px;color:#969696">Loading manifest…</div></div>';
  var content=main.querySelector('#rh-app-manifest-content');
  var link=document.querySelector('link[rel=manifest]');
  if(!link||!link.href){content.innerHTML='<div class="a-empty">No manifest link found</div>';return}
  fetch(link.href).then(function(r){return r.text()}).then(function(text){
    try{var json=JSON.parse(text);content.innerHTML='<pre style="padding:8px;white-space:pre-wrap;word-break:break-all;color:#d4d4d4">'+esc(JSON.stringify(json,null,2))+'</pre>'}
    catch(e){content.innerHTML='<pre style="padding:8px;white-space:pre-wrap;color:#d4d4d4">'+esc(text)+'</pre>'}
  }).catch(function(e){content.innerHTML='<div style="padding:8px;color:#f44">Failed to load manifest: '+esc(e.message)+'</div>'});
}

// ===== SECURITY TAB =====
function initSecurity(){
  var pane=$('#rh-security');
  pane.innerHTML='<div class="rh-toolbar"><button class="rh-fbtn on" id="rh-sec-scan">Run Security Scan</button></div><div class="sec-scroll" id="rh-sec-scroll"></div>';
  $('#rh-sec-scan').addEventListener('click',runSecurityScan);
  onTabActivate('security',runSecurityScan);
}

function runSecurityScan(){
  var scroll=$('#rh-sec-scroll');if(!scroll)return;
  var html='';
  var isHTTPS=location.protocol==='https:';
  var destUrl=window.__rhDestUrl||'';
  var destHTTPS=destUrl.startsWith('https://');

  // Overview
  html+='<div class="sec-overview">';
  if(destHTTPS)html+='<div class="sec-badge secure">&#10003; Secure Connection</div><div style="color:#969696;font-size:11px;margin-top:4px">This page is served over HTTPS (via proxy)</div>';
  else if(destUrl)html+='<div class="sec-badge insecure">&#10007; Insecure Connection</div><div style="color:#969696;font-size:11px;margin-top:4px">This page is served over HTTP</div>';
  else html+='<div class="sec-badge mixed">? Unknown</div>';
  html+='</div>';

  // Connection Info
  html+='<div class="sec-sect">Connection</div>';
  html+='<div class="sec-row"><span class="sec-icon '+(isHTTPS?'sec-pass':'sec-warn')+'">'+( isHTTPS?'✓':'!')+'</span><span>Proxy protocol: '+location.protocol+'</span></div>';
  if(destUrl)html+='<div class="sec-row"><span class="sec-icon '+(destHTTPS?'sec-pass':'sec-fail')+'">'+( destHTTPS?'✓':'✕')+'</span><span>Origin protocol: '+(destHTTPS?'https:':'http:')+'</span></div>';

  // Mixed Content
  html+='<div class="sec-sect">Mixed Content</div>';
  var mixed=[];
  try{
    document.querySelectorAll('img[src],script[src],link[href],iframe[src],video[src],audio[src]').forEach(function(el){
      var url=el.src||el.href;
      if(url&&url.startsWith('http://')&&!url.includes('localhost')&&!url.includes('127.0.0.1'))
        mixed.push({tag:el.tagName.toLowerCase(),url:url});
    });
  }catch(e){}
  if(mixed.length){
    mixed.slice(0,20).forEach(function(m){
      html+='<div class="sec-row"><span class="sec-icon sec-fail">✕</span><span>&lt;'+esc(m.tag)+'&gt; loads HTTP: '+esc(m.url.slice(0,80))+'</span></div>';
    });
    if(mixed.length>20)html+='<div class="sec-row" style="color:#555">…'+(mixed.length-20)+' more</div>';
  }else{
    html+='<div class="sec-row"><span class="sec-icon sec-pass">✓</span><span>No mixed content detected</span></div>';
  }

  // Cookie Security
  html+='<div class="sec-sect">Cookie Security</div>';
  try{
    var cookies=document.cookie.split(';').filter(function(c){return c.trim()});
    if(cookies.length){
      cookies.forEach(function(c){
        var name=c.trim().split('=')[0];
        var issues=[];
        issues.push('JS-accessible (not HttpOnly)');
        if(!isHTTPS)issues.push('No Secure flag possible on HTTP');
        html+='<div class="sec-row"><span class="sec-icon sec-warn">!</span><span>'+esc(name)+': '+issues.join(', ')+'</span></div>';
      });
    }else{
      html+='<div class="sec-row"><span class="sec-icon sec-pass">✓</span><span>No JS-accessible cookies</span></div>';
    }
  }catch(e){}

  // Resource Origins
  html+='<div class="sec-sect">Resource Origins</div>';
  var origins={};
  try{
    performance.getEntriesByType('resource').forEach(function(r){
      try{var u=new URL(r.name);origins[u.origin]=(origins[u.origin]||0)+1}catch(e){}
    });
  }catch(e){}
  var originKeys=Object.keys(origins).sort(function(a,b){return origins[b]-origins[a]});
  originKeys.slice(0,15).forEach(function(o){
    var isSecure=o.startsWith('https://');
    html+='<div class="sec-row"><span class="sec-icon '+(isSecure?'sec-pass':'sec-warn')+'">'+( isSecure?'✓':'!')+'</span><span>'+esc(o)+' ('+origins[o]+' resources)</span></div>';
  });

  // CORS Errors
  html+='<div class="sec-sect">CORS / Security Errors</div>';
  var corsErrors=Q.filter(function(e){return e.l==='error'&&e.raw&&e.raw[0]&&String(e.raw[0]).match(/cors|cross-origin|blocked|security|mixed content/i)});
  if(corsErrors.length){
    corsErrors.slice(0,10).forEach(function(e){
      html+='<div class="sec-row"><span class="sec-icon sec-fail">✕</span><span style="word-break:break-all">'+esc(String(e.raw[0]).slice(0,200))+'</span></div>';
    });
  }else{
    html+='<div class="sec-row"><span class="sec-icon sec-pass">✓</span><span>No CORS/security errors detected</span></div>';
  }

  scroll.innerHTML=html;
}

// ===== LIGHTHOUSE TAB =====
var _lhScores={perf:null,a11y:null,bp:null,seo:null};
function initLighthouse(){
  var pane=$('#rh-lighthouse');
  pane.innerHTML='<div class="lh-scroll" id="rh-lh-scroll"><div class="lh-run"><div style="color:#969696;margin-bottom:12px;font-size:12px">Run a simplified audit to check Performance, Accessibility, Best Practices, and SEO.</div><button class="lh-run-btn" id="rh-lh-run">Run Audit</button></div></div>';
  $('#rh-lh-run').addEventListener('click',function(){this.disabled=true;this.textContent='Running…';runLighthouseAudit()});
}

function runLighthouseAudit(){
  var scroll=$('#rh-lh-scroll');if(!scroll)return;
  var results={perf:{score:0,checks:[]},a11y:{score:0,checks:[]},bp:{score:0,checks:[]},seo:{score:0,checks:[]}};

  // PERFORMANCE
  var perf=window.__rhPerf||{};var nav=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];
  var paint=performance.getEntriesByType&&performance.getEntriesByType('paint')||[];
  var fcp=0;paint.forEach(function(p){if(p.name==='first-contentful-paint')fcp=p.startTime});
  if(!fcp)fcp=perf.fcp||0;
  results.perf.checks.push({pass:fcp&&fcp<1800,label:'First Contentful Paint',detail:fcp?Math.round(fcp)+' ms':'Not measured'});
  results.perf.checks.push({pass:perf.lcp&&perf.lcp<2500,label:'Largest Contentful Paint',detail:perf.lcp?Math.round(perf.lcp)+' ms':'Not measured'});
  results.perf.checks.push({pass:(perf.cls||0)<0.1,label:'Cumulative Layout Shift',detail:(perf.cls||0).toFixed(3)});
  if(nav){
    var ttfb=nav.responseStart-nav.requestStart;
    results.perf.checks.push({pass:ttfb<600,label:'Time to First Byte',detail:Math.round(ttfb)+' ms'});
    var domLoad=nav.domContentLoadedEventEnd-nav.fetchStart;
    results.perf.checks.push({pass:domLoad<3000,label:'DOM Content Loaded',detail:Math.round(domLoad)+' ms'});
  }
  var resources=performance.getEntriesByType&&performance.getEntriesByType('resource')||[];
  results.perf.checks.push({pass:resources.length<100,warn:resources.length>=50&&resources.length<100,label:'Resource count',detail:resources.length+' resources'});

  // ACCESSIBILITY
  var imgs=document.querySelectorAll('img');var noAlt=0;
  imgs.forEach(function(img){if(!img.getAttribute('alt')&&img.getAttribute('alt')!=='')noAlt++});
  results.a11y.checks.push({pass:noAlt===0,label:'Images have alt text',detail:noAlt?noAlt+' images missing alt':'All '+imgs.length+' images have alt'});
  var htmlLang=document.documentElement.getAttribute('lang');
  results.a11y.checks.push({pass:!!htmlLang,label:'<html> has lang attribute',detail:htmlLang||'missing'});
  var headings=document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  var headingLevels=[];headings.forEach(function(h){headingLevels.push(parseInt(h.tagName[1]))});
  var headingOrder=true;for(var i=1;i<headingLevels.length;i++){if(headingLevels[i]>headingLevels[i-1]+1){headingOrder=false;break}}
  results.a11y.checks.push({pass:headingOrder,label:'Heading hierarchy is sequential',detail:headingLevels.join(' → ')||'No headings'});
  var formInputs=document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])');
  var noLabel=0;formInputs.forEach(function(inp){
    var id=inp.id;var hasLabel=id&&document.querySelector('label[for="'+id+'"]');
    var ariaLabel=inp.getAttribute('aria-label')||inp.getAttribute('aria-labelledby')||inp.getAttribute('title')||inp.getAttribute('placeholder');
    if(!hasLabel&&!ariaLabel)noLabel++;
  });
  results.a11y.checks.push({pass:noLabel===0,label:'Form inputs have labels',detail:noLabel?noLabel+' inputs missing labels':'All labeled'});
  var buttons=document.querySelectorAll('button,a[role=button],[role=button]');
  var emptyButtons=0;buttons.forEach(function(b){if(!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.querySelector('img[alt]'))emptyButtons++});
  results.a11y.checks.push({pass:emptyButtons===0,label:'Buttons have accessible names',detail:emptyButtons?emptyButtons+' empty buttons':'All named'});
  var ariaRoles=document.querySelectorAll('[role]');
  results.a11y.checks.push({pass:true,label:'ARIA roles used',detail:ariaRoles.length+' elements with roles'});

  // BEST PRACTICES
  var destUrl=window.__rhDestUrl||location.href;
  results.bp.checks.push({pass:destUrl.startsWith('https://'),label:'Uses HTTPS',detail:destUrl.startsWith('https://')?'Yes':'No'});
  var errorCount=Q.filter(function(e){return e.l==='error'}).length;
  results.bp.checks.push({pass:errorCount===0,warn:errorCount>0&&errorCount<=5,label:'No console errors',detail:errorCount+' errors'});
  var docWrite=false;try{docWrite=document.body.innerHTML.includes('document.write')}catch(e){}
  results.bp.checks.push({pass:!docWrite,label:'Avoids document.write()',detail:docWrite?'Detected':'Not found'});
  var viewport=document.querySelector('meta[name=viewport]');
  results.bp.checks.push({pass:!!viewport,label:'Has viewport meta tag',detail:viewport?'Present':'Missing'});
  results.bp.checks.push({pass:document.doctype!==null,label:'Page has DOCTYPE',detail:document.doctype?'Present':'Missing'});
  var charset=document.querySelector('meta[charset]')||document.querySelector('meta[http-equiv=Content-Type]');
  results.bp.checks.push({pass:!!charset,label:'Character encoding declared',detail:charset?'Present':'Missing'});

  // SEO
  var title=document.title;
  results.seo.checks.push({pass:!!title&&title.length>0,label:'Has <title>',detail:title?('"'+title.slice(0,60)+'"'):'Missing'});
  var metaDesc=document.querySelector('meta[name=description]');
  var descContent=metaDesc?metaDesc.getAttribute('content'):'';
  results.seo.checks.push({pass:!!descContent,label:'Has meta description',detail:descContent?'"'+descContent.slice(0,60)+'"':'Missing'});
  results.seo.checks.push({pass:!!viewport,label:'Has viewport meta',detail:viewport?'Present':'Missing'});
  var canonical=document.querySelector('link[rel=canonical]');
  results.seo.checks.push({pass:!!canonical,label:'Has canonical link',detail:canonical?canonical.href:'Missing'});
  var h1s=document.querySelectorAll('h1');
  results.seo.checks.push({pass:h1s.length===1,warn:h1s.length>1,label:'Single H1 tag',detail:h1s.length+' h1 tags found'});
  var links=document.querySelectorAll('a[href]');
  var noText=0;links.forEach(function(a){if(!a.textContent.trim()&&!a.getAttribute('aria-label'))noText++});
  results.seo.checks.push({pass:noText===0,label:'Links have text',detail:noText?noText+' links without text':'All have text'});

  // Calculate scores
  ['perf','a11y','bp','seo'].forEach(function(cat){
    var checks=results[cat].checks;var passed=checks.filter(function(c){return c.pass}).length;
    results[cat].score=Math.round(passed/checks.length*100);
  });

  renderLighthouseResults(scroll,results);
}

function renderLighthouseResults(scroll,results){
  var html='<div class="lh-header">';
  ['Performance','Accessibility','Best Practices','SEO'].forEach(function(label,i){
    var key=['perf','a11y','bp','seo'][i];
    var score=results[key].score;
    html+='<div class="lh-score"><canvas class="lh-canvas" data-score="'+score+'" width="64" height="64"></canvas><div class="lh-score-label">'+label+'</div></div>';
  });
  html+='</div>';

  var categories=[{key:'perf',label:'Performance'},{key:'a11y',label:'Accessibility'},{key:'bp',label:'Best Practices'},{key:'seo',label:'SEO'}];
  categories.forEach(function(cat){
    html+='<div class="lh-sect">'+cat.label+' ('+results[cat.key].score+'/100)</div>';
    results[cat.key].checks.forEach(function(c){
      var cls=c.pass?'lh-pass':(c.warn?'lh-warn':'lh-fail');
      var icon=c.pass?'✓':(c.warn?'!':'✕');
      html+='<div class="lh-check"><span class="icon '+cls+'">'+icon+'</span><span>'+esc(c.label)+'</span><span style="color:#969696;margin-left:auto">'+esc(c.detail)+'</span></div>';
    });
  });

  html+='<div class="lh-run"><button class="lh-run-btn" id="rh-lh-rerun">Re-run Audit</button></div>';
  scroll.innerHTML=html;

  scroll.querySelectorAll('.lh-canvas').forEach(function(canvas){
    var score=parseInt(canvas.dataset.score);
    drawScoreCircle(canvas,score);
  });

  var rerun=scroll.querySelector('#rh-lh-rerun');
  if(rerun)rerun.addEventListener('click',function(){this.disabled=true;this.textContent='Running…';runLighthouseAudit()});
}

function drawScoreCircle(canvas,score){
  var ctx=canvas.getContext('2d');
  var s=canvas.width;var c=s/2;var r=c-4;var lw=4;
  ctx.clearRect(0,0,s,s);
  ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.strokeStyle='#333';ctx.lineWidth=lw;ctx.stroke();
  var color=score>=90?'#4ec9b0':score>=50?'#dcdcaa':'#f44';
  var angle=Math.PI*2*(score/100)-Math.PI/2;
  ctx.beginPath();ctx.arc(c,c,r,-Math.PI/2,angle);ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.stroke();
  ctx.fillStyle=color;ctx.font='bold 18px Consolas,monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(score,c,c);
}

// ===== REPLAY + LIVE HOOKS =====
function replayBuffered(){
  Q.forEach(function(e){addConsoleEntry(e)});
  NET.forEach(function(e){addNetEntry(e);if(e.s)updateNetEntry(e)});
}

function setupLiveHooks(){
  window.__rhPanel={
    log:function(entry){addConsoleEntry(entry)},
    net:function(entry){addNetEntry(entry)},
    netUpdate:function(entry){updateNetEntry(entry)},
    clear:function(){if(_conScroll)_conScroll.innerHTML=''}
  };
}

// ===== BOOTSTRAP =====
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',buildPanel);
else setTimeout(buildPanel,0);
})();
