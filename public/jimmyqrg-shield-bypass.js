/**
 * Runs before jimmyqrg.github.io /js/bot-shield.js (injected by SW).
 * Neutralizes bot-shield proxy-detection vectors that see the Scramjet shell.
 */
(function () {
  'use strict';
  if (window.__rhJimmyBypass) return;
  window.__rhJimmyBypass = true;

  var page = window.__rhJimmyPage || '';
  var CANON_HOST = '';
  var CANON_ORIGIN = '';
  try {
    var tu = new URL(page);
    CANON_HOST = tu.hostname;
    CANON_ORIGIN = tu.origin;
  } catch (_) {
    CANON_HOST = 'jimmyqrg.github.io';
    CANON_ORIGIN = 'https://jimmyqrg.github.io';
  }

  var ALLOWED = ['jimmyqrg.github.io', 'jimmyq-r-g.github.io', 'localhost', '127.0.0.1'];
  function hostOk(h) {
    if (!h) return false;
    h = String(h).toLowerCase();
    for (var i = 0; i < ALLOWED.length; i++) if (h === ALLOWED[i]) return true;
    return false;
  }

  function rewriteToCanon(u) {
    if (!u) return u;
    try {
      var p = new URL(u, CANON_ORIGIN);
      if (!hostOk(p.hostname)) {
        return CANON_ORIGIN + p.pathname + p.search + p.hash;
      }
    } catch (_) {}
    return u;
  }

  var fakeLoc = {
    get href() { return CANON_ORIGIN + (typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/'); },
    set href(_) {},
    get hostname() { return CANON_HOST; },
    get host() { return CANON_HOST; },
    get origin() { return CANON_ORIGIN; },
    get protocol() { return 'https:'; },
    get pathname() { try { return location.pathname; } catch (_) { return '/'; } },
    get search() { try { return location.search; } catch (_) { return ''; } },
    get hash() { try { return location.hash; } catch (_) { return ''; } },
    assign: function () {},
    replace: function () {},
    reload: function () {},
    toString: function () { return this.href; },
  };

  // --- Response.url + XHR.responseURL (sync HEAD /jq.ico) ---
  var origRespUrl = Object.getOwnPropertyDescriptor(Response.prototype, 'url');
  if (origRespUrl && origRespUrl.get) {
    Object.defineProperty(Response.prototype, 'url', {
      configurable: true,
      enumerable: true,
      get: function () {
        return rewriteToCanon(origRespUrl.get.call(this));
      },
    });
  }

  var origXhrUrl = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
  if (origXhrUrl && origXhrUrl.get) {
    Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', {
      configurable: true,
      enumerable: true,
      get: function () {
        return rewriteToCanon(origXhrUrl.get.call(this));
      },
    });
  }

  // --- eval('this') global probe ---
  var PROXY_NAMES = new Set([
    '__uv$config', '__uv', '$scramjet', '$scramjet$wrap', '$scramjet$prop', '$scramjet$clean',
    '$scramjet$import', '$scramjet$rewrite', '$scramjet$meta', '__dynamic$config', '$aero', '__meteor', 'scramjet',
  ]);
  var realWin = window;
  var winProxy = new Proxy(window, {
    has: function (_t, p) {
      if (PROXY_NAMES.has(p)) return false;
      return Reflect.has(realWin, p);
    },
    get: function (_t, p, rec) {
      if (PROXY_NAMES.has(p)) return undefined;
      return Reflect.get(realWin, p, rec);
    },
  });
  var origEval = window.eval;
  window.eval = function (code) {
    var res = origEval.call(this, code);
    if (typeof code === 'string' && code.trim() === 'this' && (res === realWin || res === window)) return winProxy;
    return res;
  };
  try {
    window.eval.toString = function () {
      return 'function eval() { [native code] }';
    };
  } catch (_) {}

  // --- new Function('return location') hostname leak ---
  function leakLocationFn(body) {
    var t = String(body || '').replace(/\s+/g, ' ').trim();
    if (t === 'return location' || /^return\s+location\.hostname\b/.test(t) || /^return\s+location\b/.test(t)) {
      return function () {
        return fakeLoc;
      };
    }
    return null;
  }
  var RealFunction = Function;
  window.Function = new Proxy(RealFunction, {
    apply: function (Target, thisArg, args) {
      var inner = leakLocationFn(args[args.length - 1]);
      if (inner) return inner;
      return Reflect.apply(Target, thisArg, args);
    },
    construct: function (Target, args) {
      var inner = leakLocationFn(args[args.length - 1]);
      if (inner) return inner;
      return Reflect.construct(Target, args, Target);
    },
  });

  // --- ServiceWorker.scriptURL ---
  try {
    var swDesc = Object.getOwnPropertyDescriptor(ServiceWorker.prototype, 'scriptURL');
    if (swDesc && swDesc.get) {
      Object.defineProperty(ServiceWorker.prototype, 'scriptURL', {
        configurable: true,
        enumerable: true,
        get: function () {
          var u = swDesc.get.call(this);
          var s = String(u || '').toLowerCase();
          if ((s.indexOf('scramjet') !== -1 || s.indexOf('controller.sw') !== -1) && s.indexOf('jimmyqrg') === -1) {
            return CANON_ORIGIN + '/sw.js';
          }
          return u;
        },
      });
    }
  } catch (_) {}

  // --- scramjet-attr DOM probe ---
  var oQS = Document.prototype.querySelector;
  var oQSA = Document.prototype.querySelectorAll;
  Document.prototype.querySelector = function (sel) {
    if (typeof sel === 'string' && /scramjet-attr-/i.test(sel)) return null;
    return oQS.call(this, sel);
  };
  Document.prototype.querySelectorAll = function (sel) {
    if (typeof sel === 'string' && /scramjet-attr-/i.test(sel)) return [];
    return oQSA.call(this, sel);
  };

  // --- script[src] injection probe ---
  var oGA = Element.prototype.getAttribute;
  Element.prototype.getAttribute = function (name) {
    var v = oGA.call(this, name);
    if (name === 'src' && this.tagName === 'SCRIPT' && v && /scramjet|controller\.inject|\/~\//i.test(String(v))) return '';
    return v;
  };

  // --- Performance navigation URL ---
  var oGetEntries = Performance.prototype.getEntriesByType;
  Performance.prototype.getEntriesByType = function (type) {
    var list = oGetEntries.call(this, type);
    if (type !== 'navigation' || !list || !list.length) return list;
    return list.map(function (entry) {
      return new Proxy(entry, {
        get: function (target, prop) {
          if (prop === 'name') {
            try {
              var h = new URL(target.name).hostname;
              if (!hostOk(h)) return CANON_ORIGIN + new URL(target.name).pathname + new URL(target.name).search + new URL(target.name).hash;
            } catch (_) {}
          }
          return target[prop];
        },
      });
    });
  };

  // --- getComputedStyle background-image URL ---
  var oGCS = window.getComputedStyle;
  window.getComputedStyle = function (elt, pseudo) {
    var st = oGCS.call(this, elt, pseudo);
    return new Proxy(st, {
      get: function (target, prop) {
        var val = target[prop];
        if (prop === 'backgroundImage' && typeof val === 'string' && val.indexOf('url(') !== -1) {
          try {
            var m = val.match(/url\(["']?([^"')]+)["']?\)/);
            if (m && m[1]) {
              var h = new URL(m[1], CANON_ORIGIN).hostname;
              if (!hostOk(h)) {
                return 'url("' + CANON_ORIGIN + '/jq.ico")';
              }
            }
          } catch (_) {}
        }
        return val;
      },
    });
  };

  // --- bot-shield integrity fetch (sentinel must appear in response text) ---
  var SENTINEL = 'bot-shield-sentinel-a7f3';
  var oFetch = window.fetch;
  window.fetch = function (input, init) {
    return oFetch.apply(this, arguments).then(function (r) {
      try {
        var u = typeof input === 'string' ? input : input && input.url;
        u = String(u || '');
        if (u.indexOf('bot-shield') !== -1 && r && typeof r.text === 'function') {
          return r.text().then(function (txt) {
            if (txt.indexOf(SENTINEL) === -1) txt += '\n/* ' + SENTINEL + ' */\n';
            var hdr = new Headers();
            try {
              r.headers.forEach(function (v, k) {
                hdr.set(k, v);
              });
            } catch (_) {}
            return new Response(txt, { status: r.status, statusText: r.statusText, headers: hdr });
          });
        }
      } catch (_) {}
      return r;
    });
  };

  // --- document.baseURI + document.domain (must match GitHub Pages host) ---
  try {
    Object.defineProperty(Document.prototype, 'baseURI', {
      configurable: true,
      get: function () {
        try {
          return String(window.__rhJimmyPage || CANON_ORIGIN + '/');
        } catch (_) {
          return CANON_ORIGIN + '/';
        }
      },
    });
  } catch (_) {}

  try {
    Object.defineProperty(Document.prototype, 'domain', {
      configurable: true,
      get: function () {
        return CANON_HOST;
      },
    });
  } catch (_) {}

  // --- document.cookie: hide kill-switch cookie from page scripts ---
  try {
    var cd = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (cd && cd.get && cd.set) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        get: function () {
          var c = cd.get.call(this);
          return c.replace(/(?:^|;\s*)__sb_blocked=1(?:;|$)/g, ';').replace(/^;\s*|;\s*$/g, '');
        },
        set: function (v) {
          if (v && String(v).indexOf('__sb_blocked') !== -1) return;
          return cd.set.call(this, v);
        },
      });
    }
  } catch (_) {}

  // --- Telemetry ---
  var oBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (url, data) {
    try {
      if (String(url).indexOf('bot-report') !== -1) return true;
    } catch (_) {}
    return oBeacon(url, data);
  };
})();
