(function () {
  'use strict';
  if (window.__rhToolbarLoaded) return;
  window.__rhToolbarLoaded = true;

  var STORAGE_KEY = 'rh_tabs';
  var PREFIX = '/~/sj/';
  var REAL_ORIGIN = window.__rhRealOrigin || location.origin;

  // Navigate to a real (non-proxied) URL bypassing Scramjet's hooks.
  // Strategy: post a message to the controlling SW which does a client navigate.
  // Fallback: construct the proxy-encoded path and use location.href
  function rawNavigate(url) {
    // If the target is our origin, construct the path relative to it
    // and use history + reload to break out of Scramjet
    try {
      var target = new URL(url, REAL_ORIGIN);
      // Tell the SW to navigate this client
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: '__rh_navigate',
          url: target.href,
        });
        return;
      }
    } catch (_) {}
    // Fallback: try direct location (may be caught by Scramjet)
    window.location.href = url;
  }

  function decodeProxyUrl(href) {
    try {
      var u = new URL(href, location.origin);
      if (!u.pathname.startsWith(PREFIX)) return null;
      var rest = u.pathname.slice(PREFIX.length);
      var slash = rest.indexOf('/');
      if (slash < 1) return null;
      return decodeURIComponent(rest.slice(slash + 1));
    } catch (_) { return null; }
  }

  function shellNavigate(url) {
    return REAL_ORIGIN + '/?__rh_nav=' + encodeURIComponent(url);
  }

  function getTabs() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function saveTabs(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  var currentRealUrl = decodeProxyUrl(location.href) || location.href;

  function updateCurrentTabState() {
    var saved = getTabs();
    if (!saved || !saved.tabs) return;
    var activeIdx = typeof saved.active === 'number' ? saved.active : 0;
    var tab = saved.tabs[activeIdx];
    if (tab) {
      tab.url = currentRealUrl;
      tab.title = document.title || tab.title;
      var hist = tab.history || [];
      if (hist[hist.length - 1] !== currentRealUrl) {
        hist.push(currentRealUrl);
        tab.history = hist.slice(-20);
        tab.historyIndex = tab.history.length - 1;
      }
    }
    saveTabs(saved);
  }

  // Build toolbar DOM
  var toolbar = document.createElement('div');
  toolbar.id = '__rh-toolbar';
  toolbar.innerHTML =
    '<div class="__rh-tb-inner">' +
      '<button class="__rh-tb-btn" data-action="back" title="Back">&#9664;</button>' +
      '<button class="__rh-tb-btn" data-action="forward" title="Forward">&#9654;</button>' +
      '<button class="__rh-tb-btn" data-action="refresh" title="Refresh">&#8635;</button>' +
      '<input class="__rh-tb-url" type="text" spellcheck="false" />' +
      '<button class="__rh-tb-btn" data-action="home" title="Home">&#8962;</button>' +
      '<button class="__rh-tb-btn __rh-tb-toggle" data-action="collapse" title="Hide toolbar">&#9660;</button>' +
    '</div>';

  var style = document.createElement('style');
  style.textContent =
    '#__rh-toolbar{position:fixed;top:0;left:0;right:0;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;font-size:13px;background:#1e1e2e;border-bottom:1px solid #313244;padding:4px 8px;display:flex;align-items:center;transition:transform .2s ease;user-select:none;-webkit-user-select:none}' +
    '#__rh-toolbar.collapsed{transform:translateY(-100%)}' +
    '#__rh-toolbar.collapsed+#__rh-toolbar-show{display:flex}' +
    '#__rh-toolbar-show{display:none;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1e1e2e;border:1px solid #313244;border-top:none;border-radius:0 0 8px 8px;padding:2px 12px;cursor:pointer;color:#cdd6f4;font-size:11px;align-items:center;gap:4px;opacity:0.5;transition:opacity .2s}' +
    '#__rh-toolbar-show:hover{opacity:1}' +
    '.__rh-tb-inner{display:flex;align-items:center;gap:4px;width:100%}' +
    '.__rh-tb-btn{background:none;border:none;color:#cdd6f4;cursor:pointer;padding:4px 6px;border-radius:4px;font-size:14px;line-height:1;transition:background .15s}' +
    '.__rh-tb-btn:hover{background:#313244}' +
    '.__rh-tb-url{flex:1;background:#181825;border:1px solid #313244;border-radius:6px;padding:5px 10px;color:#cdd6f4;font-size:12px;outline:none;min-width:0}' +
    '.__rh-tb-url:focus{border-color:#89b4fa}' +
    'body.__rh-has-toolbar{padding-top:36px!important}';

  function injectToolbar() {
    if (document.getElementById('__rh-toolbar')) return;
    document.documentElement.appendChild(style);
    document.body.appendChild(toolbar);

    var showBtn = document.createElement('div');
    showBtn.id = '__rh-toolbar-show';
    showBtn.innerHTML = '&#9650; Toolbar';
    showBtn.addEventListener('click', function () {
      toolbar.classList.remove('collapsed');
      document.body.classList.add('__rh-has-toolbar');
      localStorage.setItem('__rh_tb_visible', '1');
    });
    document.body.appendChild(showBtn);

    var urlInput = toolbar.querySelector('.__rh-tb-url');
    urlInput.value = currentRealUrl;

    if (localStorage.getItem('__rh_tb_visible') !== '0') {
      document.body.classList.add('__rh-has-toolbar');
    } else {
      toolbar.classList.add('collapsed');
    }

    urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var val = urlInput.value.trim();
        if (!val) return;
        navigateTo(val);
      }
    });

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'back') history.back();
      else if (action === 'forward') history.forward();
      else if (action === 'refresh') location.reload();
      else if (action === 'home') { updateCurrentTabState(); rawNavigate(REAL_ORIGIN + '/?__rh_home=1'); }
      else if (action === 'collapse') {
        toolbar.classList.add('collapsed');
        document.body.classList.remove('__rh-has-toolbar');
        localStorage.setItem('__rh_tb_visible', '0');
      }
    });
  }

  function navigateTo(input) {
    var url = input;
    if (!/^https?:\/\//i.test(url) && !/^jq:\/\//.test(url)) {
      if (/^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}/i.test(url)) {
        url = 'https://' + url;
      } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    if (url.startsWith('jq://')) {
      rawNavigate(REAL_ORIGIN + '/');
      return;
    }
    updateCurrentTabState();
    // Navigate via shell so it can properly encode the proxy URL with Scramjet
    rawNavigate(shellNavigate(url));
  }

  // Watch for URL changes within the proxied site (SPA navigation)
  var lastHref = location.href;
  function pollUrlChange() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      currentRealUrl = decodeProxyUrl(location.href) || location.href;
      var urlInput = toolbar.querySelector('.__rh-tb-url');
      if (urlInput) urlInput.value = currentRealUrl;
      updateCurrentTabState();
    }
  }
  setInterval(pollUrlChange, 500);

  // Update tab title on changes
  var titleObserver = new MutationObserver(function () {
    updateCurrentTabState();
  });

  function init() {
    injectToolbar();
    updateCurrentTabState();
    var titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  // Delay toolbar injection to avoid interfering with React hydration
  function safeInit() {
    if (document.body) {
      // Wait for potential React hydration to complete
      if (document.readyState === 'complete') {
        setTimeout(init, 100);
      } else {
        window.addEventListener('load', function () { setTimeout(init, 100); });
      }
    } else {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
    }
  }
  safeInit();
})();
