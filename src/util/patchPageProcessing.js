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

// ---------------------------------------------------------------------------
// AD BLOCKER — client-side cosmetic filter + popup/redirect suppressor.
// The server-side request blocker lives in src/util/adBlocker.js. These two
// pieces of code are injected into every proxied page to attack the visual
// and behavioural side of ads that survive network-level blocking:
//   • element-hiding CSS: hides ad containers even if the creative loads
//   • popup/open-tab blocker: kills window.open/popunders triggered from
//     untrusted events (autoplay, timers, first scroll, etc.)
//   • meta-refresh & auto-redirect guard: neutralises redirect-ad chains
//   • YouTube SPA patcher: skips pre/mid/end-roll ads in the player
// Respects an opt-out cookie (__rh_ab=0) just like the server-side blocker.
// ---------------------------------------------------------------------------
const AD_CSS_RULES = [
    // Generic ad containers by id/class (EasyList element-hiding excerpt)
    '[id*="google_ads"], [id*="googlead"], [id*="ad-container"], [id*="adContainer"], ',
    '[id*="adBanner"], [id*="ad-banner"], [id*="banner-ad"], [id*="banner_ad"], ',
    '[id*="ad-slot"], [id*="adslot"], [id*="ad-placement"], [id*="adplacement"], ',
    '[id*="adsense"], [id*="ad-sense"], [id*="sponsored"], [id*="outbrain"], [id*="taboola"], ',
    '[class*="google_ads"], [class*="googlead"], [class*="ad-container"], [class*="adContainer"], ',
    '[class*="ad-banner"], [class*="banner-ad"], [class*="banner_ad"], ',
    '[class*="ad-slot"], [class*="adslot"], [class*="ad-placement"], [class*="adplacement"], ',
    '[class*="adsense"], [class*="ad-sense"], [class*="sponsored-content"], [class*="taboola"], [class*="outbrain"], ',
    'ins.adsbygoogle, ins.adsbygoogle-noablate, ',
    'iframe[src*="googlesyndication"], iframe[src*="doubleclick"], iframe[src*="googletagservices"], ',
    'iframe[src*="/ads/"], iframe[src*="/ad/"], iframe[src*="/pagead/"], iframe[src*="adserver"], ',
    'iframe[src*="amazon-adsystem"], iframe[src*="adnxs"], iframe[src*="criteo"], ',
    'iframe[src*="rubiconproject"], iframe[src*="pubmatic"], iframe[src*="openx.net"], ',
    'iframe[src*="taboola"], iframe[src*="outbrain"], iframe[src*="revcontent"], iframe[src*="mgid"], ',
    'iframe[id*="google_ads"], iframe[id*="aswift"], iframe[name*="google_ads"], ',
    'div[data-ad-slot], div[data-ad-client], div[data-google-query-id], div[data-ad-unit], ',
    // Generic [data-ad] + gaming/unblocker-site ad slot containers
    '[data-ad], [data-ad-id], [data-ad-name], [data-ad-type], [data-ad-zone], ',
    '[data-ad-region], [data-ad-size], [data-advertising], [data-cnx-ps], ',
    'div[class^="adcontainer"], div[class^="ad-cont"], div[id^="adcont"], ',
    'div[class*="leaderboard-1"], div[class*="billboard-1"], div[class*="skyscraper"], ',
    'div[class*="rectangle-1"], div[class*="rectangle-2"], div[class*="halfpage"], ',
    'div[class*="mpu-ad"], div[class*="ad-mpu"], div[class*="mpu-1"], div[class*="mpu-2"], ',
    // Rev/Kueez/Playwire/AdInPlay/Snigel wrappers
    '[id^="rev-"], [id^="kueez-"], [id^="aip-"], [id^="snigel_"], [id^="pwAd_"], ',
    '[class^="pwAd"], [class^="aip-"], [class^="primis-"], [class^="connatix-"], ',

    'div[aria-label="Advertisement" i], div[aria-label="advertisement" i], div[aria-label*="sponsored" i], ',
    'a[href*="googleadservices.com"], a[href*="doubleclick.net"], a[href*="googlesyndication"], ',
    // YouTube ad overlays & banners (doesn\'t kill the video player)
    'ytd-display-ad-renderer, ytd-companion-slot-renderer, ytd-action-companion-ad-renderer, ',
    'ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ',
    'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-banner-promo-renderer, ',
    'ytd-statement-banner-renderer, ytd-reel-video-renderer ytd-ad-slot-renderer, ',
    '.ytp-ad-overlay-container, .ytp-ad-text-overlay, .ytp-ad-image-overlay, ',
    'div#masthead-ad, ytd-rich-item-renderer[is-slim-media][has-ad], ',
    '.video-ads.ytp-ad-module, div.ytp-ad-player-overlay, div.ytp-ad-player-overlay-instream-info, ',
    // Reddit / Twitter / Facebook promoted content
    'shreddit-ad-post, article[data-testid="placementTracking"], ',
    '[data-testid="placementTracking"], [data-testid="inlineAd"], ',
    '[aria-label*="Promoted" i], [data-ad-preview="message"], ',
    'div[data-pagelet="FeedUnit_{fbid}"][data-sponsored="true"], ',
    // Generic class-prefixes used by many CMSes
    '.adsbox, .ad_box, .ad-box, .adbox, .advert, .advertise, .advertisement, ',
    '.ad-banner-container, .ad-wrapper, .ad-inline, .ad-rectangle, .ad-unit, ',
    '.ad-leaderboard, .ad-sidebar, .ad-content, .sponsored, .sponsored-post, ',
    '.native-ad, .promo-ad, .OUTBRAIN, .taboola-placement, ',
    // Common popup/sticky-footer "support us" walls
    '[id*="cookie-banner"][id*="sponsor"], [class*="sticky-ad"], [class*="fixed-ad"], ',
    '[class*="leaderboard-ad"], [class*="MPUholder"], [class*="dfp-ad"]',
].join('');
const AD_BLOCKER_SCRIPT = [
    // Element IDs are deliberately kept vague (no `__rh_*` brand prefix) so
    // a Smart Agent can't `document.getElementById('__rh_ab_css')` and
    // immediately fingerprint the proxy.
    '<style id="_a_css">',
    // Hide ad containers. !important so sites can\'t override.
    AD_CSS_RULES,
    '{display:none!important;visibility:hidden!important;height:0!important;width:0!important;min-height:0!important;min-width:0!important;max-height:0!important;max-width:0!important;pointer-events:none!important;}',
    // YouTube: collapse video player ad state container so ads can\'t cover video
    '.ad-showing video.html5-main-video{display:none!important;}',
    '.ad-showing .ytp-chrome-bottom, .ad-showing .ytp-ad-skip-button-modern, .ad-showing .ytp-ad-skip-button-slot{display:none!important;}',
    '</style>',
    '<script id="_a_js">',
    '(function(){',
    'if(typeof window==="undefined"||window.__rhABinit)return;window.__rhABinit=1;',
    'var _off=false;',
    'try{_off=localStorage.getItem("adBlockerEnabled")==="0"}catch(e){}',
    'if(!_off){try{_off=document.cookie.indexOf("__rh_ab=0")!==-1}catch(e){}}',
    'if(_off){try{var cs=document.getElementById("_a_css");if(cs)cs.remove()}catch(e){}return}',
    // --- POPUP / POPUNDER GUARD ---
    // Block ad popups while still allowing legitimate cross-origin popups (Discord invite
    // links, OAuth flows, share buttons). Decision tree inside the window.open override:
    //   1. Target URL matches known ad-network host regex  -> block unconditionally
    //   2. Recent (<=2.5s) trusted gesture on a user-control element (A[href], BUTTON,
    //      INPUT button/submit, [role=button/link/menuitem/tab], [onclick], [tabindex],
    //      SUMMARY, LABEL)                                  -> allow (user intent is clear)
    //   3. No gesture within 2.5s                           -> block as "untrusted popup"
    //      (autoplay / setTimeout / onscroll popunder pattern)
    //   4. Gesture happened but not on a user-control, AND popup is cross-origin
    //                                                       -> block as "first-click popunder"
    //      (document-level onclick hook used by motorsnag, popcash, propellerads, etc.)
    //   5. Same-origin popup without user-control           -> allow (app dialogs, etc.)
    'var _AD_HOST_RE=/doubleclick\\.net|googlesyndication|popads\\.net|popcash|propellerads|adsterra|exosrv|onclkds|adcash|juicyads|trafficjunky|motorsnag|kueezrtb|kueez\\.com|rev\\.iq|r9x\\.in|venatusmedia|snigelweb|playwire|ezoic|nitropay|adthrive|mediavine|onetag-sys|pushground|clickadilla|clickaine|clixad|popmyads|pubdirecte|onclickperformance|revrolldirect|tpid\\.ws|tyche\\.pw|anyclip|engageya|primis\\.tech|connatix|undertone|inmobi|chartboost|vungle|applovin|onclckds|clkads|freestar\\.com|pub\\.network|adinplay|raptive|taboola|outbrain|revcontent|bemobtrack|zeydoo|onlineloadpgm|popmansion|dailysurveyoffers|mellowads|adblade|bidgear|clkmon|notix\\.co|rollerads|pushhouse|pushuncle|coinhive|coin-hive|crypto-loot|authedmine|webminepool|cpmleader|cpxcenter|smowtion|adsco\\.re|webpush\\.io|push\\.world|onesignal-ads|skimresources|viglink|dpbolvw\\.net|anrdoezrs|jdoqocy|qksrv\\.net|tkqlhce|linksynergy|impactradius|adsterra|juicyads|trafficstars/i;',
    'try{var _lastUserTs=0,_lastUserTarget=null,_lastTrustedTs=0;',
    // We capture every click-like event; popunders typically fire without any click at all,
    // so mere presence of a recent click (even untrusted/synthetic) means SOMETHING user-like
    // happened. We separately track isTrusted timestamps for stricter checks if ever needed.
    'function _noteUser(e){if(!e)return;_lastUserTs=Date.now();_lastUserTarget=e.target||null;if(e.isTrusted)_lastTrustedTs=_lastUserTs}',
    '["click","auxclick","keydown","keyup","mousedown","mouseup","touchstart","touchend","pointerdown","pointerup","contextmenu","submit"].forEach(function(t){',
    'try{window.addEventListener(t,_noteUser,true)}catch(e){}',
    'try{document.addEventListener(t,_noteUser,true)}catch(e){}});',
    // A click is considered "directly actionable" if the target or any ancestor is a control
    // element (anchor, button, input-button, role=button, or has an onclick attribute).
    'function _isDirectUserControl(el){try{var depth=0;while(el&&el.nodeType===1&&depth<12){',
    'var tg=(el.tagName||"").toUpperCase();',
    'if(tg==="A"&&el.getAttribute&&el.getAttribute("href"))return true;',
    'if(tg==="BUTTON"||tg==="SUMMARY"||tg==="LABEL")return true;',
    'if(tg==="INPUT"){var it=(el.type||"").toLowerCase();',
    'if(it==="button"||it==="submit"||it==="image"||it==="reset")return true}',
    'if(el.getAttribute){',
    'var r=el.getAttribute("role");',
    'if(r==="button"||r==="link"||r==="menuitem"||r==="option"||r==="tab")return true;',
    'if(el.getAttribute("onclick"))return true;',
    'if(el.getAttribute("tabindex")!==null)return true;}',
    'el=el.parentNode;depth++}}catch(e){}return false}',
    'var _myHost="";try{_myHost=location.hostname}catch(e){}',
    // Hammerhead\'s runtime installs its own window.open wrapper AFTER our script runs, and
    // internally rewrites ad URLs to shuffled proxy URLs before dispatching. If we simply
    // overwrote window.open here, hammerhead would wrap our wrapper and we\'d only ever see
    // shuffled URLs (making ad-host regex matches impossible). Instead we re-install the
    // guard AFTER hammerhead has set up, so we sit ON TOP of hammerhead\'s wrapper and
    // receive the ORIGINAL URL the page passed to window.open. We retry over a growing
    // window to account for async runtime init.
    'function _installOpenGuard(){try{',
    'var cur=window.open;if(!cur||cur.__rhAdGuard)return;',
    'var _guardDepth=0;',
    'var _oOpen=cur;',
    'var guarded=function(u,n,f){',
    '_guardDepth++;',
    // If hammerhead\'s wrapper internally re-enters via nativeMethods.windowOpen (which
    // may point to a previous wrapper of ours), avoid double-checking and just pass through.
    'if(_guardDepth>1){_guardDepth--;return _oOpen.apply(this,arguments)}',
    'try{',
    // Signal 1: known ad-network host -> always block (even if user-initiated)
    'if(typeof u==="string"&&_AD_HOST_RE.test(u)){',
    'try{console.debug("[ab] blocked ad popup:",u)}catch(e){}',
    'return null}',
    'var gestureAge=Date.now()-_lastUserTs;',
    // Signal 2: recent gesture on a real user-control (Discord "Join", share buttons, OAuth) -> allow
    'if(gestureAge<=2500&&_isDirectUserControl(_lastUserTarget)){',
    'return _oOpen.apply(this,arguments)}',
    // Signal 3: no gesture at all (timer-fired popunder) -> block
    'if(gestureAge>2500){',
    'try{console.debug("[ab] blocked untrusted popup:",u)}catch(e){}',
    'return null}',
    // Signal 4: gesture happened on non-user-control element (document-level onclick popunder).
    // For cross-origin popups this is the "first-click popunder" pattern (motorsnag/popcash/etc).
    'if(typeof u==="string"&&u){',
    'var _uHost="";try{_uHost=new URL(u,location.href).hostname}catch(e){}',
    'if(_uHost&&_myHost&&_uHost!==_myHost){',
    'try{console.debug("[ab] blocked first-click popunder:",u)}catch(e){}',
    'return null}}',
    // Otherwise (same-origin popup, even without user-control) -> allow
    'return _oOpen.apply(this,arguments);',
    '}finally{_guardDepth--}',
    '};',
    'guarded.__rhAdGuard=true;',
    'window.open=guarded;',
    '}catch(e){}}',
    // Install now (in case no runtime wraps window.open) AND after short delays so we end
    // up wrapping hammerhead\'s wrapper (which in turn calls the real native method).
    '_installOpenGuard();',
    'setTimeout(_installOpenGuard,0);',
    'setTimeout(_installOpenGuard,100);',
    'setTimeout(_installOpenGuard,500);',
    'setTimeout(_installOpenGuard,2000);',
    'try{document.addEventListener("DOMContentLoaded",_installOpenGuard,true)}catch(e){}',
    '}catch(e){}',
    // --- AUTO-REDIRECT GUARD ---
    // Block top-frame location changes triggered without a recent user gesture
    // (common malvertising pattern: setTimeout(()=>top.location=adUrl,500)).
    // Covers all navigation surface: location.assign/replace, location.href=, window.location=,
    // document.location=, top.location=, and parent.location=. We must install AFTER
    // hammerhead has wrapped Location so we sit on top of its URL rewriter and still see
    // the original ad URL before it\'s proxified.
    'try{var _blockedHosts=/doubleclick\\.net|googlesyndication|popads\\.net|popcash|propellerads|adsterra|exosrv|onclkds|adcash|juicyads|trafficjunky|revcontent|taboola|outbrain|mgid\\.com|motorsnag|kueezrtb|kueez\\.com|rev\\.iq|r9x\\.in|venatusmedia|snigelweb|playwire|ezoic|nitropay|adthrive|mediavine|onetag-sys|pushground|clickadilla|clickaine|clixad|popmyads|pubdirecte|revrolldirect|tpid\\.ws|tyche\\.pw|anyclip|engageya|primis\\.tech|connatix|undertone|onclickperformance|revrolldirect|freestar\\.com|pub\\.network|adinplay|raptive|onclckds|clkads|bemobtrack|zeydoo|onlineloadpgm|popmansion|dailysurveyoffers|mellowads|adblade|bidgear|clkmon|adsco\\.re/i;',
    'function _isAdRedirect(u){try{if(typeof u!=="string")return false;if(_blockedHosts.test(u))return true;var uh="";try{uh=new URL(u,location.href).hostname}catch(e){}return uh&&_blockedHosts.test(uh)}catch(e){return false}}',
    // Intercept location.assign / replace methods
    'function _installLocGuard(){try{',
    'var _loc=window.location;if(!_loc||_loc.__rhLocGuard)return;',
    'try{var _oAssign=_loc.assign.bind(_loc);_loc.assign=function(u){if(_isAdRedirect(u)){try{console.debug("[ab] blocked location.assign:",u)}catch(e){}return}return _oAssign(u)}}catch(e){}',
    'try{var _oReplace=_loc.replace.bind(_loc);_loc.replace=function(u){if(_isAdRedirect(u)){try{console.debug("[ab] blocked location.replace:",u)}catch(e){}return}return _oReplace(u)}}catch(e){}',
    // Intercept location.href setter on this Location instance (may be hammerhead-wrapped Location)
    'try{var _hrefDesc=Object.getOwnPropertyDescriptor(_loc.__proto__||Location.prototype,"href");',
    'if(_hrefDesc&&_hrefDesc.set){',
    'var _oHrefSet=_hrefDesc.set,_oHrefGet=_hrefDesc.get;',
    'Object.defineProperty(_loc,"href",{configurable:true,get:function(){return _oHrefGet.call(this)},set:function(v){if(_isAdRedirect(v)){try{console.debug("[ab] blocked location.href=:",v)}catch(e){}return}return _oHrefSet.call(this,v)}})}}catch(e){}',
    // Intercept window.location = "..." (setter on Window.prototype). Hammerhead wraps this;
    // wrapping again here adds our guard on top of theirs.
    'try{var _wlDesc=Object.getOwnPropertyDescriptor(Window.prototype,"location")||Object.getOwnPropertyDescriptor(window,"location");',
    'if(_wlDesc&&_wlDesc.set){',
    'var _oWLSet=_wlDesc.set,_oWLGet=_wlDesc.get;',
    'try{Object.defineProperty(window,"location",{configurable:true,get:function(){return _oWLGet?_oWLGet.call(this):_loc},set:function(v){if(_isAdRedirect(v)){try{console.debug("[ab] blocked window.location=:",v)}catch(e){}return}return _oWLSet.call(this,v)}})}catch(e){}}}catch(e){}',
    // document.location setter
    'try{var _dlDesc=Object.getOwnPropertyDescriptor(Document.prototype,"location")||Object.getOwnPropertyDescriptor(document,"location");',
    'if(_dlDesc&&_dlDesc.set){var _oDLSet=_dlDesc.set,_oDLGet=_dlDesc.get;',
    'try{Object.defineProperty(document,"location",{configurable:true,get:function(){return _oDLGet?_oDLGet.call(this):_loc},set:function(v){if(_isAdRedirect(v)){try{console.debug("[ab] blocked document.location=:",v)}catch(e){}return}return _oDLSet.call(this,v)}})}catch(e){}}}catch(e){}',
    '_loc.__rhLocGuard=true;',
    '}catch(e){}}',
    // Install now AND after hammerhead init so our guard sits on top
    '_installLocGuard();',
    'setTimeout(_installLocGuard,0);',
    'setTimeout(_installLocGuard,100);',
    'setTimeout(_installLocGuard,500);',
    // Guard window.open-style programmatic form submissions that some popunder networks
    // use to bypass window.open checks (form.target="_blank", form.action=adUrl, form.submit()).
    'try{var _oFormSubmit=HTMLFormElement.prototype.submit;',
    'HTMLFormElement.prototype.submit=function(){try{var a=this.action||"";var t=(this.target||"").toLowerCase();if(_isAdRedirect(a)&&(t==="_blank"||t==="_new"||t==="_top"||t==="")){try{console.debug("[ab] blocked form.submit ad:",a)}catch(e){}return}}catch(e){}return _oFormSubmit.apply(this,arguments)};}catch(e){}',
    '}catch(e){}',
    // --- META-REFRESH STRIPPING ---
    // Remove <meta http-equiv="refresh" content="0; url=..."> that redirects to ads.
    'try{function _stripMetaRefresh(){',
    'var ms=document.querySelectorAll("meta[http-equiv]");',
    'for(var i=0;i<ms.length;i++){var m=ms[i];',
    'if((m.httpEquiv||m.getAttribute("http-equiv")||"").toLowerCase()!=="refresh")continue;',
    'var c=m.getAttribute("content")||"";',
    'var um=c.match(/url\\s*=\\s*([^;]+)/i);',
    'if(um&&_blockedHosts&&_blockedHosts.test(um[1])){',
    'try{console.debug("[ab] stripped meta-refresh:",um[1]);m.remove()}catch(e){}}}}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_stripMetaRefresh);',
    'else _stripMetaRefresh();',
    '}catch(e){}',
    // --- ANTI-ADBLOCK / WALLPAPER AD GUARD ---
    // Some sites hide content behind a full-page ad wall when adblock is detected.
    // We spoof common ad-detection primitives so those walls stay down.
    'try{window.canRunAds=true;window.adblockDetected=false;window.adsbygoogle=window.adsbygoogle||[];',
    'window.adsbygoogle.push=function(){return 1};',
    'Object.defineProperty(window.adsbygoogle,"loaded",{value:true,configurable:true});',
    'window.googletag=window.googletag||{cmd:[],pubads:function(){return{addEventListener:function(){},refresh:function(){},enableSingleRequest:function(){},collapseEmptyDivs:function(){}}},defineSlot:function(){return{addService:function(){return this},setTargeting:function(){return this}}},display:function(){},enableServices:function(){}};',
    'window.googletag.apiReady=true;window.googletag.pubadsReady=true;',
    'try{Object.defineProperty(window,"_gaq",{value:{push:function(){}},writable:false})}catch(e){}',
    // Spoof common "is adblock on" detection stubs: most popular detection libraries check these
    'try{window.CookieConsent=window.CookieConsent||{};}catch(e){}',
    'try{window.blockAdBlock={setOption:function(){return this},onDetected:function(){return this},onNotDetected:function(cb){try{typeof cb==="function"&&cb()}catch(e){}return this},check:function(){return this},emitEvent:function(){return this}};',
    'window.BlockAdBlock=window.blockAdBlock;',
    'window.FuckAdBlock=function(){return window.blockAdBlock};',
    'window.fuckAdBlock=window.blockAdBlock;',
    'window.adblock=false;window.adblocker=false;window.adBlockEnabled=false;',
    '}catch(e){}',
    '}catch(e){}',
    // --- ADBLOCK BAIT-ELEMENT DETECTION BYPASS ---
    // Many sites create hidden "bait" divs with class/id hinting at ads (adsbox,
    // ad-container, advertisement, etc.) and test whether offsetHeight==0 or
    // getComputedStyle(el).display==="none" to infer "adblock present" and show
    // a paywall. Our CSS hides those with display:none (which WOULD give 0 height).
    // To spoof detection, we tag each matching element as it appears, override
    // its own offsetHeight/clientHeight/offsetParent to truthy values, and hook
    // window.getComputedStyle to return display!=="none" for those elements.
    'try{var _BAIT_RE=/(^|\\s|-|_)(adsbox|adsbygoogle|ad-container|ad_container|ad-banner|adbanner|banner_ad|banner-ad|ad-wrapper|advertisement|ad-bait|ad_bait|ad-sense|adsense|sponsored-content|googlead)(\\s|-|_|$)/i;',
    'function _looksLikeBait(el){try{if(!el||el.nodeType!==1)return false;var c=(el.className&&el.className.toString)?el.className.toString():"";var i=(el.id||"")+"";return _BAIT_RE.test(c)||_BAIT_RE.test(i)}catch(e){return false}}',
    'var _oOffH=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"offsetHeight");',
    'var _oOffW=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"offsetWidth");',
    'var _oOffP=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"offsetParent");',
    'var _oCliH=Object.getOwnPropertyDescriptor(Element.prototype,"clientHeight");',
    'var _oCliW=Object.getOwnPropertyDescriptor(Element.prototype,"clientWidth");',
    'var _oGBC=Element.prototype.getBoundingClientRect;',
    'var _oCompS=window.getComputedStyle;',
    'function _spoofBait(el){try{Object.defineProperty(el,"offsetHeight",{configurable:true,get:function(){return 100}});',
    'Object.defineProperty(el,"offsetWidth",{configurable:true,get:function(){return 160}});',
    'Object.defineProperty(el,"clientHeight",{configurable:true,get:function(){return 100}});',
    'Object.defineProperty(el,"clientWidth",{configurable:true,get:function(){return 160}});',
    'Object.defineProperty(el,"offsetParent",{configurable:true,get:function(){return document.body||document.documentElement}});',
    'var _oElGBC=el.getBoundingClientRect;el.getBoundingClientRect=function(){return{top:0,left:0,right:160,bottom:100,width:160,height:100,x:0,y:0,toJSON:function(){return this}}};',
    'el.__rhBaitSpoofed=true}catch(e){}}',
    'window.getComputedStyle=function(el,ps){var cs=_oCompS.call(this,el,ps);',
    'try{if(el&&el.__rhBaitSpoofed){return new Proxy(cs,{get:function(t,k){if(k==="display")return"block";if(k==="visibility")return"visible";if(k==="opacity")return"1";if(k==="height")return"100px";if(k==="width")return"160px";var v=t[k];return typeof v==="function"?v.bind(t):v}})}}catch(e){}return cs};',
    // Scan existing DOM now + observe for new bait elements
    'function _scanBait(){try{document.querySelectorAll("[class*=\\"ads\\"],[id*=\\"ads\\"],[class*=\\"ad-\\"],[id*=\\"ad-\\"],[class*=\\"banner\\"],[id*=\\"banner\\"],[class*=\\"sponsor\\"],ins.adsbygoogle").forEach(function(el){if(_looksLikeBait(el)&&!el.__rhBaitSpoofed)_spoofBait(el)})}catch(e){}}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_scanBait);else _scanBait();',
    'new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var an=muts[i].addedNodes;for(var j=0;j<an.length;j++){var n=an[j];if(_looksLikeBait(n)&&!n.__rhBaitSpoofed)_spoofBait(n)}}}).observe(document.documentElement||document,{childList:true,subtree:true});',
    '}catch(e){}',
    // --- YOUTUBE AD SKIPPER ---
    // If the page is YouTube, watch for ad-showing state and either skip or fast-forward.
    'try{if(/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)){',
    'var _ytSkip=function(){',
    // Click skip button whenever it appears
    'try{var sb=document.querySelector(".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button");',
    'if(sb&&typeof sb.click==="function"){sb.click();return}}catch(e){}',
    // Otherwise, fast-forward to end of ad video
    'try{if(document.querySelector(".ad-showing")){',
    'var v=document.querySelector("video.html5-main-video");',
    'if(v&&isFinite(v.duration)&&v.duration>0){v.currentTime=Math.max(v.duration-0.1,0);v.muted=true;v.playbackRate=16}}}catch(e){}',
    // Remove companion / masthead ads
    'try{["ytd-display-ad-renderer","ytd-companion-slot-renderer","ytd-promoted-sparkles-web-renderer","ytd-action-companion-ad-renderer","ytd-promoted-video-renderer","ytd-ad-slot-renderer","ytd-in-feed-ad-layout-renderer","ytd-banner-promo-renderer","ytd-statement-banner-renderer","#masthead-ad",".ytp-ad-overlay-container"].forEach(function(s){document.querySelectorAll(s).forEach(function(e){e.remove()})})}catch(e){}',
    '};',
    'setInterval(_ytSkip,500);',
    'new MutationObserver(_ytSkip).observe(document.documentElement,{childList:true,subtree:true});',
    '}}catch(e){}',
    // --- EMPTY AD-CONTAINER COLLAPSER ---
    // Even after CSS hiding, some sites reserve huge blank slots for failed ads.
    // Collapse empty common ad containers post-load.
    'try{function _collapseAds(){',
    'var sel=["ins.adsbygoogle","[data-ad-slot]","[data-ad-unit]","[data-google-query-id]","[class*=\\"ad-slot\\"]","[class*=\\"adslot\\"]","[id*=\\"adSlot\\"]","[id*=\\"ad-slot\\"]"];',
    'sel.forEach(function(s){document.querySelectorAll(s).forEach(function(e){',
    'if(e.childElementCount===0&&(!e.textContent||e.textContent.trim().length===0)){',
    'e.style.setProperty("display","none","important")}})})}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_collapseAds);',
    'else _collapseAds();',
    'new MutationObserver(function(){_collapseAds()}).observe(document.documentElement||document,{childList:true,subtree:true});',
    '}catch(e){}',
    // --- COOKIE CONSENT / PAYWALL / SUBSCRIBE-WALL HIDER ---
    // Many news sites wrap their content behind a "Accept cookies to continue" or
    // "Subscribe to read" modal that disables body scroll. Element-hiding alone is
    // not enough — we also have to restore scroll on <body>/<html> because the
    // banner scripts set overflow:hidden and position:fixed on the scroll container.
    // Selectors below cover the most-common CMPs + paywall CMPs.
    'try{var _CONSENT_SEL=[',
    '"#onetrust-consent-sdk","#onetrust-banner-sdk","#onetrust-pc-sdk",".onetrust-pc-dark-filter",',
    '"#CybotCookiebotDialog","#CybotCookiebotDialogBodyUnderlay","#CookiebotWidget",',
    '".fc-consent-root",".fc-dialog-container",".fc-dialog-overlay",',
    '"#cmpbox","#cmpbox2","#cmpwrapper","#cmpcontainer","#cmpbase",',
    '".qc-cmp2-container",".qc-cmp-cleanslate",".qc-cmp2-persistent-link",',
    '".eu-cookie-compliance",".eu-cookie-compliance-banner",".eu-cookie-withdraw-tab",',
    '"#cookie-banner","#cookieBanner","#cookie-consent","#cookie-notice","#cookieChoiceInfo",',
    '".cky-overlay",".cky-modal",".cky-consent-container",".cky-consent-bar",',
    '".cc-window",".cc-banner",".cc-compliance",".cookie-law-info-bar",',
    '"#truste-consent-track","#truste-consent-button",".truste_overlay",".truste_box_overlay",',
    '"#usercentrics-root",".uc-banner-wrapper",',
    '".didomi-popup-container","#didomi-notice","#didomi-host",',
    '".evidon-banner",".evidon-barrier",".evidon-background",',
    '".sp_veil",".sp_message_container",".sp-message-open",".message-container",',
    '"#popup-buttons","#popup-text","#popup-title","#accept-choices",',
    // Subscribe-walls / Paywalls
    '".tp-modal",".tp-backdrop",".tp-iframe-wrapper",',
    '".piano-id-login-dialog",".piano-offer-template-container",',
    '".poool-widget",".poool-lock",".poool-widget-layer",',
    '".piano-widget-container",".pane-locked",".piano-paywall-container",',
    '".subscription-wall",".paywall",".paywall-overlay",".paywall-container","#paywall",',
    '".premium-gate",".premium-article-gate",".premium-content-gate",',
    '".article-paywall","#paywall-container",".paywall-dialog",',
    '".nyt-paywall",".css-mcm29f",".fc-article-ad",',
    '"#bx-slab-message-container-modal","#bx-slab-message-container",',
    // Subscribe push / newsletter popups
    '".subscribe-push-modal",".push-subscribe-modal",".notification-permission-container",',
    '".newsletter-popup",".newsletter-modal",".mailmunch-template-container",',
    '".sumolib-overlay",".sumo-overlay",".popup-maker-popup",".pum-container",',
    '".optinmonster-html",".optinmonster-overlay",".popmake-overlay",',
    '".klaviyo-form",".klaviyo-overlay","[data-testid=\\"signup-overlay\\"]",',
    // Medium / Substack / Quora clap-walls / login-walls
    '".meteredContent",".tierthreeWall",".overlay-content",".bg-white.fixed.inset-0",',
    '".qu-screenReaderAccessibilityText + .paywall",',
    // Role-based matches (covers custom-named dialogs)
    '"[role=\\"dialog\\"][aria-label*=\\"subscribe\\" i]",',
    '"[role=\\"dialog\\"][aria-label*=\\"paywall\\" i]",',
    '"[role=\\"dialog\\"][aria-label*=\\"cookie\\" i]",',
    '"[role=\\"dialog\\"][aria-label*=\\"consent\\" i]",',
    '"[role=\\"dialog\\"][aria-label*=\\"newsletter\\" i]",',
    '"[role=\\"dialog\\"][aria-label*=\\"sign up\\" i]",',
    '"[aria-labelledby*=\\"paywall\\" i]","[aria-labelledby*=\\"consent\\" i]",',
    '"[class*=\\"CookieConsent\\" i]","[id*=\\"CookieConsent\\" i]",',
    '"[class*=\\"cookie-consent\\"]","[id*=\\"cookie-consent\\"]",',
    '"[class*=\\"consent-banner\\"]","[id*=\\"consent-banner\\"]",',
    '"[class*=\\"gdpr-notice\\"]","[id*=\\"gdpr-notice\\"]"',
    '].join(",");',
    'var _s=document.createElement("style");_s.id="_c_css";',
    '_s.textContent=_CONSENT_SEL+"{display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;}"+',
    // Restore scroll when CMPs lock the body
    '"html,body{overflow:visible!important;}html.no-scroll,body.no-scroll,body.modal-open,html.modal-open,body.is-locked,body.overlay-open,body.stop-scroll,body.fixed-body,body.lock-scroll,html.lock-scroll,body.scroll-lock,html.scroll-lock{overflow:auto!important;position:static!important;}";',
    'try{(document.head||document.documentElement).appendChild(_s)}catch(e){}',
    // Imperative scroll-restore (some sites re-lock body every click)
    'function _unlockScroll(){try{',
    'var b=document.body;if(b){',
    'var cls=["modal-open","no-scroll","is-locked","overlay-open","stop-scroll","fixed-body","lock-scroll","scroll-lock","noscroll"];',
    'for(var i=0;i<cls.length;i++){if(b.classList&&b.classList.contains(cls[i]))b.classList.remove(cls[i])}',
    // Inline styles take priority. Only override if they actively block scroll.
    'var cs=getComputedStyle(b);',
    'if(cs.overflow==="hidden"||cs.overflowY==="hidden"){b.style.setProperty("overflow","auto","important");b.style.setProperty("overflow-y","auto","important")}',
    'if(cs.position==="fixed"){b.style.setProperty("position","static","important");b.style.setProperty("top","auto","important")}}',
    'var h=document.documentElement;if(h){',
    'var cls2=["no-scroll","modal-open","lock-scroll","scroll-lock","noscroll"];',
    'for(var j=0;j<cls2.length;j++){if(h.classList&&h.classList.contains(cls2[j]))h.classList.remove(cls2[j])}',
    'var ch=getComputedStyle(h);',
    'if(ch.overflow==="hidden"||ch.overflowY==="hidden"){h.style.setProperty("overflow","auto","important");h.style.setProperty("overflow-y","auto","important")}}',
    '}catch(e){}}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_unlockScroll);else _unlockScroll();',
    // Re-check every second; paywalls re-apply locks on route change / timer
    'setInterval(_unlockScroll,1500);',
    // Also when any ancestor class changes, re-unlock
    'try{new MutationObserver(_unlockScroll).observe(document.documentElement,{attributes:true,attributeFilter:["class","style"],subtree:true});}catch(e){}',
    '}catch(e){}',
    '})();',
    '</script>',
].join('\n');

