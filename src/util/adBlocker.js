/**
 * Ad Blocker for studyboard proxy.
 *
 * Works in four layers:
 *   1. Request-level domain blocklist      — short-circuits ad-network fetches at the server
 *   2. URL path pattern blocklist          — kills ad/tracker endpoints on allowed hosts
 *   3. YouTube player response rewrite     — strips pre/mid-roll ads from /youtubei/v1/player JSON
 *   4. Per-page injections (CSS + JS)      — hides in-DOM ad containers, blocks popups/redirects
 *
 * A user toggle is transmitted via a brand-prefixed cookie (e.g. `_a_b`, `_xz3_b`).
 * When absent we default to ON; the client writes `<brand>_b=0` to disable.
 */

'use strict';

// Ad/tracker networks — blocked outright regardless of path. Includes analytics pixels since they
// are the same infrastructure used by ad systems for retargeting/fraud-detection.
const AD_DOMAINS_EXACT = new Set([
    // Google ad/analytics stack
    'pagead2.googlesyndication.com', 'googlesyndication.com', 'tpc.googlesyndication.com',
    'googleadservices.com', 'www.googleadservices.com',
    'googletagmanager.com', 'www.googletagmanager.com',
    'googletagservices.com', 'www.googletagservices.com',
    'google-analytics.com', 'www.google-analytics.com', 'ssl.google-analytics.com',
    'analytics.google.com', 'stats.g.doubleclick.net',
    'doubleclick.net', 'googleads.g.doubleclick.net', 'securepubads.g.doubleclick.net',
    'adservice.google.com', 'adservice.google.co.uk', 'adservice.google.ca',
    // Amazon ads
    'amazon-adsystem.com', 'aax.amazon-adsystem.com', 's.amazon-adsystem.com',
    'c.amazon-adsystem.com', 'fls-na.amazon.com',
    // Facebook / Meta tracking
    'connect.facebook.net', 'an.facebook.com', 'graph.facebook.com/impressions',
    // Microsoft ads / Bing
    'ads.microsoft.com', 'bat.bing.com', 'www.bing.com/aclick',
    // Major native-ad networks
    'taboola.com', 'cdn.taboola.com', 'trc.taboola.com',
    'outbrain.com', 'widgets.outbrain.com', 'odb.outbrain.com', 'log.outbrain.com',
    'revcontent.com', 'cdn.revcontent.com', 'trends.revcontent.com',
    'mgid.com', 'servicer.mgid.com', 'jsc.mgid.com',
    // Programmatic / retargeting networks
    'criteo.com', 'static.criteo.net', 'cat.da.us.criteo.com', 'bidder.criteo.com',
    'adnxs.com', 'secure.adnxs.com', 'ib.adnxs.com',
    'adsrvr.org', 'match.adsrvr.org', 'insight.adsrvr.org',
    'rubiconproject.com', 'pixel.rubiconproject.com', 'fastlane.rubiconproject.com',
    'openx.net', 'rtb.openx.net', 'us-u.openx.net',
    'pubmatic.com', 'image2.pubmatic.com', 'ads.pubmatic.com',
    'casalemedia.com', 'as-sec.casalemedia.com',
    'moatads.com', 'z.moatads.com',
    'adsafeprotected.com', 'pixel.adsafeprotected.com', 'static.adsafeprotected.com',
    'scorecardresearch.com', 'sb.scorecardresearch.com',
    'quantserve.com', 'pixel.quantserve.com', 'secure.quantserve.com',
    'ads-twitter.com', 'analytics.twitter.com',
    'advertising.com', 'adap.tv', 'tlx.advertising.com',
    // Popup / popunder / malvertising networks
    'popads.net', 'serve.popads.net', 'c1.popads.net',
    'popcash.net', 'cdn.popcash.net',
    'propellerads.com', 'onclkds.com', 'go.onclkds.com',
    'adsterra.com', 'go.adsterra.com', 'syndication.exosrv.com',
    'exoclick.com', 'syndication.exdynsrv.com', 'ads.exoclick.com',
    'juicyads.com', 'cdn.juicyads.com', 'ads.juicyads.com',
    'plugrush.com', 'click.plugrush.com', 'go.plugrush.com',
    'trafficjunky.net', 'ads.trafficjunky.net',
    'trafficstars.com', 'syndication.trafficstars.com', 'tsyndicate.com',
    'zeydoo.com', 'onlineloadpgm.com', 'bemobtrack.com',
    'adcash.com', 'go.adcash.com', 'www.adcash.com',
    'mellowads.com', 'adblade.com', 'bidgear.com',
    // Analytics / session replay (often tied to ad scoring)
    'hotjar.com', 'static.hotjar.com', 'script.hotjar.com',
    'cdn.mxpnl.com', 'api.mixpanel.com', 'api-js.mixpanel.com',
    'cdn.segment.com', 'api.segment.io', 'api.segment.com',
    'cdn.mouseflow.com', 'n1.mouseflow.com',
    'fullstory.com', 'rs.fullstory.com', 'edge.fullstory.com',
    'clarity.ms', 'www.clarity.ms', 'c.clarity.ms',
    'matomo.cloud', 'matomo.org',
    // Miscellaneous ad/tracker hosts
    'b.scorecardresearch.com', 'p.scorecardresearch.com',
    'adlightning.com', 'ad-delivery.net', 'adroll.com', 's.adroll.com',
    'bluekai.com', 'tags.bluekai.com', 'demdex.net',
    'innity.com', 'innity.net', 'cdn.innity.net',
    'smartadserver.com', 'www.smartadserver.com',
    'yieldmo.com', 'ads.yieldmo.com',
    'indexww.com', 'casalemedia.com', 'magnite.com',
    '3lift.com', 'ib.3lift.com',
    'contextweb.com', 'yieldlab.com', 'yieldlab.net',
    'sovrn.com', 'ap.lijit.com', 'beacon.sovrn.com',
    'sharethrough.com', 'btlr.sharethrough.com',
    'smaato.net', 'ad.smaato.net',
    'fwmrm.net', 'a1.fwmrm.net',
    'adition.com', 'ad4.adition.com',
    // Gaming-site + unblocker-site ad networks (gn-math, tyrones-unblocked, cool-math, etc.)
    'rev.iq', 'js.rev.iq', 'cdn.rev.iq', 'static.rev.iq',
    'kueezrtb.com', 'static.kueezrtb.com', 'track.kueezrtb.com',
    'otrack.kueezrtb.com', 'gtrack.kueezrtb.com', 'ads.kueezrtb.com',
    'kueez.com', 'cdn.kueez.com', 'static.kueez.com',
    'r9x.in', 'cdn.r9x.in', 'ads.r9x.in',
    'motorsnag.com', 'cdn.motorsnag.com',
    'venatusmedia.com', 'cdn.venatusmedia.com', 'ads.venatusmedia.com',
    'snigelweb.com', 'cdn.snigelweb.com', 'ads.snigelweb.com',
    'adinplay.com', 'api.adinplay.com', 'cdn.adinplay.com',
    'tpid.ws', 'cdn.tpid.ws', 'tyche.pw', 'cdn.tyche.pw',
    'revrolldirect.com', 'cdn.revrolldirect.com',
    'playwire.com', 'cdn.playwire.com', 'config.playwire.com',
    'ezoic.net', 'go.ezodn.com', 'go.ezoic.net', 'ssl.ezoic.net',
    'nitropay.com', 'cdn.nitropay.com', 'api.nitropay.com', 'ns.nitropay.com',
    'adthrive.com', 'ads.adthrive.com', 'scripts.adthrive.com',
    'monumetric.com', 'cdn.monumetric.com', 'ads.monumetric.com',
    'mediavine.com', 'scripts.mediavine.com', 'cls.mediavine.com',
    'freestar.com', 'a.pub.network', 'b.pub.network', 'c.pub.network',
    'pub.network', 'ss.pub.network',
    'raptive.com', 'scripts.raptive.com',
    'onetag-sys.com', 'cdn.onetag-sys.com',
    'onclickperformance.com', 'pushground.com',
    'clickadilla.com', 'clickaine.com', 'clixad.com',
    'popmyads.com', 'pubdirecte.com',
    'adsco.re', 'anyclip.com', 'cdn.anyclip.com', 'player.anyclip.com',
    'engageya.com', 'v.engageya.com', 'widget.engageya.com',
    'primis.tech', 'live.primis.tech', 'edge.primis.tech',
    'connatix.com', 'cdn.connatix.com', 'vid.connatix.com',
    'crsspxl.com', 'tags.crsspxl.com',
    'blueconic.net', 'tags.blueconic.net',
    'undertone.com', 'cdn.undertone.com',
    'inmobi.com', 'i.w.inmobi.com',
    'chartboost.com', 'live.chartboost.com',
    'vungle.com', 'api.vungle.com',
    'applovin.com', 'ms.applovin.com',
    'onclckds.com', 'clkads.com',
    // Social-network pixels / retargeting (not the main domains, just their tracking endpoints)
    'snap.licdn.com', 'px.ads.linkedin.com',
    'ct.pinterest.com', 'log.pinterest.com', 'widgets.pinterest.com',
    'analytics.tiktok.com', 'business-api.tiktok.com',
    'sb.scorecardresearch.com', 'b.scorecardresearch.com',
    'ads.reddit.com', 'events.reddit.com',
    'static.ads-twitter.com',
    // Video-ad SDKs (VAST/VPAID players embedded by publishers)
    'imasdk.googleapis.com', 'pagead2.googleadservices.com',
    'ima3.js', 'ads.youtube.com',
    'cdn.spotxchange.com', 'js.spotx.tv',
    'aniview.com', 'player.aniview.com', 'track.aniview.com',
    'brid.tv', 'cdn.brid.tv', 'services.brid.tv',
    'unrulymedia.com', 'video.unrulymedia.com',
    'teads.tv', 's8t.teads.tv', 'a.teads.tv',
    'jwpsrv.com', 'analytics.jwpcdn.com',
    // Comment/embed trackers that double as ad-scoring pixels
    'disquscdn.com/count-data', 'links.services.disqus.com',
    'spot.im', 'www.spot.im', 'static.spot.im', 'events.spot.im',
    'apester.com', 'media.apester.com',
    'jeeng.com', 'cdn.jeeng.com',
    'shareaholic.com', 'cdn.shareaholic.com', 'launchpad.shareaholic.com',
    'addthis.com', 's7.addthis.com', 'm.addthis.com',
    'sharethis.com', 'w.sharethis.com', 'buttons.sharethis.com',
    // Integral Ad Science / viewability pixels
    'iasds01.com', 'static.iasds01.com', 'pixel.iasds01.com',
    'adsafeprotected.com', 'dt.adsafeprotected.com',
    // Session replay + marketing analytics (heavy trackers)
    'snowplowanalytics.com', 'collector.snowplowanalytics.com',
    'smartlook.com', 'rec.smartlook.com',
    'luckyorange.com', 'cs.luckyorange.net',
    'crazyegg.com', 'script.crazyegg.com',
    'chartbeat.com', 'ping.chartbeat.net', 'static.chartbeat.com',
    'parsely.com', 'cdn.parsely.com', 'srv.buysellads.com',
    // Push-notification ad networks (browser-push malvertising)
    'push-ads.net', 'pushhouse.com', 'pushuncle.com', 'rollerads.com',
    'notix.co', 'cdn.notix.co', 'push.ads.push-ads.net',
    'webpush.io', 'push.world', 'onesignal-ads.com',
    // Crypto-mining / background worker ad alternatives
    'coinhive.com', 'coin-hive.com', 'crypto-loot.com', 'jsecoin.com',
    'authedmine.com', 'webminepool.com', 'minero.cc',
    // More affiliate/tracking networks
    'skimresources.com', 'go.skimresources.com', 'r.skimresources.com',
    'viglink.com', 'go.redirectingat.com', 'api.viglink.com',
    'commission-junction.com', 'commissionjunction.com', 'www.dpbolvw.net',
    'anrdoezrs.net', 'jdoqocy.com', 'qksrv.net', 'tkqlhce.com',
    'impact-ad.jp', 'impact.com', 'impactradius.com',
    'cj.dotomi.com', 'dotomi.com',
    'rakuten-advertising.com', 'rakutenmarketing.com', 'linksynergy.com',
    // Popup-bait / redirect-bait networks
    'tnative.com', 'n.native.com', 'cpmleader.com', 'cpxcenter.com',
    'smowtion.com', 'ads.smowtion.com',
    'propellerads.com', 'propellerads2.com', 'propellerclick.com',
    // Unity / mobile game ad networks often active in-browser
    'unityads.unity3d.com', 'webview.unityads.unity3d.com',
    'ads.mopub.com', 'analytics.mopub.com',
]);

