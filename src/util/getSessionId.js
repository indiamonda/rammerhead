// Match sessionId that precedes proxy destination (handles base path like /rammerhead/)
const PROXY_SESSION_RE = /\/([a-z0-9]{32})\/(?:https?:\/\/|_rhs~)/i;
// Fallback: first 32-char hex after slash (for paths like /sessionId/...)
const FALLBACK_RE = /^(?:[a-z0-9]+:\/\/[^/]+)?\/([a-z0-9]{32})/i;

module.exports = (reqPath) => {
    const s = reqPath || '';
    const m = s.match(PROXY_SESSION_RE);
    if (m) return m[1];
    return ((s.match(FALLBACK_RE) || [])[1]);
};