const ANTIDETECT_SCRIPT = [
    '<script>',
    '(function(){',
    // ── Anti-Smart-Agent DOM hardening ──────────────────────────────────────
    // Lightspeed Smart Agent (and similar JS-based content scanners) inspect
    // the proxied page from inside. The strongest fingerprint they have is
    // an unusual `window` keyset: any property that starts with a known proxy
    // prefix (`__rh*`) immediately gives us away.
    //
    // We pre-declare every name we plan to write as a NON-ENUMERABLE data
    // property up front. Later assignments via simple `=` keep the existing
    // descriptor's `enumerable:false` (per the spec — `[[Set]]` on an existing
    // data property only updates `[[Value]]`), so `Object.keys(window)` /
    // `for...in` / JSON.stringify(window) reveal nothing. Direct access via
    // `window.__rhQ` still works, so devtools.js + the inject scripts remain
    // unchanged. A determined scanner using `Reflect.ownKeys` or
    // `Object.getOwnPropertyNames` could still see them, but that's a much
    // rarer probe and worth defending against in tier 2.
    'try{["__rhAD","__rhABinit","__rhC","__rhQ","__rhNet","__rhSrc","__rhPanel",',
    '"__rhListeners","__rhTimerCount","__rhPerf","__rhDestUrl","__rhDevTools"].forEach(function(n){',
        'try{var d=Object.getOwnPropertyDescriptor(window,n);',
        'if(!d){Object.defineProperty(window,n,{value:undefined,configurable:true,writable:true,enumerable:false})}',
        'else if(d.enumerable){Object.defineProperty(window,n,{value:d.value,configurable:true,writable:d.writable!==false,enumerable:false})}',
        '}catch(_){}',
    '})}catch(e){}',
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
    'try{Object.defineProperty(document,"referrer",{get:function(){return ""},configurable:true})}catch(e){}',
    'try{Object.defineProperty(window,"%hammerhead%",{enumerable:false,configurable:true,writable:true,value:void 0})}catch(e){}',
    'try{Object.defineProperty(window,"%is-hammerhead%",{enumerable:false,configurable:true,writable:true,value:void 0})}catch(e){}',
    // Unconditional top/parent/self spoof so anti-iframe guards (TurboWarp, ad networks, etc.)
    // see top === self === parent even when hammerhead\'s own wrapping is still settling.
    'try{Object.defineProperty(window,"top",{get:function(){return window.self},configurable:true});Object.defineProperty(window,"parent",{get:function(){return window.self},configurable:true});Object.defineProperty(window,"frameElement",{get:function(){return null},configurable:true});}catch(e){}',
    'try{if(typeof crypto!=="undefined"&&!crypto.randomUUID){crypto.randomUUID=function(){var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;var h="";for(var i=0;i<16;i++){h+=(b[i]<16?"0":"")+b[i].toString(16);if(i===3||i===5||i===7||i===9)h+="-"}return h}}}catch(e){}',
    'try{if(!window.__tcfapi){window.__tcfapi=function(cmd,ver,cb){if(typeof cb==="function"){cb({cmpId:0,cmpVersion:0,gdprApplies:false,tcfPolicyVersion:2,cmpStatus:"error",eventStatus:"cmpuishown",tcString:"",isServiceSpecific:true,purposeOneTreatment:false,publisherCC:"US"},false)}}}}catch(e){}',
    // Fix cross-origin postMessage for captcha widgets (hCaptcha, reCAPTCHA, Turnstile, etc.).
    // In a proxy, both the parent page and the captcha iframe share the proxy origin, but the
    // captcha JS calls parent.postMessage(token, "https://discord.com") with the *real* target
    // origin. This silently fails because the parent\'s actual origin is the proxy host. We
    // intercept postMessage and relax the targetOrigin to "*" when it would mismatch, while
    // preserving same-origin calls as-is. This is safe because we already run in a proxy
    // context where all frames share the same origin anyway.
    'try{var _oPM=window.postMessage.bind(window);',
    'window.postMessage=function(msg,tgt){',
        'if(typeof tgt==="string"&&tgt!=="*"&&tgt.indexOf(location.protocol+"//"+location.host)!==0){tgt="*"}',
        'return _oPM(msg,tgt)};',
    'var _oPM2=Window.prototype.postMessage;',
    'Window.prototype.postMessage=function(msg,tgt){',
        'var self=this;try{var loc=self.location;var cur=loc.protocol+"//"+loc.host}catch(e){cur=""}',
        'if(typeof tgt==="string"&&tgt!=="*"&&cur&&tgt.indexOf(cur)!==0){tgt="*"}',
        'return _oPM2.call(self,msg,tgt)};',
    '}catch(e){}',
    // Browser extensions (SingleFile, AdBlock, password managers, ...) inject content scripts
    // into every page including proxied ones. When their background page is gone or filtered,
    // chrome.runtime.sendMessage()/connect() rejects with one of a small set of canned messages
    // ("Could not establish connection. Receiving end does not exist." /
    //  "The message port closed before a response was received." /
    //  "Extension context invalidated."). The extensions almost never .catch() these, so the
    // browser logs them as "Uncaught (in promise)" on every navigation, polluting the user\'s
    // console and confusing them into thinking the proxy is broken. Swallow them at the
    // unhandledrejection layer — we never produce these strings ourselves, so this filter is
    // 100% safe for page code.
    'try{var _rhExtRe=/Could not establish connection|Receiving end does not exist|message port closed|Extension context invalidated/i;',
    'window.addEventListener("unhandledrejection",function(e){',
        'try{var r=e.reason;var m=r&&(r.message||r.toString&&r.toString())||(typeof r==="string"?r:"");',
        'if(m&&_rhExtRe.test(m)){e.preventDefault();if(e.stopImmediatePropagation)try{e.stopImmediatePropagation()}catch(_){}}}catch(_){}',
    '},true);',
    'window.addEventListener("error",function(e){',
        'try{var m=e&&(e.message||(e.error&&e.error.message))||"";',
        'if(m&&_rhExtRe.test(m)){e.preventDefault();if(e.stopImmediatePropagation)try{e.stopImmediatePropagation()}catch(_){}}}catch(_){}',
    '},true);',
    '}catch(e){}',
    '})();</script>',
].join('\n');