// Suffix-matched ad/tracker TLDs — blocks all subdomains of these hosts.
const AD_DOMAINS_SUFFIX = [
    '.doubleclick.net', '.googlesyndication.com', '.googleadservices.com',
    '.google-analytics.com', '.googletagmanager.com', '.googletagservices.com',
    '.amazon-adsystem.com', '.adnxs.com', '.adsrvr.org',
    '.criteo.com', '.criteo.net', '.rubiconproject.com', '.openx.net',
    '.pubmatic.com', '.casalemedia.com', '.moatads.com',
    '.adsafeprotected.com', '.scorecardresearch.com', '.quantserve.com',
    '.outbrain.com', '.taboola.com', '.revcontent.com', '.mgid.com',
    '.popads.net', '.popcash.net', '.propellerads.com', '.adsterra.com',
    '.exoclick.com', '.exosrv.com', '.exdynsrv.com', '.juicyads.com',
    '.plugrush.com', '.trafficjunky.net', '.trafficstars.com',
    '.zeydoo.com', '.adcash.com', '.mellowads.com',
    '.hotjar.com', '.mixpanel.com', '.segment.io',
    '.mouseflow.com', '.fullstory.com', '.clarity.ms',
    '.bluekai.com', '.demdex.net', '.smartadserver.com', '.yieldmo.com',
    '.3lift.com', '.sharethrough.com', '.smaato.net', '.fwmrm.net',
    '.adroll.com', '.innity.net', '.sovrn.com',
    '.onclkds.com', '.adblade.com', '.bidgear.com',
    // Generic TLDs heavy on redirect malvertising
    '.tsyndicate.com', '.bemobtrack.com', '.onlineloadpgm.com',
    '.popmansion.com', '.dailysurveyoffers.com',
    // Gaming/unblocker-site ad networks (suffix-match to catch all subdomains)
    '.kueezrtb.com', '.kueez.com', '.rev.iq', '.r9x.in',
    '.motorsnag.com', '.venatusmedia.com', '.snigelweb.com',
    '.adinplay.com', '.tpid.ws', '.tyche.pw', '.revrolldirect.com',
    '.playwire.com', '.ezoic.net', '.ezodn.com', '.ezoic.com',
    '.nitropay.com', '.adthrive.com', '.monumetric.com',
    '.mediavine.com', '.freestar.com', '.pub.network', '.raptive.com',
    '.onetag-sys.com', '.onclickperformance.com', '.pushground.com',
    '.clickadilla.com', '.clixad.com', '.popmyads.com',
    '.pubdirecte.com', '.anyclip.com', '.engageya.com',
    '.primis.tech', '.connatix.com', '.crsspxl.com', '.blueconic.net',
    '.undertone.com', '.inmobi.com', '.chartboost.com',
    '.vungle.com', '.applovin.com', '.onclckds.com',
    '.adsco.re', '.clkads.com',
    // Social retargeting / analytics pixels (suffix-match).
    // NOTE: do NOT add `.tiktok.com`, `.pinterest.com`, or `.licdn.com` here
    // even though they host tracking subdomains — JS suffix-match would also
    // hit `www.tiktok.com`, `pinterest.com`, `media.licdn.com`, etc. and
    // black-hole the user's actual navigation. The specific tracking
    // endpoints (analytics.tiktok.com, business-api.tiktok.com,
    // ct.pinterest.com, log.pinterest.com, widgets.pinterest.com,
    // snap.licdn.com, px.ads.linkedin.com, …) are already listed exactly in
    // AD_DOMAINS_EXACT above, which only matches the exact host.
    '.ads-twitter.com', '.teads.tv', '.aniview.com', '.brid.tv',
    '.unrulymedia.com', '.spotxchange.com', '.jwpsrv.com',
    '.shareaholic.com', '.addthis.com', '.sharethis.com',
    '.iasds01.com', '.snowplowanalytics.com',
    '.smartlook.com', '.luckyorange.net', '.crazyegg.com',
    '.chartbeat.com', '.chartbeat.net', '.parsely.com',
    '.skimresources.com', '.viglink.com',
    '.commission-junction.com', '.linksynergy.com',
    '.anrdoezrs.net', '.jdoqocy.com', '.qksrv.net', '.tkqlhce.com',
    '.dpbolvw.net', '.rakutenmarketing.com', '.rakuten-advertising.com',
    '.notix.co', '.rollerads.com', '.pushhouse.com', '.pushuncle.com',
    '.coinhive.com', '.coin-hive.com', '.crypto-loot.com',
    '.authedmine.com', '.webminepool.com',
    '.mopub.com', '.unityads.unity3d.com',
    '.spot.im', '.apester.com', '.jeeng.com',
    // Rest of common single-word TLDs associated with malvertising
    '.smowtion.com', '.cpmleader.com', '.cpxcenter.com',
];

