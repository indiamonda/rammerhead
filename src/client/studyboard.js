(function () {
    var hammerhead = window['%_d%'];
    if (!hammerhead) throw new Error('runtime not loaded yet');
    if (hammerhead.settings._settings.sessionId) {
        // task.js already loaded. this will likely never happen though since this file loads before task.js
        console.warn('unexpected task.js load order; url shuffling cannot be used');
        main();
    } else {
        // wait for task.js to load
        hookHammerheadStartOnce(main);
        // before task.js, we need to add url shuffling
        addUrlShuffling();
    }

    function main() {
        // Store original localStorage before it gets replaced by fixCrossWindowLocalStorage
        // We need this to access internal.nativeStorage for the real storage
        var originalProxiedLocalStorage = localStorage;
        
        fixUrlRewrite();
        fixElementGetter();
        fixCrossWindowLocalStorage();

        delete window.overrideGetProxyUrl;
        delete window.overrideParseProxyUrl;
        delete window.overrideIsCrossDomainWindows;

        // other code if they want to also hook onto hammerhead start //
        if (window._a_startListeners) {
            for (const eachListener of window._a_startListeners) {
                try {
                    eachListener();
                } catch (e) {
                    console.error(e);
                }
            }
            delete window._a_startListeners;
        }

        // sync localStorage code //
        // disable if other code wants to implement their own localStorage site wrapper
        if (window._a_disableLocalStorageImpl) {
            delete window._a_disableLocalStorageImpl;
            return;
        }
        // consts
        var timestampKey = '_a_synctimestamp';
        var updateInterval = 5000;
        var isSyncing = false;

        // Use current localStorage (after Proxy replacement) - the Proxy forwards methods like addChangeEventListener
        var proxiedLocalStorage = localStorage;
        // Check if localStorage has been proxied by hammerhead
        // Use originalProxiedLocalStorage for checking internal structure since it has the original Hammerhead proxy
        if (!originalProxiedLocalStorage || !originalProxiedLocalStorage.internal || !originalProxiedLocalStorage.internal.nativeStorage) {
            // localStorage not properly proxied, skip sync
            console.warn('runtime: localStorage not properly proxied, skipping sync');
            return;
        }
        var realLocalStorage = originalProxiedLocalStorage.internal.nativeStorage;
        var sessionId = hammerhead.settings._settings.sessionId;
        var origin = window.__get$(window, 'location').origin;
        var keyChanges = [];

        try {
            syncLocalStorage();
        } catch (e) {
            if (e.message !== 'server wants to disable localStorage syncing') {
                throw e;
            }
            return;
        }
        // Check if addChangeEventListener exists on the current localStorage (Proxy forwards it from original)
        if (proxiedLocalStorage && typeof proxiedLocalStorage.addChangeEventListener === 'function') {
            proxiedLocalStorage.addChangeEventListener(function (event) {
                if (isSyncing) return;
                if (keyChanges.indexOf(event.key) === -1) keyChanges.push(event.key);
            });
        } else {
            // Fallback: use storage event listener if addChangeEventListener is not available
            window.addEventListener('storage', function (event) {
                if (isSyncing) return;
                if (keyChanges.indexOf(event.key) === -1) keyChanges.push(event.key);
            });
        }
        setInterval(function () {
            var update = compileUpdate();
            if (!update) return;
            localStorageRequest({ type: 'update', updateData: update }, function (data) {
                updateTimestamp(data.timestamp);
            });

            keyChanges = [];
        }, updateInterval);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                var update = compileUpdate();
                if (update) {
                    // even though we'll never get the timestamp, it's fine. this way,
                    // the data is safer
                    hammerhead.nativeMethods.sendBeacon.call(
                        window.navigator,
                        getSyncStorageEndpoint(),
                        JSON.stringify({
                            type: 'update',
                            updateData: update
                        })
                    );
                }
            }
        });

        function syncLocalStorage() {
            isSyncing = true;
            var timestamp = getTimestamp();
            var response;
            if (!timestamp) {
                // first time syncing
                response = localStorageRequest({ type: 'sync', fetch: true });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            } else {
                // resync
                response = localStorageRequest({ type: 'sync', timestamp: timestamp, data: proxiedLocalStorage });
                if (response.timestamp) {
                    updateTimestamp(response.timestamp);
                    overwriteLocalStorage(response.data);
                }
            }
            isSyncing = false;

            function overwriteLocalStorage(data) {
                if (!data || typeof data !== 'object') throw new TypeError('data must be an object');
                proxiedLocalStorage.clear();
                for (var prop in data) {
                    proxiedLocalStorage[prop] = data[prop];
                }
            }
        }
        function updateTimestamp(timestamp) {
            if (!timestamp) throw new TypeError('timestamp must be defined');
            if (isNaN(parseInt(timestamp))) throw new TypeError('timestamp must be a number. received' + timestamp);
            realLocalStorage[timestampKey] = timestamp;
        }
        function getTimestamp() {
            var rawTimestamp = realLocalStorage[timestampKey];
            var timestamp = parseInt(rawTimestamp);
            if (isNaN(timestamp)) {
                if (rawTimestamp) {
                    console.warn('invalid timestamp retrieved from storage: ' + rawTimestamp);
                }
                return null;
            }
            return timestamp;
        }
        function getSyncStorageEndpoint() {
            return (
                '/_a/ls?sessionId=' + encodeURIComponent(sessionId) + '&origin=' + encodeURIComponent(origin)
            );
        }
        function localStorageRequest(data, callback) {
            if (!data || typeof data !== 'object') throw new TypeError('data must be an object');

            var request = hammerhead.createNativeXHR();
            // make synchronous if there is no callback
            request.open('POST', getSyncStorageEndpoint(), !!callback);
            request.setRequestHeader('content-type', 'application/json');
            request.send(JSON.stringify(data));
            function check() {
                if (request.status === 404) {
                    throw new Error('server wants to disable localStorage syncing');
                }
                if (request.status !== 200)
                    throw new Error(
                        'server sent a non 200 code. got ' + request.status + '. Response: ' + request.responseText
                    );
            }
            if (!callback) {
                check();
                return JSON.parse(request.responseText);
            } else {
                request.onload = function () {
                    check();
                    callback(JSON.parse(request.responseText));
                };
            }
        }
        function compileUpdate() {
            if (!keyChanges.length) return null;

            var updates = {};
            for (var i = 0; i < keyChanges.length; i++) {
                updates[keyChanges[i]] = proxiedLocalStorage[keyChanges[i]];
            }

            keyChanges = [];
            return updates;
        }
    }

    var noShuffling = false;
    function addUrlShuffling() {
        const request = new XMLHttpRequest();
        // Session ID is the 32-char hex segment before the destination URL.
        // Detect the proxy's mount-point dynamically from the SCRIPT tag that
        // loaded us (rather than hard-coding `/studyboard/`) so the served
        // bundle never literally contains the brand string. Works for any
        // base path (`/`, `/proxy/`, `/studyboard/`, `/foo/bar/`, …).
        var basePath = '';
        try {
            var scripts = document.getElementsByTagName('script');
            for (var si = 0; si < scripts.length; si++) {
                var ss = scripts[si].src || '';
                if (ss.indexOf('/_a/r.js') > -1) {
                    var u = new URL(ss, location.href);
                    var pIdx = u.pathname.indexOf('/_a/r.js');
                    if (pIdx > -1) basePath = u.pathname.slice(0, pIdx);
                    break;
                }
            }
        } catch (_) {}
        if (!basePath) {
            // Fallback: detect from current pathname. Strip /<32hex>/... to find prefix.
            var pmFallback = location.pathname.match(/^(.*?)\/[a-f0-9]{32}/i);
            basePath = pmFallback ? pmFallback[1] : '';
        }
        const sidRe = new RegExp('^' + basePath.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\/([a-f0-9]{32})\\/', 'i');
        const pathMatch = location.pathname.match(sidRe);
        const sessionId = pathMatch ? pathMatch[1] : (location.pathname.slice(1).match(/^[a-f0-9]{32}/i) || [])[0];
        if (!sessionId) {
            console.warn('cannot get session id from url');
            return;
        }
        const newPath = basePath + '/_a/sd';
        const oldPath = basePath + '/api/shuffleDict';
        request.open('GET', newPath + '?id=' + sessionId, false);
        request.send();
        let resp = request;
        if (resp.status !== 200) {
            const r2 = new XMLHttpRequest();
            r2.open('GET', oldPath + '?id=' + sessionId, false);
            r2.send();
            resp = r2;
        }
        if (resp.status !== 200) {
            console.warn(
                `received a non 200 status code while trying to fetch shuffleDict:\nstatus: ${resp.status}\nresponse: ${resp.responseText}`
            );
            return;
        }
        const shuffleDict = JSON.parse(resp.responseText);
        if (!shuffleDict) return;

        // Mirror of src/util/StrShuffler.js. The v2 length-prefixed format
        // (`_p1<5hex>:<body>`) lets the unshuffler know exactly where the
        // shuffled portion ends so any text appended by in-page JS (e.g.
        // `proxyUrl + "/chunk-name"`) survives the round trip without being
        // mangled by the position-dependent cipher.
        // Indicator strings are intentionally short, generic, and contain no
        // brand prefix (was `_rh1`/`_rhs`) so they don't fingerprint the
        // proxy in every URL of every page.
        const mod = (n, m) => ((n % m) + m) % m;
        const baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
        const shuffledIndicator = '_ps';
        const shuffledIndicatorV2 = '_p1';
        // Legacy indicators we still ACCEPT (but never emit) for back-compat
        // with URLs saved/shared before the rename.
        const _LEGACY_V1 = '_rhs';
        const _LEGACY_V2 = '_rh1';
        const LEN_DIGITS = 5;
        const SEPARATOR = ':';
        const MAX_LEN = (1 << (LEN_DIGITS * 4)) - 1;
        const VALID_URL_RE = /^(?:https?:\/\/|wss?:\/\/|file:\/\/|data:|blob:|about:|\/\/)/i;
        const PATH_RESOLVED_TAIL_RE = /\.(?:js|mjs|cjs|css|html|htm|json|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|wasm|mp3|mp4|webm|ogg|wav|txt|xml|pdf)\b/i;
        const looksLikeValidUnshuffledUrl = (s) =>
            typeof s === 'string' && !!s && VALID_URL_RE.test(s);
        const generateDictionary = function () {
            let str = '';
            const split = baseDictionary.split('');
            while (split.length > 0) {
                str += split.splice(Math.floor(Math.random() * split.length), 1)[0];
            }
            return str;
        };
        class StrShuffler {
            constructor(dictionary = generateDictionary()) {
                this.dictionary = dictionary;
            }
            shuffle(str) {
                if (typeof str !== 'string') return str;
                if (
                    str.startsWith(shuffledIndicatorV2) ||
                    str.startsWith(shuffledIndicator) ||
                    str.startsWith(_LEGACY_V2) ||
                    str.startsWith(_LEGACY_V1)
                ) {
                    return str;
                }
                let shuffledStr = '';
                for (let i = 0; i < str.length; i++) {
                    const char = str.charAt(i);
                    const idx = baseDictionary.indexOf(char);
                    if (char === '%' && str.length - i >= 3) {
                        shuffledStr += char;
                        shuffledStr += str.charAt(++i);
                        shuffledStr += str.charAt(++i);
                    } else if (idx === -1) {
                        shuffledStr += char;
                    } else {
                        shuffledStr += this.dictionary.charAt(mod(idx + i, baseDictionary.length));
                    }
                }
                if (shuffledStr.length > MAX_LEN) {
                    return shuffledIndicator + shuffledStr;
                }
                const lenHex = shuffledStr.length.toString(16).padStart(LEN_DIGITS, '0');
                return shuffledIndicatorV2 + lenHex + SEPARATOR + shuffledStr;
            }
            _unshuffleBody(body) {
                let unshuffledStr = '';
                for (let i = 0; i < body.length; i++) {
                    const char = body.charAt(i);
                    const idx = this.dictionary.indexOf(char);
                    if (char === '%' && body.length - i >= 3) {
                        unshuffledStr += char;
                        unshuffledStr += body.charAt(++i);
                        unshuffledStr += body.charAt(++i);
                    } else if (idx === -1) {
                        unshuffledStr += char;
                    } else {
                        unshuffledStr += baseDictionary.charAt(mod(idx - i, baseDictionary.length));
                    }
                }
                return unshuffledStr;
            }
            unshuffle(str) {
                if (typeof str !== 'string') return str;
                // Pick whichever v2 indicator (new or legacy) starts the URL.
                let _v2 = null;
                if (str.startsWith(shuffledIndicatorV2)) _v2 = shuffledIndicatorV2;
                else if (str.startsWith(_LEGACY_V2)) _v2 = _LEGACY_V2;
                if (_v2) {
                    const headerLen = _v2.length + LEN_DIGITS + SEPARATOR.length;
                    if (str.length < headerLen) return str;
                    const lenHex = str.substr(_v2.length, LEN_DIGITS);
                    if (!/^[0-9a-f]{5}$/i.test(lenHex)) return str;
                    if (str.charAt(_v2.length + LEN_DIGITS) !== SEPARATOR) return str;
                    const declaredLen = parseInt(lenHex, 16);
                    const bodyStart = headerLen;
                    const fullPayload = str.substring(bodyStart);
                    const declaredBody = fullPayload.substring(0, declaredLen);
                    const declaredSuffix = fullPayload.substring(declaredLen);
                    const declaredOut = this._unshuffleBody(declaredBody) + declaredSuffix;
                    const declaredValid = looksLikeValidUnshuffledUrl(declaredOut);
                    // Path-resolved import recovery: if the body contains a
                    // recognized file extension, the browser likely
                    // appended a literal filename to a shuffled importer
                    // URL. Try splitting at every `/` from longest down
                    // and pick the first whose decoded head is a valid URL.
                    if (PATH_RESOLVED_TAIL_RE.test(fullPayload)) {
                        for (let i = fullPayload.length; i > 0; i--) {
                            if (fullPayload.charAt(i - 1) !== '/') continue;
                            const head = fullPayload.substring(0, i);
                            const tail = fullPayload.substring(i);
                            if (!PATH_RESOLVED_TAIL_RE.test(tail)) continue;
                            const candidate = this._unshuffleBody(head) + tail;
                            if (looksLikeValidUnshuffledUrl(candidate)) {
                                return candidate;
                            }
                        }
                    }
                    if (declaredValid) return declaredOut;
                    for (let i = declaredLen - 1; i > 0; i--) {
                        if (fullPayload.charAt(i - 1) !== '/') continue;
                        const head = fullPayload.substring(0, i);
                        const tail = fullPayload.substring(i);
                        const candidate = this._unshuffleBody(head) + tail;
                        if (looksLikeValidUnshuffledUrl(candidate)) {
                            return candidate;
                        }
                    }
                    return declaredOut;
                }
                if (str.startsWith(shuffledIndicator)) {
                    return this._unshuffleBody(str.slice(shuffledIndicator.length));
                }
                if (str.startsWith(_LEGACY_V1)) {
                    return this._unshuffleBody(str.slice(_LEGACY_V1.length));
                }
                return str;
            }
        }

        const replaceUrl = (url, replacer) => {
            // Must mirror src/util/addUrlShuffling.js: allow multiple path segments
            // before /<32hex>(!meta)*/ so /studyboard/<sid>/… and PATH_STYLE bases work.
            // NON-GREEDY `*?` so the FIRST 32-hex segment wins (otherwise content-hash
            // dirs in destinations are mistaken for the session id).
            return (url || '').replace(
                /^((?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+)*?\/[a-f0-9]{32}(?:![^/?#]*)*\/)((?:.|\s)+)$/i,
                (_, g1, g2) => g1 + replacer(g2)
            );
        };
        const shuffler = new StrShuffler(shuffleDict);

        // shuffle current url if it isn't already shuffled (unshuffled urls likely come from user input)
        const oldUrl = location.href;
        const newUrl = replaceUrl(location.href, (url) => shuffler.shuffle(url));
        if (oldUrl !== newUrl) {
            history.replaceState(null, null, newUrl);
        }

        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        const parseProxyUrl = hammerhead.utils.url.parseProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts) {
            if (noShuffling) {
                return getProxyUrl(url, opts);
            }
            return replaceUrl(getProxyUrl(url, opts), (u) => shuffler.shuffle(u), true);
        });
        hammerhead.utils.url.overrideParseProxyUrl(function (url) {
            return parseProxyUrl(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
        });
        // manual hooks //
        window.overrideGetProxyUrl(
            (getProxyUrl$1) =>
                function (url, opts) {
                    if (noShuffling) {
                        return getProxyUrl$1(url, opts);
                    }
                    return replaceUrl(getProxyUrl$1(url, opts), (u) => shuffler.shuffle(u), true);
                }
        );
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    return parseProxyUrl$1(replaceUrl(url, (u) => shuffler.unshuffle(u), false));
                }
        );
    }
    function fixUrlRewrite() {
        const port = location.port || (location.protocol === 'https:' ? '443' : '80');
        const getProxyUrl = hammerhead.utils.url.getProxyUrl;
        hammerhead.utils.url.overrideGetProxyUrl(function (url, opts = {}) {
            if (!opts.proxyPort) {
                opts.proxyPort = port;
            }
            return getProxyUrl(url, opts);
        });
        window.overrideParseProxyUrl(
            (parseProxyUrl$1) =>
                function (url) {
                    const parsed = parseProxyUrl$1(url);
                    if (!parsed || !parsed.proxy) return parsed;
                    if (!parsed.proxy.port) {
                        parsed.proxy.port = port;
                    }
                    return parsed;
                }
        );
    }
    function fixElementGetter() {
        const fixList = {
            HTMLAnchorElement: ['href'],
            HTMLAreaElement: ['href'],
            HTMLBaseElement: ['href'],
            HTMLEmbedElement: ['src'],
            HTMLFormElement: ['action'],
            HTMLFrameElement: ['src'],
            HTMLIFrameElement: ['src'],
            HTMLImageElement: ['src'],
            HTMLInputElement: ['src'],
            HTMLLinkElement: ['href'],
            HTMLMediaElement: ['src'],
            HTMLModElement: ['cite'],
            HTMLObjectElement: ['data'],
            HTMLQuoteElement: ['cite'],
            HTMLScriptElement: ['src'],
            HTMLSourceElement: ['src'],
            HTMLTrackElement: ['src']
        };
        const urlRewrite = (url) => (hammerhead.utils.url.parseProxyUrl(url) || {}).destUrl || url;
        for (const ElementClass in fixList) {
            for (const attr of fixList[ElementClass]) {
                if (!window[ElementClass]) {
                    console.warn('unexpected unsupported element class ' + ElementClass);
                    continue;
                }
                const desc = Object.getOwnPropertyDescriptor(window[ElementClass].prototype, attr);
                const originalGet = desc.get;
                desc.get = function () {
                    return urlRewrite(originalGet.call(this));
                };
                if (attr === 'action') {
                    const originalSet = desc.set;
                    // don't shuffle form action urls
                    desc.set = function (value) {
                        noShuffling = true;
                        try {
                            var returnVal = originalSet.call(this, value);
                        } catch (e) {
                            noShuffling = false;
                            throw e;
                        }
                        noShuffling = false;
                        return returnVal;
                    };
                }
                Object.defineProperty(window[ElementClass].prototype, attr, desc);
            }
        }
    }
    function fixCrossWindowLocalStorage() {
        // completely replace hammerhead's implementation as restore() and save() on every
        // call is just not viable (mainly memory issues as the garbage collector is sometimes not fast enough)

        const getLocHost = win => (new URL(hammerhead.utils.url.parseProxyUrl(win.location.href).destUrl)).host;
        const prefix = win => `_a|sw|${hammerhead.settings._settings.sessionId}|${
            getLocHost(win)
        }|`;
        const toRealStorageKey = (key = '', win = window) => prefix(win) + key;
        const fromRealStorageKey = (key = '', win = window) => {
            if (!key.startsWith(prefix(win))) return null;
            return key.slice(prefix.length);
        };

        const replaceStorageInstance = (storageProp, realStorage) => {
            const reservedProps = ['internal', 'clear', 'key', 'getItem', 'setItem', 'removeItem', 'length'];
            const originalStorage = window[storageProp];
            Object.defineProperty(window, storageProp, {
                // define a value-based instead of getter-based property, since with this localStorage implementation,
                // we don't need to rely on sharing a single memory-based storage across frames, unlike hammerhead
                configurable: true,
                writable: true,
                // still use window[storageProp] as basis to allow scripts to access localStorage.internal
                value: new Proxy(originalStorage, {
                    get(target, prop, receiver) {
                        // Handle reserved properties first
                        if (reservedProps.includes(prop) && prop !== 'length') {
                            return Reflect.get(target, prop, receiver);
                        }
                        if (prop === 'length') {
                            let len = 0;
                            for (const [key] of Object.entries(realStorage)) {
                                if (fromRealStorageKey(key)) len++;
                            }
                            return len;
                        }
                        // For all other properties, first check if they exist on the target (original storage)
                        // This forwards methods like addChangeEventListener from Hammerhead's proxy
                        if (prop in target) {
                            const value = Reflect.get(target, prop, receiver);
                            // If it's a function, bind it to the target so 'this' works correctly
                            if (typeof value === 'function') {
                                return value.bind(target);
                            }
                            return value;
                        }
                        // If not found on target, treat it as a storage key
                        return realStorage[toRealStorageKey(prop)];
                    },
                    set(_, prop, value) {
                        if (!reservedProps.includes(prop)) {
                            realStorage[toRealStorageKey(prop)] = value;
                        }
                        return true;
                    },
                    deleteProperty(_, prop) {
                        delete realStorage[toRealStorageKey(prop)];
                        return true;
                    },
                    has(target, prop) {
                        return toRealStorageKey(prop) in realStorage || prop in target;
                    },
                    ownKeys() {
                        const list = [];
                        for (const [key] of Object.entries(realStorage)) {
                            const proxyKey = fromRealStorageKey(key);
                            if (proxyKey && !reservedProps.includes(proxyKey)) list.push(proxyKey);
                        }
                        return list;
                    },
                    getOwnPropertyDescriptor(_, prop) {
                        return Object.getOwnPropertyDescriptor(realStorage, toRealStorageKey(prop));
                    },
                    defineProperty(_, prop, desc) {
                        if (!reservedProps.includes(prop)) {
                            Object.defineProperty(realStorage, toRealStorageKey(prop), desc);
                        }
                        return true;
                    }
                })
            });
        };
        const rewriteFunction = (prop, newFunc) => {
            Storage.prototype[prop] = new Proxy(Storage.prototype[prop], {
                apply(_, thisArg, args) {
                    return newFunc.apply(thisArg, args);
                }
            });
        };

        replaceStorageInstance('localStorage', hammerhead.storages.localStorageProxy.internal.nativeStorage);
        replaceStorageInstance('sessionStorage', hammerhead.storages.sessionStorageProxy.internal.nativeStorage);
        rewriteFunction('clear', function () {
            for (const [key] of Object.entries(this)) {
                delete this[key];
            }
        });
        rewriteFunction('key', function (keyNum) {
            return (Object.entries(this)[keyNum] || [])[0] || null;
        });
        rewriteFunction('getItem', function (key) {
            return this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)] || null;
        });
        rewriteFunction('setItem', function (key, value) {
            if (key) {
                this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)] = value;
            }
        });
        rewriteFunction('removeItem', function (key) {
            delete this.internal.nativeStorage[toRealStorageKey(key, this.internal.ctx)];
        });
    }

    function hookHammerheadStartOnce(callback) {
        var originalStart = hammerhead.__proto__.start;
        hammerhead.__proto__.start = function () {
            originalStart.apply(this, arguments);
            hammerhead.__proto__.start = originalStart;
            callback();
        };
    }
})();
