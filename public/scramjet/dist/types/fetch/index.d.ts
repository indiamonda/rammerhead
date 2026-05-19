import { BareCompatibleClient, BareResponse, ProxyTransport, BareRequestInit } from "@mercuryworkshop/proxy-transports";
import { type URLMeta } from "../shared/rewriters/url";
import { type ScramjetRequestMode } from "./parse";
import { ScramjetHeaders } from "../shared/headers";
import { HtmlRewriterHooks, ScramjetContext } from "../shared";
import { TapInstance } from "../Tap";
import { _URL, _Map } from "../shared/snapshot";
export interface ScramjetFetchRequest {
    rawUrl: URL;
    rawReferrer: string | null;
    rawDestination: RequestDestination;
    mode: RequestMode;
    referrer: string;
    method: string;
    body: BodyType | null;
    cache: RequestCache;
    initialHeaders: ScramjetHeaders;
    rawClientUrl?: URL;
    /** The service worker FetchEvent.clientId that originated this request. */
    clientId: string;
}
export interface ScramjetFetchParsed {
    url: _URL;
    clientUrl?: _URL;
    referrerSourceUrl?: _URL | null;
    hadExtraParams: boolean;
    crossSiteRedirect: boolean;
    fetchSiteState?: "same-origin" | "same-site" | "cross-site";
    fetchInitiatorOrigin?: string;
    fetchCredentialsInclude?: boolean;
    fetchMode?: ScramjetRequestMode;
    isIframe?: boolean;
    destination: RequestDestination;
    meta: URLMeta;
    isModule: boolean;
    referrerPolicy?: string;
    trackedClient?: ScramjetFetchTrackedClient;
}
export interface ScramjetFetchResponse {
    body: BodyType;
    headers: ScramjetHeaders;
    status: number;
    statusText: string;
}
export type CookieSyncEntry = {
    url: URL;
    cookie: string;
};
export type CookieSyncOptions = {
    clear?: boolean;
    destination?: RequestDestination;
};
export type FetchHandlerInit = {
    transport: ProxyTransport;
    context: ScramjetContext;
    crossOriginIsolated?: boolean;
    sendSetCookie: (cookies: CookieSyncEntry[], options?: CookieSyncOptions) => Promise<void>;
    fetchDataUrl(dataUrl: string): Promise<BareResponse>;
    fetchBlobUrl(blobUrl: string): Promise<BareResponse>;
};
export type TrackedHistoryState = {
    url: string;
    refererPolicy?: string;
};
export declare class ScramjetFetchTrackedClient {
    clientId: string;
    history: TrackedHistoryState[];
    constructor(clientId: string);
}
export declare class ScramjetFetchHandler extends EventTarget {
    client: BareCompatibleClient;
    crossOriginIsolated: boolean;
    context: ScramjetContext;
    trackedClients: _Map<string, ScramjetFetchTrackedClient>;
    hooks: {
        rewriter: {
            html: TapInstance<HtmlRewriterHooks>;
        };
        fetch: TapInstance<FetchHooks>;
    };
    fetchDataUrl: (dataUrl: string) => Promise<Response>;
    fetchBlobUrl: (blobUrl: string) => Promise<Response>;
    sendSetCookie: (cookies: CookieSyncEntry[], options?: CookieSyncOptions) => Promise<void>;
    constructor(init: FetchHandlerInit);
    handleFetch(request: ScramjetFetchRequest): Promise<ScramjetFetchResponse>;
}
export type FetchHooks = {
    intercept: {
        context: {
            request: ScramjetFetchRequest;
            parsed: ScramjetFetchParsed;
        };
        props: {
            response?: ScramjetFetchResponse;
        };
    };
    request: {
        context: {
            request: ScramjetFetchRequest;
            parsed: ScramjetFetchParsed;
            client: BareCompatibleClient;
        };
        props: {
            init: BareRequestInit;
            url: URL;
            earlyResponse?: BareResponse;
        };
    };
    preresponse: {
        context: {
            request: ScramjetFetchRequest;
            parsed: ScramjetFetchParsed;
        };
        props: {
            response: BareResponse;
        };
    };
    response: {
        context: {
            request: ScramjetFetchRequest;
            parsed: ScramjetFetchParsed;
        };
        props: {
            response: ScramjetFetchResponse;
        };
    };
};
export type BodyType = string | ArrayBuffer | Blob | ReadableStream<any>;
