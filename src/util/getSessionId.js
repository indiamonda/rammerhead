// Extract 32-char hex session ID from URL path or full URL.
// Supports hammerhead-style metadata suffix after the id, e.g.:
//   /<id>!s!utf-8/... or /<id>!a!1!s*www.douyin.com/...
module.exports = (reqPath) => {
    const pathOnly = typeof reqPath === 'string' ? reqPath : '';

    // Allow optional \"!meta\" segments immediately after the id, before the next slash or ?.
    // Examples matched:
    //   /<id>/...
    //   /<id>!s!utf-8/...
    //   https://host/<id>!a!1!s*www.douyin.com/...
    const match =
        pathOnly.match(/^(?:[a-z0-9]+:\/\/[^/]+)?\/([a-f0-9]{32})(?:(?:![^\/\?]+)*)?(?:\/|$|\?)/i) ||
        pathOnly.match(/\/([a-f0-9]{32})(?:(?:![^\/\?]+)*)?(?:\/|$|\?)/);

    return match ? match[1] : null;
};