// Path-level patterns — block ad endpoints on hosts we don't want to block entirely.
// Each pattern is a regex compiled against the URL's pathname. Alternatives are joined
// with `|`; the test is run AFTER the domain allow/block checks.
const AD_PATH_RE = new RegExp([
    // Google / DoubleClick variants on non-ad domains (e.g. youtube.com/pagead, google.com/ads)
    '/pagead/',
    '/ad_status\\.js',
    '/get_ads(?:\\?|$)',
    '/get_midroll_info',
    '/adsense/',
    '/adserver/',
    '/adsbygoogle\\.js',
    '/gtm\\.js',
    '/fbevents\\.js',
    '/fbq-pixel\\.js',
    // YouTube in-video tracking + ad pings
    '/youtubei/v1/log_event',
    '/youtubei/v1/feedback',
    '/api/stats/ads',
    '/api/stats/qoe',
    '/api/stats/atr',
    '/api/stats/watchtime',
    '/ptracking(?:\\?|$)',
    // Generic ad paths
    '/\\b(ad|ads|adv|advert|advertising|adserv|adserver)/[^/]*\\.(js|gif|png|jpe?g|html)',
    '/banners?/',
    '/popup/',
    '/popunder/',
    '/prebid\\.js',
    '/amp-auto-ads',
    '/amp4ads',
    '/hbopenbid/',
    '/usersync',
    '/tracker\\.js',
    '/beacon(?:\\?|$)',
    '/pixel(?:\\?|\\.gif)',
    '/affiliate/',
    // Ad loader scripts named after a target site (e.g. ailogic_gn-math.dev_obf.js)
    '/ailogic[_\\-][^/]+_obf\\.js',
    '/(?:ads?|pop|push|click|redirect)[_\\-][a-z0-9]{4,}\\.js',
    // Common "?key=<random-hex>" endpoints used by popup networks
    '/[a-z0-9]{6,12}\\?key=[a-f0-9]{16,}',
    // Tracking pixel / beacon endpoints (tightened to only hit obvious analytics paths;
    // must end in .gif/.png and live under /pixel|/p|/track|/collect to be considered an ad).
    '/p\\.gif$', '/pixel\\.(?:gif|png)$',
    '/(?:track|collect|beacon|telemetry)/[a-z0-9_\\-./]*\\.(?:gif|png|jpg|js|json)$',
    // Google AdSense auto ads + prebid bundles
    '/adsbygoogle/[a-z0-9.]*\\.js', '/pubads_impl\\.js',
    '/prebid[-_][\\d.]+\\.js',
    // Video ad VAST/VPAID endpoints
    '/vast[\\d]*\\.xml', '/vmap[\\d]*\\.xml', '/vpaid/',
    '/midroll', '/preroll(?:\\?|$)',
    // Session-replay recordings (often privacy invasive)
    '/sessionreplay/', '/r/[a-zA-Z0-9]{10,}\\.js',
    // Push-notification service worker registrations used for ads
    '/sw-push\\.js', '/push[-_]notifications?\\.js',
].join('|'), 'i');