const DEVTOOLS_SCRIPT = `<script>(function(){
if(typeof window==="undefined"||window.__rhC)return;window.__rhC=1;
window.__rhQ=[];window.__rhNet=[];window.__rhSrc=[];
window.__rhPanel=null;window.__rhListeners=0;
window.__rhTimerCount={timeout:0,interval:0};
var _oC=window.console||{},_srcSeen={},_groupDepth=0;
var _proxyRe=/\\/[a-z0-9]{32}(?:![a-z]*)?\\/((https?):\\/\\/.+)/i;
function _cleanUrl(u){if(!u)return u;var m=(""+u).match(_proxyRe);return m?m[1]:""+u}
["log","warn","error","info","debug"].forEach(function(m){
var o=_oC[m]||function(){};
_oC[m]=function(){try{o.apply(_oC,arguments)}catch(e){}
var raw=[];for(var i=0;i<arguments.length;i++)raw.push(arguments[i]);
var entry={l:m,raw:raw,t:Date.now(),d:_groupDepth};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}}});
var _origTable=_oC.table;
_oC.table=function(data,cols){try{if(_origTable)_origTable.apply(_oC,arguments)}catch(e){}
var entry={l:"table",raw:[data,cols],t:Date.now(),d:_groupDepth};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}};
_oC.group=_oC.groupCollapsed=function(){var raw=[];for(var i=0;i<arguments.length;i++)raw.push(arguments[i]);
var entry={l:"group",raw:raw,t:Date.now(),d:_groupDepth};_groupDepth++;
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}};
_oC.groupEnd=function(){if(_groupDepth>0)_groupDepth--;window.__rhQ.push({l:"groupEnd",t:Date.now(),d:_groupDepth})};
var _cTimers={};
_oC.time=function(l){_cTimers[l||"default"]=performance.now()};
_oC.timeEnd=function(l){l=l||"default";var s=_cTimers[l];if(s!==undefined){delete _cTimers[l];
var entry={l:"log",raw:[l+": "+(performance.now()-s).toFixed(3)+"ms"],t:Date.now(),d:_groupDepth};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}}};
_oC.timeLog=function(l){l=l||"default";var s=_cTimers[l];if(s!==undefined){var entry={l:"log",raw:[l+": "+(performance.now()-s).toFixed(3)+"ms"],t:Date.now(),d:_groupDepth};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}}};
var _cCounts={};
_oC.count=function(l){l=l||"default";_cCounts[l]=(_cCounts[l]||0)+1;
var entry={l:"log",raw:[l+": "+_cCounts[l]],t:Date.now(),d:_groupDepth};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e){}};
_oC.countReset=function(l){_cCounts[l||"default"]=0};
var _origClear=_oC.clear;_oC.clear=function(){try{if(_origClear)_origClear.call(_oC)}catch(e){}
window.__rhQ.length=0;if(window.__rhPanel)try{window.__rhPanel.clear()}catch(e){}};
window.console=_oC;
window.addEventListener("error",function(e){if(e.defaultPrevented)return;var msg=e.error?(e.error.stack||e.error.message):e.message;
var entry={l:"error",raw:["[Uncaught] "+(msg||"Unknown error")],t:Date.now(),d:0};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e2){}});
window.addEventListener("unhandledrejection",function(e){if(e.defaultPrevented)return;var r=e.reason;
var entry={l:"error",raw:["[Promise] "+(r&&r.stack?r.stack:String(r))],t:Date.now(),d:0};
window.__rhQ.push(entry);if(window.__rhPanel)try{window.__rhPanel.log(entry)}catch(e2){}});
if(typeof fetch==="function"){var _oF=fetch;window.fetch=function(){var a=arguments,u="",m="GET",rh={},st=Date.now();
try{if(typeof a[0]==="string")u=a[0];else if(a[0]&&a[0].url)u=a[0].url;
if(a[1]){if(a[1].method)m=a[1].method;var h=a[1].headers;if(h){if(h instanceof Headers)h.forEach(function(v,k){rh[k]=v});
else if(typeof h==="object")for(var k in h)rh[k]=h[k]}}}catch(e){}
var entry={m:m,u:_cleanUrl(u),s:0,tp:"fetch",t0:st,t1:0,reqH:rh,resH:{},sz:0};
window.__rhNet.push(entry);if(window.__rhPanel)try{window.__rhPanel.net(entry)}catch(e){}
return _oF.apply(this,a).then(function(r){entry.s=r.status;entry.t1=Date.now();
try{r.headers.forEach(function(v,k){entry.resH[k]=v});var ct=r.headers.get("content-type");if(ct)entry.ct=ct.split(";")[0];
var cl=r.headers.get("content-length");if(cl)entry.sz=parseInt(cl,10)||0}catch(e){}
if(window.__rhPanel)try{window.__rhPanel.netUpdate(entry)}catch(e){}return r},
function(e){entry.s=-1;entry.t1=Date.now();if(window.__rhPanel)try{window.__rhPanel.netUpdate(entry)}catch(e2){}throw e})}}
if(typeof XMLHttpRequest!=="undefined"){var _oXO=XMLHttpRequest.prototype.open,_oXS=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){this.__rhM=m;this.__rhU=""+u;this.__rhT0=Date.now();this.__rhRH={};return _oXO.apply(this,arguments)};
var _oSRH=XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{this.__rhRH[k]=v}catch(e){}return _oSRH.apply(this,arguments)};
XMLHttpRequest.prototype.send=function(){var x=this,entry={m:x.__rhM||"GET",u:_cleanUrl(x.__rhU||""),s:0,tp:"xhr",t0:x.__rhT0||Date.now(),t1:0,reqH:x.__rhRH||{},resH:{},sz:0};
window.__rhNet.push(entry);if(window.__rhPanel)try{window.__rhPanel.net(entry)}catch(e){}
x.addEventListener("loadend",function(){entry.s=x.status;entry.t1=Date.now();
try{var h=x.getAllResponseHeaders()||"";h.split("\\r\\n").forEach(function(l){var p=l.indexOf(":");if(p>0)entry.resH[l.slice(0,p).trim().toLowerCase()]=l.slice(p+1).trim()});
entry.ct=(entry.resH["content-type"]||"").split(";")[0];
var cl=entry.resH["content-length"];if(cl)entry.sz=parseInt(cl,10)||0;else try{entry.sz=x.response?x.response.length||0:0}catch(e){}}catch(e){}
if(window.__rhPanel)try{window.__rhPanel.netUpdate(entry)}catch(e){}});return _oXS.apply(this,arguments)}}
try{var _oAEL=EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener=function(){window.__rhListeners++;return _oAEL.apply(this,arguments)}}catch(e){}
var _oST=window.setTimeout,_oSI=window.setInterval;
window.setTimeout=function(){window.__rhTimerCount.timeout++;return _oST.apply(this,arguments)};
window.setInterval=function(){window.__rhTimerCount.interval++;return _oSI.apply(this,arguments)};
window.__rhPerf={lcp:0,cls:0,fid:0,fcp:0,ttfb:0,inp:0};
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){window.__rhPerf.lcp=e.startTime})}).observe({type:"largest-contentful-paint",buffered:true})}catch(e){}
try{var _clsVal=0;new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput){_clsVal+=e.value;window.__rhPerf.cls=_clsVal}})}).observe({type:"layout-shift",buffered:true})}catch(e){}
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){window.__rhPerf.fid=e.processingStart-e.startTime})}).observe({type:"first-input",buffered:true})}catch(e){}
try{new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.name==="first-contentful-paint")window.__rhPerf.fcp=e.startTime})}).observe({type:"paint",buffered:true})}catch(e){}
function _addSrc(url,type){url=_cleanUrl(url);if(!url||typeof url!=="string"||_srcSeen[url])return;_srcSeen[url]=1;window.__rhSrc.push({u:url,tp:type})}
function _scanDOM(){try{document.querySelectorAll("script[src]").forEach(function(e){_addSrc(e.src,"js")})}catch(e){}
try{document.querySelectorAll("link[rel=stylesheet]").forEach(function(e){_addSrc(e.href,"css")})}catch(e){}
try{document.querySelectorAll("img[src]").forEach(function(e){_addSrc(e.src,"img")})}catch(e){}
try{document.querySelectorAll("link[rel*=icon]").forEach(function(e){_addSrc(e.href,"icon")})}catch(e){}
try{document.querySelectorAll("video source[src],audio source[src]").forEach(function(e){_addSrc(e.src,"media")})}catch(e){}
try{document.querySelectorAll("link[as=font],link[rel=preload][href*=font]").forEach(function(e){_addSrc(e.href,"font")})}catch(e){}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",_scanDOM);else _scanDOM();
var _s=document.createElement("script");_s.src="/_a/d.js";_s.defer=true;_s.onerror=function(){var _f=document.createElement("script");_f.src="/__rh_devtools.js";_f.defer=true;document.head.appendChild(_f)};
if(document.head)document.head.appendChild(_s);
else document.addEventListener("DOMContentLoaded",function(){document.head.appendChild(_s)});
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

/**
 * Domain-leak hardening for Hammerhead-processed bodies.
 *
 * Hammerhead's `getProxyUrl` always emits ABSOLUTE URLs of the form
 * `<proxy-origin>/<sid>/<destination>` — i.e. the proxy's hostname is hard-coded
 * into every rewritten attribute and inline-script string. This makes a content
 * scanner's job trivial: grep for "rammerhead.fly.dev" (or whatever our deployed
 * hostname is) and you fingerprint the proxy.
 *
 * After Hammerhead's processor runs we sweep its output and rewrite every
 * occurrence of "<proxy-origin>/<sid>/" → "/<sid>/" — a DOMAIN-RELATIVE path.
 * Browsers resolve domain-relative URLs against `document.baseURI`, which is
 * itself the proxy origin, so the rewrite is functionally a no-op. The served
 * bytes, however, no longer contain the proxy hostname literally.
 *
 * We deliberately scope the rewrite to "<proxy-origin>/<sid>/" (not bare
 * "<proxy-origin>") to avoid touching unrelated proxy-internal asset URLs and
 * script literals that don't belong to the proxied page.
 */
// Read the configured URL path-style once. When non-empty (e.g. "cdn-cgi/p"),
// every domain-relative proxy URL in the served body gets prefixed with it,
// turning `/<sid>/<dest>` into `/cdn-cgi/p/<sid>/<dest>` so the URL bar (and
// any URL-pattern filter) sees a CDN-shaped path instead of the tell-tale
// 32-char hex session ID. See config.js for the full rationale.
const _PATH_STYLE = (require('../config').pathStyle || '').replace(/^\/+|\/+$/g, '');
const _PATH_PREFIX = _PATH_STYLE ? '/' + _PATH_STYLE : '';

function _stripProxyOriginFromBody(body, ctx) {
    if (!body || typeof body !== 'string') return body;
    const sid = ctx && ctx.session && ctx.session.id;
    if (!sid) return body;

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
            origins.add('//' + hostHdr);
        }
        const origHdr = ctx.req.headers['x-forwarded-host'];
        if (origHdr) {
            const proto = ctx.req.headers['x-forwarded-proto'] || 'https';
            origins.add(proto + '://' + origHdr);
        }
    }

    const sidEsc = sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let out = body;
    for (const o of origins) {
        if (!o) continue;
        const oEsc = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the proxy origin in two safe contexts:
        //   1. before "/<sid>" — the rewritten proxy URLs for the destination
        //   2. before "/_a/"   — proxy-internal asset paths Hammerhead injects
        //      into <script>/<link> tags (hammerhead.js, transport, task,
        //      rammerhead.js, console, ad-blocker, etc.)
        // Every match is followed by a path that resolves to the proxy itself,
        // so domain-relative URLs are functionally identical to absolute ones.
        // Replacement is _PATH_PREFIX (default "") so configured pathStyle gets
        // injected in one pass: <origin>/<sid>/ → /<prefix>/<sid>/.
        const re = new RegExp(oEsc + '(?=/(?:' + sidEsc + '|_a/))', 'g');
        out = out.replace(re, _PATH_PREFIX);
    }
    return out;
}

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
    'gimkit.com',
    'turbowarp.org',
    'chat.deepseek.com',
    'deepseek.com',
    'jmail.world',
    'mk48.io',
]);
const LITE_DOMAINS_SUFFIX = [
    '.chatgpt.com',
    '.openai.com',
    '.oaistatic.com',
    '.oaiusercontent.com',
    '.claude.ai',
    '.anthropic.com',
    '.claudeusercontent.com',
    '.poki.com',
    '.poki-cdn.com',
    '.bilibili.com',
    '.bilibili.cn',
    '.hdslb.com',
    '.bilivideo.com',
    '.bilivideo.cn',
    '.biliapi.net',
    '.biliapi.com',
    '.szbdyd.com',
    '.doubao.com',
    '.discord.com',
    '.discordapp.com',
    '.discord.gg',
    '.github.com',
    '.github.io',
    '.githubassets.com',
    '.githubusercontent.com',
    '.aliyun.com',
    '.alicdn.com',
    '.duckduckgo.com',
    '.qianwen.com',
    '.tongyi.aliyun.com',
    '.volccdn.com',
    '.volces.com',
    '.volcengine.com',
    '.ibytedtos.com',
    '.itch.io',
    '.itch.zone',
    '.hwcdn.net',
    '.gimkit.com',
    '.turbowarp.org',
    '.turbowarp.xyz',
    '.deepseek.com',
    '.deepseek.ai',
    '.jmail.world',
    '.mk48.io',
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

// Generic bot-challenge detection. Full hammerhead AST rewriting breaks the
// obfuscated JS in challenge pages (AWS WAF, Cloudflare, DataDome, Kasada, etc.).
// When we detect a challenge response we force lite processing so the browser can
// execute the challenge natively, get the token cookie, and reload.
function _isChallengeResponse(html, ctx) {
    if (!ctx || !ctx.destRes) return false;
    const status = ctx.destRes.statusCode;
    const headers = ctx.destRes.headers || {};

    // AWS WAF: 202 + x-amzn-waf-action: challenge
    if (status === 202 && (headers['x-amzn-waf-action'] || '').toLowerCase() === 'challenge') return true;

    // Cloudflare: 403/503 with cf-mitigated header or challenge-platform in body
    if ((status === 403 || status === 503) && headers['cf-mitigated'] === 'challenge') return true;

    // DataDome: 403 with x-datadome header
    if (status === 403 && headers['x-datadome']) return true;

    // Generic fallback: short HTML with known challenge SDK markers
    if (typeof html === 'string' && html.length < 60000) {
        if (/AwsWafIntegration|aws-waf-token|awswaf\.com/i.test(html)) return true;
        if (/challenge-platform.*?turnstile|turnstile.*?challenge-platform/i.test(html)) return true;
        if (/DataDome.*?captcha|dd\.js/i.test(html)) return true;
        if (/px-captcha|human-challenge|PerimeterX/i.test(html)) return true;
        if (/Kasada.*?challenge|ips\.js/i.test(html)) return true;
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
    // Domain-leak hardening: emit DOMAIN-RELATIVE prefixes ("/<sid>/...") instead of
    // ABSOLUTE prefixes ("https://<proxy-host>/<sid>/..."). Browsers resolve these
    // against the page's own origin (which IS the proxy origin), so the URLs are
    // functionally identical but the served HTML never contains the proxy hostname
    // as a literal string. \`proxyOrigin\` is still used below for the
    // "is this URL already proxied?" detection — a runtime comparison that never
    // appears in the served bytes.
    const relPrefix = '/' + sid + '/';

    // Single-pass rewrite for href/src/action/poster/data attributes, srcset, and CSS url()
    const ATTR_AND_URL_RE = /((?:href|src|action|poster|data)\s*=\s*["'])(\/\/[^"']+|\/(?!\/)[^"']*|https?:\/\/[^"']+)(["'])|(srcset\s*=\s*")([^"]*)(")|(url\(\s*['"]?)((?:https?:)?\/\/[^'")]+)(['"]?\s*\))/gi;
    html = html.replace(ATTR_AND_URL_RE, (_m, aPre, aUrl, aPost, ssPre, ssVal, ssPost, uPre, uUrl, uPost) => {
        if (aPre) {
            if (aUrl.startsWith('//')) return aPre + relPrefix + 'https:' + aUrl + aPost;
            if (/^https?:\/\//i.test(aUrl)) return aUrl.startsWith(proxyOrigin) ? _m : aPre + relPrefix + aUrl + aPost;
            if (origin && aUrl.startsWith('/')) return aPre + relPrefix + origin + aUrl + aPost;
            return _m;
        }
        if (ssPre) return ssPre + ssVal.replace(/((?:https?:)?\/\/[^\s,]+)/gi, u => {
            if (u.startsWith(proxyOrigin)) return u;
            if (u.startsWith('//')) return relPrefix + 'https:' + u;
            return relPrefix + u;
        }) + ssPost;
        if (uPre) {
            if (uUrl.startsWith(proxyOrigin)) return _m;
            if (uUrl.startsWith('//')) return uPre + relPrefix + 'https:' + uUrl + uPost;
            return uPre + relPrefix + uUrl + uPost;
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
                // Rewrite relative asset paths in string literals that dynamic import() or
                // framework routers use (can't be intercepted by the bridge script)
                body = body.replace(/(["'])(\/(?:cdn(?:-cgi)?|assets|static|_next|build|dist|chunks|bundles|js|css|media|fonts|images)\/[^"']+)(["'])/g,
                    (_m2, q1, path, q2) => q1 + relPrefix + origin + path + q2);
                // Rewrite import()/from/import statements in ALL scripts
                body = body.replace(/(import\(\s*["'])(\/[^"']+)(["']\s*\))/g,
                    (_m2, pre, path, post) => pre + relPrefix + origin + path + post);
                if (/type\s*=\s*["']module["']/i.test(open)) {
                    body = body.replace(/((?:^|[\s;,{(])import\s*["'])(\/[^"']+)(["'])/gm,
                        (_m2, pre, path, post) => pre + relPrefix + origin + path + post);
                    body = body.replace(/(from\s*["'])(\/[^"']+)(["'])/g,
                        (_m2, pre, path, post) => pre + relPrefix + origin + path + post);
                }
                return open + body + close;
            }
        );
    }

    const destUrl = ctx.dest.url || (origin + (ctx.dest.partAfterHost || '/'));

    const bridge = `<script>(function(){
// Domain-leak hardening: derive the proxy origin from \`location\` at runtime instead
// of embedding it as a literal string. This prevents content-scanners that grep the
// proxied page source for "rammerhead.fly.dev" / our deployed hostname from finding
// a hit. Functionally identical because every browser already exposes location.origin
// matching the proxy's origin (which is where the page is being served from).
var O=(typeof location!=='undefined'&&location.origin)||(location.protocol+'//'+location.host);
var S=${JSON.stringify(sid)},D=${JSON.stringify(destUrl)};
var _OP=O+'/';var _SP=_OP+S+'/';var _oGA=Element.prototype.getAttribute;var _sSA=Element.prototype.setAttribute;
// Clear any legacy __rh_sess cookie (removed to prevent cross-destination header leaks).
try{document.cookie='__rh_sess=; Max-Age=0; path=/'}catch(e){}
// ------- INFINITE RELOAD-LOOP GUARD -------
// Some SPAs (React Router, Remix, Next.js) call location.reload() when a dynamic
// import fails. If we have a bug that makes those imports keep failing, the page
// loops at multiple reloads/sec and pegs both the user's CPU and our server.
// We track recent reload timestamps in sessionStorage and, after seeing 4 reloads
// within 6 seconds, we no-op location.reload/replace/assign for 30 seconds. The
// user can still navigate manually; we just stop the runaway loop.
var _RH_RL_KEY='__rh_rl_'+S;var _RH_RL_BLOCK_KEY='__rh_rl_block_'+S;
var _rhBlocked=false;
try{
  var ss=window.sessionStorage;
  if(ss){
    var now=Date.now();
    var blockUntil=parseInt(ss.getItem(_RH_RL_BLOCK_KEY)||'0',10)||0;
    if(blockUntil&&now<blockUntil){_rhBlocked=true}
    else{
      var raw=ss.getItem(_RH_RL_KEY)||'[]';var arr=[];
      try{arr=JSON.parse(raw);if(!Array.isArray(arr))arr=[]}catch(e){arr=[]}
      arr.push(now);
      arr=arr.filter(function(t){return now-t<6000});
      if(arr.length>=4){
        ss.setItem(_RH_RL_BLOCK_KEY,String(now+30000));
        ss.removeItem(_RH_RL_KEY);
        _rhBlocked=true;
        try{console.warn('[nav] reload-loop detected ('+arr.length+' reloads in 6s); blocking reloads for 30s')}catch(e){}
      }else{
        ss.setItem(_RH_RL_KEY,JSON.stringify(arr));
      }
    }
  }
}catch(e){}
function px(u){return _SP+u}
function isExt(u){if(!u||typeof u!=='string')return false;u=u.trim();
return/^https?:\\/\\//i.test(u)&&u.indexOf(O)!==0}
function isProto(u){return typeof u==='string'&&u.length>2&&u.charCodeAt(0)===47&&u.charCodeAt(1)===47&&u.charCodeAt(2)!==47}
// Is this a proxy-internal route (e.g. /_a/cl, /__rh_console, /<sid>/...)? Don't rewrite those.
function _isProxyInternal(p){return p==='/'||p.indexOf('/__rh_')===0||p.indexOf('/_a/')===0||p.indexOf('/'+S+'/')===0||/^\\/[a-f0-9]{32}(\\/|!|$)/i.test(p)}
function rw(u){if(!u||typeof u!=='string')return u;u=u.trim();
if(u.indexOf(_SP)===0)return u;
if(u.indexOf(_OP)===0){
  // Naked proxy URL — strip proxy origin and treat the rest as a relative path on the destination.
  var rest=u.substring(O.length);
  if(_isProxyInternal(rest))return u;
  return pxRel(rest);
}
if(isProto(u))return px('https:'+u);if(isExt(u))return px(u);if(isRel(u))return pxRel(u);return u}
try{var du=new URL(D);var DO=du.origin;
window.__rhDestUrl=du.href;
function isRel(u){return typeof u==='string'&&u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf('/'+S+'/')!==0}
function pxRel(u){return O+'/'+S+'/'+DO+u}
function _destFromPath(p){var sp='/'+S+'/';if(!p||p.indexOf(sp)!==0)return null;var r=p.substring(sp.length);if(/^https?:\\/\\//i.test(r))return r;return null}
var _rl=window.location,_rr=_rl.replace.bind(_rl),_ra=_rl.assign.bind(_rl),_rrl=_rl.reload.bind(_rl);
function _rhSafeNav(fn,arg){if(_rhBlocked){try{console.warn('[nav] navigation blocked (reload-loop guard active)')}catch(e){}return}return fn(arg)}
var lp={href:{get:function(){return du.href},set:function(v){_rhSafeNav(_rr,rw(v)||v)}},
hostname:{get:function(){return du.hostname}},host:{get:function(){return du.host}},
origin:{get:function(){return du.origin}},protocol:{get:function(){return du.protocol}},
pathname:{get:function(){return du.pathname},set:function(v){_rhSafeNav(_rr,pxRel(v))}},
search:{get:function(){return du.search},set:function(v){du.search=v;_rhSafeNav(_rr,pxRel(du.pathname+v))}},
hash:{get:function(){return du.hash},set:function(v){du.hash=v}},
port:{get:function(){return du.port}},
assign:{value:function(u){_rhSafeNav(_ra,rw(u)||u)}},
replace:{value:function(u){_rhSafeNav(_rr,rw(u)||u)}},
reload:{value:function(){if(_rhBlocked){try{console.warn('[nav] reload blocked (reload-loop guard active)')}catch(e){}return}return _rrl.apply(_rl,arguments)}},
toString:{value:function(){return du.href}}};
var _locCache=null,_locHref='';
try{Object.defineProperty(window,'location',{configurable:true,enumerable:true,
get:function(){var h=du.href;if(_locCache&&_locHref===h)return _locCache;
var o=Object.create(null);for(var k in lp){try{Object.defineProperty(o,k,lp[k])}catch(e){}}
o[Symbol.toPrimitive]=function(){return du.href};_locCache=o;_locHref=h;return o},
set:function(v){_rhSafeNav(_rr,rw(''+v)||(''+v))}})}catch(e){}
try{Object.defineProperty(document,'location',{configurable:true,enumerable:true,
get:function(){return window.location},set:function(v){window.location=v}})}catch(e){}
try{Object.defineProperty(document,'domain',{get:function(){return du.hostname},set:function(){},configurable:true})}catch(e){}
try{Object.defineProperty(document,'referrer',{get:function(){return ''},configurable:true})}catch(e){}
var oF=window.fetch;if(oF)window.fetch=function(u,o){
if(typeof u==='string'){u=rw(u)}
else if(u&&typeof u==='object'&&u.url){var uu=u.url;
if(uu.indexOf(O)===0&&uu.indexOf(_OP+S+'/')!==0){uu=pxRel(uu.substring(O.length))}else{uu=rw(uu)}
if(uu!==u.url)try{u=new Request(uu,u)}catch(e){}}
return oF.call(this,u,o).then(function(r){
try{if(r.url&&r.url.indexOf(_SP)===0){Object.defineProperty(r,'url',{value:r.url.substring(_SP.length),configurable:true})}}catch(e){}
try{if(r.headers&&r.headers.has('x-remix-reload-document')){var h2=new Headers();r.headers.forEach(function(v,k){if(k!=='x-remix-reload-document')h2.append(k,v)});r=new Response(r.body,{status:r.status,statusText:r.statusText,headers:h2})}}catch(e){}
return r})};
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
if(typeof u==='string'){if(isExt(u)||isProto(u))u=rw(u);else if(isRel(u)){try{du=new URL(u,DO+'/')}catch(e){}window.__rhDestUrl=du.href;u=pxRel(u)}}return oPS(s,t,u)};
var oRS=history.replaceState.bind(history);history.replaceState=function(s,t,u){
if(typeof u==='string'){if(isExt(u)||isProto(u))u=rw(u);else if(isRel(u)){try{du=new URL(u,DO+'/')}catch(e){}window.__rhDestUrl=du.href;u=pxRel(u)}}return oRS(s,t,u)}}catch(e){}
window.addEventListener('popstate',function(){try{
var r=_destFromPath(_rl.pathname);
if(r){du=new URL(r+(_rl.search||'')+(_rl.hash||''));window.__rhDestUrl=du.href}
else{du=new URL(_rl.pathname+(_rl.search||'')+(_rl.hash||''),DO+'/');window.__rhDestUrl=du.href}
}catch(e){}});
try{var sSA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){
var nl=n.toLowerCase();if((nl==='src'||nl==='href'||nl==='action'||nl==='data'||nl==='poster')&&typeof v==='string'){v=rw(v);v=_fixCaptchaParams(v)}
return sSA.call(this,n,v)};
var oGA=Element.prototype.getAttribute;Element.prototype.getAttribute=function(n){
var v=oGA.call(this,n);if(v&&typeof v==='string'){var nl=n.toLowerCase();
if(nl==='src'||nl==='href'||nl==='action'||nl==='data'||nl==='poster')return _stripProxy(v)}return v}}catch(e){}
function _stripProxy(v){if(typeof v==='string'&&v.indexOf(_SP)===0)return v.substring(_SP.length);return v}
var _captchaRe=/hcaptcha\\.com|recaptcha\\.net|google\\.com\\/recaptcha|gstatic\\.com\\/recaptcha|challenges\\.cloudflare\\.com|turnstile/i;
var _proxyHost=_rl.hostname+((_rl.port&&_rl.port!=='443'&&_rl.port!=='80')?':'+_rl.port:'');
var _proxyHostNP=_rl.hostname;
function _fixCaptchaParams(v){
if(typeof v!=='string'||!_captchaRe.test(v))return v;
v=v.replace(/([?&#]host=|#host=)([^&#]*)/gi,function(_,pre,val){
if(val===_proxyHost||val===_proxyHostNP)return pre+du.hostname;return _});
v=v.replace(/([?&#]origin=|#origin=)([^&#]*)/gi,function(_,pre,val){
var dv=decodeURIComponent(val);
if(dv.indexOf(_rl.protocol+'//'+_proxyHost)===0||dv.indexOf(_rl.protocol+'//'+_proxyHostNP)===0)return pre+encodeURIComponent(DO);return _});
return v}
try{['src','href','action','poster'].forEach(function(attr){
var els=[HTMLImageElement,HTMLScriptElement,HTMLLinkElement,HTMLAnchorElement,HTMLSourceElement,
HTMLVideoElement,HTMLAudioElement,HTMLIFrameElement,HTMLEmbedElement,HTMLAreaElement];
els.forEach(function(E){if(!E||!E.prototype)return;
var d=Object.getOwnPropertyDescriptor(E.prototype,attr);
if(d&&d.set){var oSet=d.set,oGet=d.get;Object.defineProperty(E.prototype,attr,{configurable:true,enumerable:true,
get:function(){return _stripProxy(oGet?oGet.call(this):undefined)},
set:function(v){if(typeof v==='string'){v=rw(v);v=_fixCaptchaParams(v)}oSet.call(this,v)}})}})
})}catch(e){}
try{var dCookie=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
if(dCookie){var ogSet=dCookie.set,ogGet=dCookie.get;
function _pCk(v){var p={};var parts=String(v).split(';');for(var i=0;i<parts.length;i++){var t=parts[i].replace(/^\\s+|\\s+$/g,'');if(!t)continue;var eq=t.indexOf('=');var k=eq===-1?t:t.substring(0,eq);var vv=eq===-1?'':t.substring(eq+1);k=k.replace(/^\\s+|\\s+$/g,'');vv=vv.replace(/^\\s+|\\s+$/g,'');if(i===0){p.name=k;p.value=vv}else{var kl=k.toLowerCase();if(kl==='domain')p.domain=vv;else if(kl==='path')p.path=vv;else if(kl==='max-age')p.maxAge=vv;else if(kl==='expires')p.expires=vv;else if(kl==='samesite')p.samesite=vv;else if(kl==='secure')p.secure=true}}return p}
// Filter for getter: hide sync-cookie/proxy-internal noise, but re-expose the
// *original* names from our own sync cookies so page scripts that do
// document.cookie.indexOf('aws-waf-token=') etc. still work on reload.
function _fSync(c){if(!c)return c;var seen={};var out=[];var parts=c.split(/;\\s*/);
for(var i=0;i<parts.length;i++){var p=parts[i];if(!p)continue;
if(p.indexOf('__rh_')===0)continue;
var m=p.match(/^c\\|[^|]+\\|([^|]+)\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^=]*=(.*)$/);
if(m){var nm;try{nm=decodeURIComponent(m[1])}catch(e){nm=m[1]}
if(!seen[nm]){seen[nm]=1;out.push(nm+'='+m[2])}continue}
if(/^[scw]+\\|/.test(p))continue;
var eq=p.indexOf('=');var nm2=eq>=0?p.substring(0,eq):p;
if(!seen[nm2]){seen[nm2]=1;out.push(p)}}
return out.join('; ')}
Object.defineProperty(document,'cookie',{configurable:true,
get:function(){return _fSync(ogGet.call(this))},
set:function(v){
try{var p=_pCk(v);
if(p.name&&p.name.charAt(0)!=='_'&&!/^[scw]+\\|/.test(p.name)){
var dom=p.domain||du.hostname;if(dom.charAt(0)==='.')dom=dom.substring(1);
var path=p.path||'/';
var exp='';if(p.expires){try{var t=Date.parse(p.expires);if(!isNaN(t))exp=t.toString(36)}catch(e){}}
var ma='';if(p.maxAge){var mn=parseInt(p.maxAge,10);if(!isNaN(mn))ma=mn.toString(36)}
var now=Date.now().toString(36);
var sk='c|'+S+'|'+encodeURIComponent(p.name)+'|'+encodeURIComponent(dom)+'|'+encodeURIComponent(path)+'|'+exp+'|'+now+'|'+ma;
var attrs=';path=/';
if(p.maxAge)attrs+=';max-age='+p.maxAge;
if(p.expires)attrs+=';expires='+p.expires;
if(p.samesite)attrs+=';samesite='+p.samesite;
ogSet.call(this,sk+'='+p.value+attrs);return
}}catch(e){}
ogSet.call(this,v);
}})}}catch(e){}
}catch(e){}
function fixEl(el){if(!el||el.nodeType!==1||el.__rhLite)return;el.__rhLite=1;
try{var a,n;
a=_oGA.call(el,'src');if(a&&a.indexOf(_OP)!==0){n=rw(a);if(n!==a)_sSA.call(el,'src',n)}
a=_oGA.call(el,'href');if(a&&a.indexOf(_OP)!==0){n=rw(a);if(n!==a)_sSA.call(el,'href',n)}
a=_oGA.call(el,'action');if(a&&a.indexOf(_OP)!==0){n=rw(a);if(n!==a)_sSA.call(el,'action',n)}
a=_oGA.call(el,'data');if(a&&a.indexOf(_OP)!==0){n=rw(a);if(n!==a)_sSA.call(el,'data',n)}
a=_oGA.call(el,'poster');if(a&&a.indexOf(_OP)!==0){n=rw(a);if(n!==a)_sSA.call(el,'poster',n)}
a=_oGA.call(el,'srcset');if(a&&a.indexOf(_OP)!==0){n=a.replace(/((?:https?:)?\\/\\/[^\\s,]+)/gi,function(u){return rw(u)});
if(n!==a)_sSA.call(el,'srcset',n)}
}catch(e){}}
// Host-aware throttling: dense-SPA hosts (e.g. bilibili) add thousands of feed-card
// subtrees per scroll. The deep querySelectorAll pass on every mutation is what makes
// the page unresponsive; on those hosts we skip the descent and only fix the directly
// added node(s). The setAttribute/property override above still catches late src/href
// assignments on inner descendants when the site actually touches them.
var _HEAVY_SPA=/(^|\\.)bilibili\\.(com|cn)$|(^|\\.)hdslb\\.com$|(^|\\.)doubao\\.com$|(^|\\.)qianwen\\.com$|(^|\\.)tongyi\\.aliyun\\.com$|(^|\\.)chatgpt\\.com$|(^|\\.)claude\\.ai$/i;
var _SKIP_DEEP=false;try{_SKIP_DEEP=_HEAVY_SPA.test(location.hostname||'')}catch(e){}
function fixTree(n){fixEl(n);if(_SKIP_DEEP)return;
try{var els=n.querySelectorAll('iframe,script,img,link,a,form,source,video,audio,embed,object,area');
for(var i=0;i<els.length;i++)fixEl(els[i])}catch(e){}}
var _pendQ=[],_pendRaf=0,_pendMax=_SKIP_DEEP?150:500,_pendSlice=_SKIP_DEEP?2:4;
function _flushPend(){_pendRaf=0;var t0=performance.now();
while(_pendQ.length){var nd=_pendQ.shift();try{fixTree(nd)}catch(e){}if(performance.now()-t0>_pendSlice)break}
if(_pendQ.length)_pendRaf=requestAnimationFrame(_flushPend)}
function startObs(){var r=document.documentElement;if(!r){document.addEventListener('DOMContentLoaded',startObs);return}
fixTree(r);
new MutationObserver(function(ml){for(var i=0;i<ml.length;i++){var m=ml[i];
if(m.type==='childList'){for(var j=0;j<m.addedNodes.length;j++){var nd=m.addedNodes[j];
if(nd.nodeType!==1||_pendQ.length>=_pendMax)continue;
// On heavy SPAs, only enqueue nodes that have or could have rewritable attrs; skip pure text/plain div wrappers.
if(_SKIP_DEEP){var tg=nd.tagName;if(tg!=='IFRAME'&&tg!=='SCRIPT'&&tg!=='IMG'&&tg!=='LINK'&&tg!=='A'&&tg!=='FORM'&&tg!=='SOURCE'&&tg!=='VIDEO'&&tg!=='AUDIO'&&tg!=='EMBED'&&tg!=='OBJECT'&&tg!=='AREA')continue}
_pendQ.push(nd)}}}
if(_pendQ.length&&!_pendRaf)_pendRaf=requestAnimationFrame(_flushPend);
}).observe(r,{childList:true,subtree:true})}
startObs();
document.addEventListener('click',function(e){try{var a=e.target.closest&&e.target.closest('a[href]');
if(a){var ah=_oGA.call(a,'href');var n=rw(ah);if(n!==ah)_sSA.call(a,'href',n)}}catch(e2){}},true);
document.addEventListener('submit',function(e){try{var f=e.target;
if(f&&f.tagName==='FORM'){var fa=_oGA.call(f,'action');if(fa){var n=rw(fa);if(n!==fa)_sSA.call(f,'action',n)}}}catch(e2){}},true);
})()</script>`;

    html = html.replace(/<head[^>]*>/i, '$&' + inject + bridge);
    return html;
}

const _DEV = !!process.env.DEVELOPMENT;
const INJECT_PROD = ANTIDETECT_SCRIPT + AD_BLOCKER_SCRIPT;
const INJECT_DEV = ANTIDETECT_SCRIPT + AD_BLOCKER_SCRIPT + DEVTOOLS_SCRIPT;

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
        // Strip meta CSP tags — they block injected inline scripts and cross-origin resources
        html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi, '');
        html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']x-content-security-policy["'][^>]*>/gi, '');
        // Strip integrity/nonce for full processing too
        html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');
        html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, '');
    }

    // Use lite processing for complex SPAs that break under full instrumentation
    if (typeof html === 'string' && _needsLiteProcessing(ctx) && !isSrcdoc) {
        return _liteProcess(html, ctx, inject);
    }

    // Bot-challenge pages (AWS WAF, Cloudflare, DataDome, etc.): use lite processing
    // so the browser can execute the challenge JS natively and auto-solve.
    if (typeof html === 'string' && _isChallengeResponse(html, ctx) && !isSrcdoc) {
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
    result = _stripProxyOriginFromBody(result, ctx);
    return result.replace(/<head[^>]*>/i, '$&' + inject);
};
