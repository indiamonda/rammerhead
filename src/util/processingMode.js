const liteHostsBySession = new WeakMap();

function normalizeHost(host) {
    return String(host || '').toLowerCase().replace(/:\d+$/, '');
}

function getSessionHostSet(session) {
    if (!session || (typeof session !== 'object' && typeof session !== 'function')) return null;
    let hosts = liteHostsBySession.get(session);
    if (!hosts) {
        hosts = new Set();
        liteHostsBySession.set(session, hosts);
    }
    return hosts;
}

function parseHostPatterns(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

const LITE_HOST_OVERRIDES = parseHostPatterns(process.env.RAMMERHEAD_LITE_HOSTS);

const BUILTIN_LITE_HOSTS = [
    '.duckduckgo.com',
];


function matchesHostPattern(host, pattern) {
    if (!host || !pattern) return false;
    if (pattern[0] === '.') return host.endsWith(pattern);
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1);
        return host.endsWith(suffix);
    }
    return host === pattern;
}

function hasLiteHostOverride(host) {
    host = normalizeHost(host);
    if (LITE_HOST_OVERRIDES.some(pattern => matchesHostPattern(host, pattern))) return true;
    return BUILTIN_LITE_HOSTS.some(pattern => matchesHostPattern(host, pattern));
}

function markLiteHost(ctx) {
    const host = normalizeHost(ctx && ctx.dest && ctx.dest.host);
    const hosts = getSessionHostSet(ctx && ctx.session);
    if (host && hosts) hosts.add(host);
}

function isMarkedLiteHost(ctx) {
    const host = normalizeHost(ctx && ctx.dest && ctx.dest.host);
    if (!host) return false;
    if (hasLiteHostOverride(host)) return true;
    const hosts = getSessionHostSet(ctx && ctx.session);
    return !!(hosts && hosts.has(host));
}

function htmlSuggestsLiteMode(html) {
    if (!html || typeof html !== 'string') return false;

    const sample = html.length > 250000 ? html.slice(0, 250000) : html;
    const scriptCount = (sample.match(/<script\b/gi) || []).length;
    const moduleScriptCount = (sample.match(/<script\b[^>]*\btype\s*=\s*["']module["']/gi) || []).length;

    if (/__NEXT_DATA__|__NUXT__|__remixContext|__vite_plugin_react_preamble_installed__/i.test(sample)) {
        return scriptCount >= 8 || moduleScriptCount >= 2;
    }

    if (/import\s*\(\s*["'`]\/(?:assets|static|_next|build|dist|chunks|bundles|js|css|cdn)\//.test(sample)) {
        return true;
    }

    if (moduleScriptCount >= 6 && /\/(?:assets|static|_next|build|dist|chunks|bundles|js|css|cdn)\//.test(sample)) {
        return true;
    }

    return false;
}

module.exports = {
    htmlSuggestsLiteMode,
    isMarkedLiteHost,
    markLiteHost,
    normalizeHost,
};