// URLs whose *response body* needs rewriting (not blocking outright).
// Used by patchPageProcessing to intercept YouTube player config.
const YOUTUBE_PLAYER_RE = /youtube(?:-nocookie)?\.com\/youtubei\/v\d+\/player(?:\?|$)/i;
const YOUTUBE_AD_PATH_RE = /youtube(?:-nocookie)?\.com\/(api\/stats\/ads|pagead|get_midroll_info|api\/stats\/atr|ptracking|generate_204_simple|api\/stats\/qoe)/i;

const ALLOWLIST_HOST_RE = /(^|\.)(studyboard|turbowarp|scratch|mit\.edu|poki|chatgpt|openai|claude|anthropic|github|duckduckgo|deepseek|jmail|mk48)\./i;

/** Returns true when the host is an allowlisted first-party we never block. */
function _isAllowlisted(host) {
    if (!host) return false;
    return ALLOWLIST_HOST_RE.test(host);
}

/**
 * Core check: does `url` look like an ad / tracker that should be short-circuited?
 * @param {string} url   absolute https?:// URL
 * @returns {boolean}
 */
function shouldBlockUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try { parsed = new URL(url); } catch (_) { return false; }
    const host = parsed.hostname.toLowerCase();

    // Never block the proxy host or core allowlisted origins
    if (_isAllowlisted(host)) {
        // Still allow path-level blocks on allowlisted hosts (e.g. youtube.com/pagead)
        if (YOUTUBE_AD_PATH_RE.test(host + parsed.pathname)) return true;
        if (/(^|\.)youtube(?:-nocookie)?\.com$/.test(host) && AD_PATH_RE.test(parsed.pathname)) return true;
        return false;
    }

    if (AD_DOMAINS_EXACT.has(host)) return true;
    for (let i = 0; i < AD_DOMAINS_SUFFIX.length; i++) {
        if (host.endsWith(AD_DOMAINS_SUFFIX[i])) return true;
    }
    if (AD_PATH_RE.test(parsed.pathname)) return true;

    return false;
}

