import type * as ScramjetGlobal from "@mercuryworkshop/scramjet";
declare const $scramjet: typeof ScramjetGlobal;
export declare const CACHE_NAME = "scramjet-http-cache-v2";
export interface HttpCachePluginOptions {
    /** Name of the underlying Cache API entry. Defaults to CACHE_NAME. */
    cacheName?: string;
}
/**
 * RFC-9111-ish HTTP cache for ScramjetFetchHandler. Subclasses
 * `$scramjet.Plugin` so it composes with the same hook plumbing every other
 * scramjet plugin uses; `install(target)` wires it onto a Frame (or any
 * object exposing a `fetchHandler`), and `bust()` drops the underlying
 * `caches` entry.
 *
 * One instance can be installed onto multiple Frames -- the WeakMap of
 * "did this request come from cache?" book-keeping is per-instance, not
 * per-Frame, so nothing leaks across installs.
 */
export declare class HttpCachePlugin extends $scramjet.Plugin {
    readonly cacheName: string;
    private cachePromise;
    private cameFromCache;
    constructor(options?: HttpCachePluginOptions);
    /** Lazy-open the underlying Cache. Memoized for the plugin's lifetime. */
    private openCache;
    /**
     * Wire the cache up to a Frame (or anything exposing `fetchHandler`).
     * Safe to call multiple times across different Frames.
     */
    install(target: {
        fetchHandler: ScramjetGlobal.ScramjetFetchHandler;
    }): void;
    /**
     * Drop every entry in the HTTP cache. Returns whether the underlying
     * Cache existed and was deleted.
     */
    bust(): Promise<boolean>;
}
export {};
