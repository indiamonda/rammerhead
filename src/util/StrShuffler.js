/*

Position-dependent character substitution used to obfuscate destination URLs in
proxy paths. The shuffled output is wrapped with an indicator + length prefix
so that:

  • Old-format URLs (just `_rhs<shuffled>`) keep working — backward compatible.
  • New-format URLs (`_rh1<5-hex-length>:<shuffled-body>`) carry an explicit
    length so we can tell where the shuffled portion ends. Any text appended
    AFTER the shuffled body (e.g. when in-page JS does
    `someProxyUrl + "/chunk"`) is preserved verbatim instead of being mangled.

The position-dependent cipher is what makes this necessary: each character is
encoded as `dictionary[mod(baseIdx + position, 64)]`, so feeding raw, non-
shuffled text into the unshuffler at offsets that look like part of the cipher
produces garbage. The length prefix is the cleanest way to draw the boundary.

baseDictionary originally generated with (certain characters removed to avoid
breaking pages):

  let str = '';
  for (let i = 32; i <= 126; i++) {
    let c = String.fromCharCode(i);
    if (c !== '/' && c !== '_' && encodeURI(c).length === 1) str += c;
  }

*/

const mod = (n, m) => ((n % m) + m) % m;
const baseDictionary = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
// Legacy indicator (no length prefix). We still RECOGNIZE this format on input
// for old shared/saved URLs but never emit it any more.
const shuffledIndicator = '_rhs';
// Versioned indicator. Emitted output looks like
//   _rh1<HHHHH>:<shuffled-body>
// where HHHHH is the body length encoded as 5 lowercase hex digits.
const shuffledIndicatorV2 = '_rh1';
const LEN_DIGITS = 5;
const SEPARATOR = ':';
const MAX_LEN = (1 << (LEN_DIGITS * 4)) - 1; // 0xFFFFF == 1048575

const generateDictionary = function () {
    let str = '';
    const split = baseDictionary.split('');
    while (split.length > 0) {
        str += split.splice(Math.floor(Math.random() * split.length), 1)[0];
    }
    return str;
};

// Heuristic used by `unshuffle` to decide whether a candidate decoded body
// looks like the URL the page actually meant. We accept anything starting
// with a known scheme (http/https/ws/wss/file/data/blob), or the special
// `about:` URLs that hammerhead emits, or a protocol-relative `//host/…`
// form. Anything else (random base-62 garbage from cipher misalignment) is
// rejected so the caller can try the next candidate length.
const VALID_URL_RE = /^(?:https?:\/\/|wss?:\/\/|file:\/\/|data:|blob:|about:|\/\/)/i;
function looksLikeValidUnshuffledUrl(str) {
    if (typeof str !== 'string' || !str) return false;
    return VALID_URL_RE.test(str);
}

// Path-resolved import detection: when the BROWSER turns
//   <importer URL>/_rh1<len>:<shuffled-importer-tail>
// into
//   <importer URL>/_rh1<len>:<shuffled-prefix><literal-filename>
// by resolving `import "./chunk.js"`, the trailing portion of the body is
// LITERAL filename text that the cipher would otherwise mangle. Common
// indicator: the body contains a `/` followed by characters that end in a
// recognized file extension — those bytes would virtually never appear from
// the cipher's random output, so their presence is a near-certain marker
// of path resolution.
const PATH_RESOLVED_TAIL_RE = /\.(?:js|mjs|cjs|css|html|htm|json|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|wasm|mp3|mp4|webm|ogg|wav|txt|xml|pdf)\b/i;

class StrShuffler {
    constructor(dictionary = generateDictionary()) {
        this.dictionary = dictionary;
    }

