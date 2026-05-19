import { ScramjetClient } from "./index";
export declare const UNSAFE_GLOBALS: string[];
export declare function createGlobalProxy(client: ScramjetClient, self: typeof globalThis): typeof globalThis;
export declare function createDocumentProxy(client: ScramjetClient, self: typeof globalThis): any;
