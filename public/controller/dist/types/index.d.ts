import { RpcHelper } from "@mercuryworkshop/rpc";
import { type ProxyTransport } from "@mercuryworkshop/proxy-transports";
import type * as ScramjetGlobal from "@mercuryworkshop/scramjet";
import type { FrameInitHooks, SerializedCookieSyncEntry, Controllerbound, SWbound, FrameErrorHooks } from "./types";
export { HttpCachePlugin, type HttpCachePluginOptions } from "./cache";
export type Config = {
    prefix: string;
    scramjetPath: string;
    injectPath: string;
    wasmPath: string;
    virtualWasmPath: string;
    codec: Record<"encode" | "decode", (input: string) => string>;
};
export declare const config: Config;
type ControllerInit = {
    serviceworker: ServiceWorker;
    transport: ProxyTransport;
    config?: Partial<Config>;
    scramjetConfig?: Partial<ScramjetGlobal.ScramjetConfig>;
};
export declare class Controller {
    init: ControllerInit;
    id: string;
    config: Config;
    scramjetConfig: ScramjetGlobal.ScramjetConfig;
    prefix: string;
    cookieJar: ScramjetGlobal.CookieJar;
    frames: Frame[];
    serviceWorkerController: ServiceWorker;
    guardServiceWorkerRevive: boolean;
    private ready;
    private readyResolve;
    isReady: boolean;
    rpc: RpcHelper<Controllerbound, SWbound>;
    private port;
    transport: ProxyTransport;
    private cookieUpdatedAt;
    private cookieSyncPromise;
    private cookieSyncDirty;
    private cookieSyncChannel;
    private wasmAlreadyFetched;
    private wasmPayload;
    private onTabChannelMessage;
    private onCookieSyncMessage;
    private loadScramjetWasm;
    private methods;
    constructor(init: ControllerInit);
    private setupMessagePort;
    private applyCookieSyncEntries;
    propagateCookieSync(cookies: SerializedCookieSyncEntry[], options?: ScramjetGlobal.CookieSyncOptions): Promise<void>;
    private loadSavedCookies;
    persistCookies(): Promise<void>;
    setTransport(transport: ProxyTransport): void;
    createFrame(element?: HTMLIFrameElement): Frame;
    wait(): Promise<void>;
}
export declare class Frame {
    controller: Controller;
    element: HTMLIFrameElement;
    id: string;
    prefix: string;
    fetchHandler: ScramjetGlobal.ScramjetFetchHandler;
    hooks: {
        fetch: ScramjetGlobal.FetchHooks;
        init: FrameInitHooks;
        error: FrameErrorHooks;
    };
    get context(): ScramjetGlobal.ScramjetContext;
    constructor(controller: Controller, element: HTMLIFrameElement);
    back(): void;
    forward(): void;
    reload(): void;
    go(url: string): void;
}
