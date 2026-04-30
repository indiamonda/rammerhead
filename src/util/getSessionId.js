// Extract 32-char hex session ID from URL path or full URL.
// Supports hammerhead-style metadata suffix after the id, e.g.:
//   /<id>!s!utf-8/... or /<id>!a!1!s*www.douyin.com/...
module.exports = (reqPath) => {
    const pathOnly = (typeof reqPath === 'string' ? reqPath : '').trim();

    // Allow optional \"!meta\" segments immediately after the id, before the next slash or ?.
    // Examples matched:
    //   /<id>/...
    //   /<id>!s!utf-8/...
    //   /studyboard/<id>!s!utf-8/...
    //   /<pathStyle>/<id>!s!utf-8/...
    //   https://host/<id>!a!1!s*www.douyin.com/...
    //
    // Use NON-GREEDY `*?` for path segments so we claim the FIRST 32-hex segment
    // as the session. If the destination URL legitimately contains a 32-hex
    // path component (Bilibili content hashes, Twitch HLS segments, jsDelivr
    // hashes, webpack chunks, …) a greedy match would mistake that for the
    // session id, then session lookup fails and the page wedges with
    // `Cannot read properties of null (reading 'sessionId')`.
    const match = pathOnly.match(
        /^(?:[a-z0-9]+:\/\/[^/]+)?(?:\/[^/]+)*?\/([a-f0-9]{32})(?:(?:![^\/\?]+)*)?(?:\/|$|\?)/i
    );

    return match ? match[1] : null;
};