    /**
     * Encode `str` into `_rh1<len>:<shuffled>` form. If the input is already
     * shuffled (starts with the legacy or versioned indicator) it's returned
     * unchanged so we don't double-shuffle.
     */
    shuffle(str) {
        if (typeof str !== 'string') return str;
        if (str.startsWith(shuffledIndicatorV2) || str.startsWith(shuffledIndicator)) {
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
        // Bail out of the v2 format if the body is improbably long. Keeps the
        // length prefix at a fixed width without truncating real URLs.
        if (shuffledStr.length > MAX_LEN) {
            return shuffledIndicator + shuffledStr;
        }
        const lenHex = shuffledStr.length.toString(16).padStart(LEN_DIGITS, '0');
        return shuffledIndicatorV2 + lenHex + SEPARATOR + shuffledStr;
    }

    /**
     * Decode a shuffled URL back to its original form. Recognizes both the
     * versioned format (`_rh1<len>:<body><suffix>`) and the legacy unsized
     * format (`_rhs<body>`). For the versioned format, anything after the
     * declared body length is treated as a verbatim suffix — that's what
     * lets concatenated chunk names round-trip correctly.
     *
     * Robustness for browser path resolution: when the page does
     *   <script src="…/_rh1<len>:<shuffled-importer-tail>"> (eg ES module)
     * and that script statically imports `./chunk.js`, the BROWSER resolves
     * the relative URL against the importer's directory, producing
     *   …/_rh1<len>:<shuffled-prefix-with-trailing-slash><chunk.js>
     * The length prefix in the URL is now larger than the actually-encoded
     * portion (the original importer URL bytes), and the literal `chunk.js`
     * sits at cipher positions where naive decoding produces garbage. To
     * handle this we try the declared length first and, if the decoded body
     * doesn't look like a valid absolute/protocol-relative URL, fall back to
     * the longest split at a literal `/` whose decoded prefix DOES look
     * valid. That recovers the correct destination for path-resolved
     * imports without breaking the common case (declared length already
     * matches the encoded bytes).
     */
    unshuffle(str) {
        if (typeof str !== 'string') return str;

        if (str.startsWith(shuffledIndicatorV2)) {
            const headerLen = shuffledIndicatorV2.length + LEN_DIGITS + SEPARATOR.length;
            if (str.length < headerLen) return str;
            const lenHex = str.substr(shuffledIndicatorV2.length, LEN_DIGITS);
            if (!/^[0-9a-f]{5}$/i.test(lenHex)) return str;
            if (str.charAt(shuffledIndicatorV2.length + LEN_DIGITS) !== SEPARATOR) return str;
            const declaredLen = parseInt(lenHex, 16);
            const bodyStart = headerLen;
            const fullPayload = str.substring(bodyStart);

            const declaredBody = fullPayload.substring(0, declaredLen);
            const declaredSuffix = fullPayload.substring(declaredLen);
            const declaredOut = this._unshuffleBody(declaredBody) + declaredSuffix;
            const declaredValid = looksLikeValidUnshuffledUrl(declaredOut);

            // Path-resolved import recovery: when the body contains a
            // recognized file extension (`.js`, `.css`, `.png`, …) we
            // likely have the path-resolution case where the browser
            // appended a literal `<filename>.<ext>` to a shuffled importer
            // URL. Try splitting at every `/` from the longest shuffled
            // prefix down and pick the FIRST split whose decoded head is
            // a valid URL. Longest valid split wins (matches browser
            // resolution, which preserves as much directory as possible).
            const looksPathResolved = PATH_RESOLVED_TAIL_RE.test(fullPayload);
            if (looksPathResolved) {
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

            // Last-ditch fallback: scan every `/` in the body and pick the
            // longest split whose decoded prefix looks valid.
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

        return str;
    }

    /** Internal: invert the position-dependent cipher over a fixed body. */
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
}

StrShuffler.baseDictionary = baseDictionary;
StrShuffler.shuffledIndicator = shuffledIndicator;
StrShuffler.shuffledIndicatorV2 = shuffledIndicatorV2;
StrShuffler.generateDictionary = generateDictionary;

/**
 * Quick check whether `str` looks like a shuffled URL fragment in either
 * format. Used by callers that only need to decide "is this shuffled?"
 * without actually decoding it.
 */
StrShuffler.isShuffled = function isShuffled(str) {
    return typeof str === 'string' && (
        str.startsWith(shuffledIndicatorV2) || str.startsWith(shuffledIndicator)
    );
};

module.exports = StrShuffler;