/** 1×1 transparent GIF. Used to stub image requests so layout doesn't break. */
const PIXEL_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
    'base64'
);

/** Pick a minimal response body + Content-Type based on the request's expected resource type. */
function _stubResponseFor(url, acceptHeader, destHeader) {
    const path = url.split('?')[0].toLowerCase();
    const accept = (acceptHeader || '').toLowerCase();
    const dest = (destHeader || '').toLowerCase();

    if (dest === 'image' || /\.(gif|png|jpe?g|webp|svg|ico)(\?|$)/.test(path) || accept.includes('image/')) {
        return { status: 200, ct: 'image/gif', body: PIXEL_GIF, cache: true };
    }
    if (dest === 'script' || /\.(js|mjs)(\?|$)/.test(path) || accept.includes('javascript')) {
        return { status: 200, ct: 'application/javascript; charset=utf-8', body: Buffer.from('', 'utf-8'), cache: true };
    }
    if (dest === 'style' || /\.css(\?|$)/.test(path) || accept.includes('text/css')) {
        return { status: 200, ct: 'text/css; charset=utf-8', body: Buffer.from('', 'utf-8'), cache: true };
    }
    if (dest === 'iframe' || dest === 'frame' || accept.includes('text/html')) {
        return { status: 200, ct: 'text/html; charset=utf-8', body: Buffer.from('<!doctype html><title>Blocked</title>', 'utf-8'), cache: true };
    }
    if (accept.includes('application/json')) {
        return { status: 200, ct: 'application/json; charset=utf-8', body: Buffer.from('{}', 'utf-8'), cache: true };
    }
    // Pings, beacons, POST trackers — 204 (no content)
    return { status: 204, ct: null, body: Buffer.alloc(0), cache: false };
}

