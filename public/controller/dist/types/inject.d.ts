import type * as ScramjetGlobal from "@mercuryworkshop/scramjet";
import type { RawHeaders } from "@mercuryworkshop/proxy-transports";
import type { Config } from ".";
type Init = {
    config: Config;
    sjconfig: ScramjetGlobal.ScramjetConfig;
    prefix: URL;
    cookies: string;
    yieldGetInjectScripts: (config: Config, sjconfig: ScramjetGlobal.ScramjetConfig, prefix: URL, cookieJar: ScramjetGlobal.CookieJar, codecEncode: (input: string) => string, codecDecode: (input: string) => string) => any;
    codecEncode: (input: string) => string;
    codecDecode: (input: string) => string;
    initHeaders: RawHeaders;
    history: ScramjetGlobal.TrackedHistoryState[];
};
export declare function load(init: Init): void;
export {};
