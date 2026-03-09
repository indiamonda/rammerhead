// Extract 32-char hex session ID from URL path or full URL (e.g. /id/... or https://host/id/...)
module.exports = (reqPath) => {
    const pathOnly = typeof reqPath === 'string' ? reqPath : '';
    const match = pathOnly.match(/^(?:[a-z0-9]+:\/\/[^/]+)?\/([a-f0-9]{32})(?:\/|$|\?)/i)
        || pathOnly.match(/\/([a-f0-9]{32})(?:\/|$|\?)/);
    return match ? match[1] : null;
};
