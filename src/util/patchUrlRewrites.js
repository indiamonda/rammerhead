/**
 * Rewrite destination URLs for sites whose JS-heavy SPAs break under
 * Hammerhead's script rewriting. Swap them to server-rendered / lite
 * versions that work correctly through the proxy.
 */

const RequestPipelineContext = require('testcafe-hammerhead/lib/request-pipeline/context/index');
const urlUtils = require('testcafe-hammerhead/lib/utils/url');

const _origDispatch = RequestPipelineContext.prototype.dispatch;

RequestPipelineContext.prototype.dispatch = function (openSessions) {
    const result = _origDispatch.call(this, openSessions);

    if (result && this.dest) {
        const host = (this.dest.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');

        // DuckDuckGo SPA → lite server-rendered version
        if (host === 'duckduckgo.com') {
            const part = this.dest.partAfterHost || '';
            const isSearchPage = /^\/?(\?.*\bq=|$)/.test(part);
            if (isSearchPage) {
                this.dest.host = 'lite.duckduckgo.com';
                this.dest.hostname = 'lite.duckduckgo.com';
                const qs = part.replace(/^\/?/, '').replace(/^\?/, '');
                this.dest.partAfterHost = qs ? '/lite/?' + qs : '/lite/';
                this.dest.url = urlUtils.formatUrl(this.dest);
                this.dest.domain = urlUtils.getDomain(this.dest);
            }
        }
    }

    return result;
};