/** Build the HTTP headers for a stub response. */
function _stubHeaders(origin, stub) {
    const h = {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
        'X-StudyBoard-Blocked': '1',
    };
    if (stub.ct) h['Content-Type'] = stub.ct;
    h['Content-Length'] = stub.body.length;
    h['Cache-Control'] = stub.cache ? 'public, max-age=86400, immutable' : 'no-store';
    return h;
}

/**
 * Send a stub response for a blocked request. Caller must already have verified the block.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} originalUrl   the real destination URL (with protocol and host)
 */
function writeBlockedResponse(req, res, originalUrl) {
    try {
        const accept = req.headers['accept'] || '';
        const dest = req.headers['sec-fetch-dest'] || '';
        const stub = _stubResponseFor(originalUrl, accept, dest);
        const headers = _stubHeaders(req.headers['origin'] || '', stub);
        res.writeHead(stub.status, headers);
        res.end(stub.body);
    } catch (_) {
        try { res.writeHead(204); res.end(); } catch (__) { /* client disconnected */ }
    }
}

const config = require('../config');
const _adCookieName = config.brand + '_b';

/**
 * Is the ad blocker enabled for this request? Checks the brand-prefixed cookie.
 * Absent or `1` → enabled. `0` → disabled.
 */
function isEnabledFor(req) {
    const cookie = req.headers.cookie || '';
    if (!cookie) return true;
    const re = new RegExp('(?:^|;\\s*)' + _adCookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=(0|1)');
    const m = cookie.match(re);
    if (!m) return true;
    return m[1] === '1';
}

// ---------------------------------------------------------------------------
// YouTube player response rewriter — strips ad blocks from the JSON config
// returned by /youtubei/v1/player. Runs over a decoded body (string).
// ---------------------------------------------------------------------------
function rewriteYoutubePlayerJson(json) {
    try {
        const obj = JSON.parse(json);
        let changed = false;

        // Top-level ad slot containers — remove entirely
        const adKeys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
        for (const k of adKeys) if (k in obj) { delete obj[k]; changed = true; }

        // playerConfig.adPlayerConfig — often contains pre-roll scheduling
        if (obj.playerConfig) {
            if (obj.playerConfig.adPlayerConfig) { delete obj.playerConfig.adPlayerConfig; changed = true; }
            if (obj.playerConfig.adUxConfig) { delete obj.playerConfig.adUxConfig; changed = true; }
        }

        // videoDetails.isLiveContent: harmless. But `videoDetails.iurl` etc. are fine.
        // Ensure the player knows playback is un-monetized — this is what triggers the
        // "video unavailable" screen when YouTube expects ads and none are served, so we
        // tell the client the video is monetisable but no ads were returned.
        if (obj.playabilityStatus && obj.playabilityStatus.status !== 'OK') {
            // Force OK so age-gated / sign-in-walled ads don't hijack playback
            if (obj.playabilityStatus.status === 'ERROR' || obj.playabilityStatus.status === 'LOGIN_REQUIRED') {
                // leave alone — those are real errors
            }
        }

        // Remove tracking params inside streamingData / captionTracks
        if (obj.streamingData && Array.isArray(obj.streamingData.adaptiveFormats)) {
            obj.streamingData.adaptiveFormats.forEach(fmt => {
                if (fmt.signatureCipher) return; // leave signature alone
            });
        }

        return changed ? JSON.stringify(obj) : json;
    } catch (_) {
        return json;
    }
}

module.exports = {
    shouldBlockUrl,
    writeBlockedResponse,
    isEnabledFor,
    rewriteYoutubePlayerJson,
    YOUTUBE_PLAYER_RE,
    YOUTUBE_AD_PATH_RE,
    AD_DOMAINS_EXACT,
    AD_DOMAINS_SUFFIX,
    AD_PATH_RE,
};
