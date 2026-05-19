import { ProxyCtx, ScramjetClient } from "../client";
/**
 * Maps each fast-path wrapper function back to the native function it
 * stands in for, so `Function.prototype.toString` interception
 * (sourcemaps.ts) can return the original native source string and avoid
 * leaking our wrapper's body to anti-tampering checks. Module-level so
 * it survives across module loads and is shared with sourcemaps.ts.
 */
export declare const NATIVE_BACKING: WeakMap<AnyFunction, AnyFunction>;
type AnyFunction = (...args: any[]) => any;
export declare const order = 3;
export declare const enabled: (c: ScramjetClient) => boolean;
export default function (client: ScramjetClient, self: typeof window): void;
/**
 * Legacy helper retained for backward compatibility with any consumer that
 * imported it. New code should rely on the IDL-driven hooks installed above.
 */
export declare function unproxy(ctx: ProxyCtx, client: ScramjetClient): void;
export {};
