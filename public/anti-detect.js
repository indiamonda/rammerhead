(function () {
  'use strict';
  if (window.__rhAntiDetect) return;
  window.__rhAntiDetect = true;

  var PREFIX = '/~/sj/';

  // The SW injects __rhRealOrigin (our proxy's real origin) and __rhTargetUrl
  // (the original destination URL) before this script runs.
  var _realOrigin = window.__rhRealOrigin || '';
  var _targetUrl = window.__rhTargetUrl || null;
  var _targetHostname = null;
  var _targetOrigin = null;
  if (_targetUrl) {
    try {
      var tu = new URL(_targetUrl);
      _targetHostname = tu.hostname;
      _targetOrigin = tu.origin;
    } catch (_) {}
  }

  function getOriginalUrl(proxyUrl) {
    try {
      var u = new URL(proxyUrl, _realOrigin || location.origin);
      if (!u.pathname.startsWith(PREFIX)) return null;
      var rest = u.pathname.slice(PREFIX.length);
      var slash = rest.indexOf('/');
      if (slash < 1) return null;
      return decodeURIComponent(rest.slice(slash + 1) + u.search + u.hash);
    } catch (_) { return null; }
  }

  function getOriginalOrigin() {
    return _targetOrigin;
  }

  function getOriginalHostname() {
    return _targetHostname;
  }

  function rewriteUrlToOriginal(proxyUrl) {
    var decoded = getOriginalUrl(proxyUrl);
    return decoded || proxyUrl;
  }

  // Vector 3: Hook Response.url to return original URL
  var origResponseUrl = Object.getOwnPropertyDescriptor(Response.prototype, 'url');
  if (origResponseUrl && origResponseUrl.get) {
    Object.defineProperty(Response.prototype, 'url', {
      get: function () {
        var realUrl = origResponseUrl.get.call(this);
        var decoded = getOriginalUrl(realUrl);
        return decoded || realUrl;
      },
      configurable: true,
      enumerable: true,
    });
  }

  // Vector 11: Hook XMLHttpRequest.responseURL
  var origXhrResponseUrl = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
  if (origXhrResponseUrl && origXhrResponseUrl.get) {
    Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', {
      get: function () {
        var realUrl = origXhrResponseUrl.get.call(this);
        var decoded = getOriginalUrl(realUrl);
        return decoded || realUrl;
      },
      configurable: true,
      enumerable: true,
    });
  }

  // Vector 4: Hide $scramjet and related globals from detection
  // bot-shield.js uses: var _g = (0, eval)('this'); _g['$scramjet']
  // We hook eval so that when the result is the global/window object,
  // we return a Proxy that hides proxy-related properties.
  var PROXY_GLOBALS_SET = new Set([
    '__uv$config', '__uv', '$scramjet',
    '$scramjet$wrap', '$scramjet$prop', '$scramjet$clean',
    '$scramjet$import', '$scramjet$rewrite', '$scramjet$meta',
    '__dynamic$config', '$aero', '__meteor', 'scramjet'
  ]);

  var _realWindow = window;
  var _windowProxy = new Proxy(window, {
    get: function (target, prop) {
      if (PROXY_GLOBALS_SET.has(prop)) return undefined;
      var val = target[prop];
      if (typeof val === 'function' && !val.prototype) return val.bind(target);
      return val;
    },
    has: function (target, prop) {
      if (PROXY_GLOBALS_SET.has(prop)) return false;
      return prop in target;
    }
  });

  // Only hook eval on sites that use the (0, eval)('this') detection pattern
  if (_targetHostname && (_targetHostname.indexOf('jimmyqrg') !== -1 || _targetHostname.indexOf('jimmyq-r-g') !== -1)) {
    var _origEval = window.eval;
    window.eval = function (code) {
      var result = _origEval.call(window, code);
      if (typeof code === 'string' && code.trim() === 'this' &&
          (result === window || result === _realWindow)) {
        return _windowProxy;
      }
      return result;
    };
    window.eval.toString = function () { return 'function eval() { [native code] }'; };
    Object.defineProperty(window.eval, 'length', { value: 1 });
  }

  // Vector 5: Hook ServiceWorker.scriptURL
  try {
    var swProto = ServiceWorker.prototype;
    var origScriptUrl = Object.getOwnPropertyDescriptor(swProto, 'scriptURL');
    if (origScriptUrl && origScriptUrl.get) {
      Object.defineProperty(swProto, 'scriptURL', {
        get: function () {
          var real = origScriptUrl.get.call(this);
          if (real && (real.indexOf('scramjet') !== -1 || real.indexOf('/sw.js') !== -1)) {
            var origHost = getOriginalHostname();
            if (origHost) return 'https://' + origHost + '/sw.js';
          }
          return real;
        },
        configurable: true,
        enumerable: true,
      });
    }
  } catch (_) {}

  // Vectors 6, 7, 13 - Only needed for sites with proxy detection (jimmyqrg)
  var _isDetectionSite = _targetHostname && (_targetHostname.indexOf('jimmyqrg') !== -1 || _targetHostname.indexOf('jimmyq-r-g') !== -1);

  if (_isDetectionSite) {
    // Vector 6: Prevent detection of scramjet-attr-* attributes
    var origQuerySelector = Document.prototype.querySelector;
    Document.prototype.querySelector = function (sel) {
      if (typeof sel === 'string' && sel.indexOf('scramjet-attr-') !== -1) {
        return null;
      }
      return origQuerySelector.call(this, sel);
    };

    var origQuerySelectorAll = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (sel) {
      if (typeof sel === 'string' && sel.indexOf('scramjet-attr-') !== -1) {
        return document.createDocumentFragment().querySelectorAll('*');
      }
      return origQuerySelectorAll.call(this, sel);
    };

    // Vector 7: Hide injected script src attributes containing scramjet keywords
    var origGetAttribute = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function (name) {
      var val = origGetAttribute.call(this, name);
      if (name === 'src' && this.tagName === 'SCRIPT' && typeof val === 'string') {
        if (val.indexOf('scramjet') !== -1 || val === '/toolbar.js' || val === '/anti-detect.js') {
          return null;
        }
      }
      return val;
    };

    // Vector 13: Hook Performance API
    var origGetEntriesByType = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function (type) {
      var entries = origGetEntriesByType.call(this, type);
      if (type === 'navigation' || type === 'resource') {
        return entries.map(function (entry) {
          var decoded = getOriginalUrl(entry.name);
          if (decoded) {
            var clone = {};
            for (var k in entry) { clone[k] = entry[k]; }
            Object.setPrototypeOf(clone, Object.getPrototypeOf(entry));
            Object.defineProperty(clone, 'name', { value: decoded, enumerable: true });
            return clone;
          }
          return entry;
        });
      }
      return entries;
    };
  }

  // Vector 14: Hook getComputedStyle to rewrite background-image URLs
  // Only activate on sites known to use this detection (jimmyqrg.github.io)
  if (_targetHostname && (_targetHostname.indexOf('jimmyqrg') !== -1 || _targetHostname.indexOf('jimmyq-r-g') !== -1)) {
    var origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function (el, pseudo) {
      var style = origGetComputedStyle.call(window, el, pseudo);
      return new Proxy(style, {
        get: function (target, prop) {
          var val = target[prop];
          if (prop === 'backgroundImage' || prop === 'background-image') {
            val = typeof val === 'function' ? val.call(target) : val;
            if (typeof val === 'string' && val.indexOf(PREFIX) !== -1) {
              val = val.replace(/url\(["']?(.*?)["']?\)/g, function (match, url) {
                var decoded = getOriginalUrl(url);
                return decoded ? 'url("' + decoded + '")' : match;
              });
            }
            return val;
          }
          if (typeof val === 'function') return val.bind(target);
          return val;
        }
      });
    };
  }

  // Vector 15 (bonus): Ensure window.top === window.self since we're frameless
  // This is already true in the frameless architecture, but reinforce it
  try {
    if (window.top !== window.self) {
      Object.defineProperty(window, 'top', {
        get: function () { return window.self; },
        configurable: true,
      });
    }
  } catch (_) {}

  // Vector 8: Function constructor location leak
  // Scramjet v2 already hooks the Function constructor for location spoofing,
  // so `new Function('return location')().hostname` should return the target hostname.

  // Additional: Hook document.cookie to prevent __sb_blocked (jimmyqrg only)
  if (_isDetectionSite) {
    var origCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (origCookieDesc) {
      Object.defineProperty(document, 'cookie', {
        get: function () {
          var cookies = origCookieDesc.get.call(this);
          return cookies.replace(/__sb_blocked=[^;]*(;\s*)?/g, '');
        },
        set: function (v) {
          if (typeof v === 'string' && v.indexOf('__sb_blocked') !== -1) return;
          origCookieDesc.set.call(this, v);
        },
        configurable: true,
      });
    }
  }

  // Vectors 12 + sendBeacon: Only needed for jimmyqrg detection sites
  if (_isDetectionSite) {
    // Vector 12: Script integrity self-check bypass
    var SENTINEL = 'bot-shield-sentinel-a7f3';
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (url.indexOf('bot-shield') !== -1) {
        return origFetch.apply(this, arguments).then(function (resp) {
          var cloned = resp.clone();
          return cloned.text().then(function (txt) {
            if (txt.indexOf(SENTINEL) === -1) {
              txt = '/* ' + SENTINEL + ' */' + txt;
            }
            return new Response(txt, {
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers,
            });
          });
        });
      }
      return origFetch.apply(this, arguments);
    };
    window.fetch.toString = function () { return 'function fetch() { [native code] }'; };

    var origSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      if (typeof url === 'string' && url.indexOf('bot-report') !== -1) {
        return true;
      }
      return origSendBeacon.apply(this, arguments);
    };
    navigator.sendBeacon.toString = function () { return 'function sendBeacon() { [native code] }'; };
  }
})();

