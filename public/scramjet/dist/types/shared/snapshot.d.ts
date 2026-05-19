export declare const String: StringConstructor;
export declare const String_fromCodePoint: (...codePoints: number[]) => string;
export declare const String_fromCharCode: (...codes: number[]) => string;
export declare const Number: NumberConstructor;
export declare const Number_parseInt: (string: string, radix?: number) => number;
export declare const Object_keys: {
    (o: object): string[];
    (o: {}): string[];
};
export declare const Object_values: {
    <T>(o: {
        [s: string]: T;
    } | ArrayLike<T>): T[];
    (o: {}): any[];
};
export declare const Object_entries: {
    <T>(o: {
        [s: string]: T;
    } | ArrayLike<T>): [string, T][];
    (o: {}): [string, any][];
};
export declare const Object_hasOwn: (o: object, v: PropertyKey) => boolean;
export declare const Object_getOwnPropertyNames: (o: any) => string[];
export declare const Object_getOwnPropertyDescriptor: (o: any, p: PropertyKey) => PropertyDescriptor | undefined;
export declare const Object_getOwnPropertyDescriptors: <T>(o: T) => { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & {
    [x: string]: PropertyDescriptor;
};
export declare const Object_getOwnPropertySymbols: (o: any) => symbol[];
export declare const Object_defineProperty: <T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>) => T;
export declare const Object_defineProperties: <T>(o: T, properties: PropertyDescriptorMap & ThisType<any>) => T;
export declare const Object_setPrototypeOf: (o: any, proto: object | null) => any;
export declare const Reflect_get: typeof Reflect.get;
export declare const Reflect_set: typeof Reflect.set;
export declare const Reflect_has: typeof Reflect.has;
export declare const Reflect_ownKeys: typeof Reflect.ownKeys;
export declare const Reflect_construct: typeof Reflect.construct;
export declare const Reflect_apply: typeof Reflect.apply;
export declare const Array_from: {
    <T>(arrayLike: ArrayLike<T>): T[];
    <T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
    <T>(iterable: Iterable<T> | ArrayLike<T>): T[];
    <T, U>(iterable: Iterable<T> | ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
};
export declare const Array_isArray: (arg: any) => arg is any[];
export declare const Array_of: <T>(...items: T[]) => T[];
export declare const JSON_parse: (text: string, reviver?: (this: any, key: string, value: any) => any) => any;
export declare const JSON_stringify: {
    (value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;
    (value: any, replacer?: (number | string)[] | null, space?: string | number): string;
};
export declare const TextEncoder_encode: any;
export declare const TextDecoder_decode: any;
export declare const Performance_now: any;
export declare const btoa: typeof globalThis.btoa;
export declare const atob: typeof globalThis.atob;
export declare const URL_createObjectURL: any;
export declare const URL_revokeObjectURL: any;
export declare const Error: ErrorConstructor;
export declare const Math_random: () => number;
export declare const Math_min: (...values: number[]) => number;
export declare const Promise_all: any;
export declare const Promise_race: any;
export declare const Promise_resolve: any;
export declare const Promise_reject: any;
export declare const Promise_allSettled: any;
export declare const Promise_any: any;
export declare const Symbol_for: (key: string) => symbol;
declare const WrappedBrand: unique symbol;
type WrappedInstance<T> = T extends object ? Wrapped<T> : T;
export type Wrapped<T> = T extends abstract new (...args: infer Args) => infer Instance ? Omit<T, "prototype"> & {
    new (...args: Args): WrappedInstance<Instance>;
    prototype: WrappedInstance<Instance>;
    readonly [WrappedBrand]: T;
} : T & {
    readonly [WrappedBrand]: T;
};
export declare const _URL: Omit<{
    new (url: string | URL, base?: string | URL): URL;
    prototype: URL;
    canParse(url: string | URL, base?: string | URL): boolean;
    createObjectURL(obj: Blob | MediaSource): string;
    parse(url: string | URL, base?: string | URL): URL | null;
    revokeObjectURL(url: string): void;
}, "prototype"> & {
    new (url: string | URL, base?: string | URL): URL & {
        readonly [WrappedBrand]: URL;
    };
    prototype: URL & {
        readonly [WrappedBrand]: URL;
    };
    readonly [WrappedBrand]: {
        new (url: string | URL, base?: string | URL): URL;
        prototype: URL;
        canParse(url: string | URL, base?: string | URL): boolean;
        createObjectURL(obj: Blob | MediaSource): string;
        parse(url: string | URL, base?: string | URL): URL | null;
        revokeObjectURL(url: string): void;
    };
};
export type _URL = Wrapped<URL>;
export declare const _Headers: Omit<{
    new (init?: HeadersInit): Headers;
    prototype: Headers;
}, "prototype"> & {
    new (init?: HeadersInit): Headers & {
        readonly [WrappedBrand]: Headers;
    };
    prototype: Headers & {
        readonly [WrappedBrand]: Headers;
    };
    readonly [WrappedBrand]: {
        new (init?: HeadersInit): Headers;
        prototype: Headers;
    };
};
export type _Headers = Wrapped<Headers>;
export declare const _Date: Omit<DateConstructor, "prototype"> & {
    new (value: string | number | Date): Date & {
        readonly [WrappedBrand]: Date;
    };
    prototype: Date & {
        readonly [WrappedBrand]: Date;
    };
    readonly [WrappedBrand]: DateConstructor;
};
export type _Date = Wrapped<Date>;
export declare const _URLSearchParams: Omit<{
    new (init?: string[][] | Record<string, string> | string | URLSearchParams): URLSearchParams;
    prototype: URLSearchParams;
}, "prototype"> & {
    new (init?: string | Record<string, string> | string[][] | URLSearchParams): URLSearchParams & {
        readonly [WrappedBrand]: URLSearchParams;
    };
    prototype: URLSearchParams & {
        readonly [WrappedBrand]: URLSearchParams;
    };
    readonly [WrappedBrand]: {
        new (init?: string[][] | Record<string, string> | string | URLSearchParams): URLSearchParams;
        prototype: URLSearchParams;
    };
};
export type _URLSearchParams = Wrapped<URLSearchParams>;
export declare const _RegExp: Omit<RegExpConstructor, "prototype"> & {
    new (pattern: string | RegExp, flags?: string): RegExp & {
        readonly [WrappedBrand]: RegExp;
    };
    prototype: RegExp & {
        readonly [WrappedBrand]: RegExp;
    };
    readonly [WrappedBrand]: RegExpConstructor;
};
export type _RegExp = Wrapped<RegExp>;
export declare const _Set: Omit<SetConstructor, "prototype"> & {
    new (iterable?: Iterable<unknown>): Set<unknown> & {
        readonly [WrappedBrand]: Set<unknown>;
    };
    prototype: Set<unknown> & {
        readonly [WrappedBrand]: Set<unknown>;
    };
    readonly [WrappedBrand]: SetConstructor;
};
export type _Set<T> = Wrapped<Set<T>>;
export declare const _Map: Omit<MapConstructor, "prototype"> & {
    new (iterable?: Iterable<readonly [unknown, unknown]>): Map<unknown, unknown> & {
        readonly [WrappedBrand]: Map<unknown, unknown>;
    };
    prototype: Map<unknown, unknown> & {
        readonly [WrappedBrand]: Map<unknown, unknown>;
    };
    readonly [WrappedBrand]: MapConstructor;
};
export type _Map<K, V> = Wrapped<Map<K, V>>;
export declare const _WeakSet: Omit<WeakSetConstructor, "prototype"> & {
    new (iterable: Iterable<WeakKey>): WeakSet<WeakKey> & {
        readonly [WrappedBrand]: WeakSet<WeakKey>;
    };
    prototype: WeakSet<WeakKey> & {
        readonly [WrappedBrand]: WeakSet<WeakKey>;
    };
    readonly [WrappedBrand]: WeakSetConstructor;
};
export type _WeakSet<T extends object> = Wrapped<WeakSet<T>>;
export declare const _WeakMap: Omit<WeakMapConstructor, "prototype"> & {
    new (iterable: Iterable<readonly [WeakKey, unknown]>): WeakMap<WeakKey, unknown> & {
        readonly [WrappedBrand]: WeakMap<WeakKey, unknown>;
    };
    prototype: WeakMap<WeakKey, unknown> & {
        readonly [WrappedBrand]: WeakMap<WeakKey, unknown>;
    };
    readonly [WrappedBrand]: WeakMapConstructor;
};
export type _WeakMap<K extends object, V extends object> = Wrapped<WeakMap<K, V>>;
export declare const _Uint8Array: Omit<Uint8ArrayConstructor, "prototype"> & {
    new (): Uint8Array<ArrayBuffer> & {
        readonly [WrappedBrand]: Uint8Array<ArrayBuffer>;
    };
    prototype: Uint8Array<ArrayBuffer> & {
        readonly [WrappedBrand]: Uint8Array<ArrayBuffer>;
    };
    readonly [WrappedBrand]: Uint8ArrayConstructor;
};
export type _Uint8Array = Wrapped<Uint8Array>;
export declare const _TextDecoder: Omit<{
    new (label?: string, options?: TextDecoderOptions): TextDecoder;
    prototype: TextDecoder;
}, "prototype"> & {
    new (label?: string, options?: TextDecoderOptions): TextDecoder & {
        readonly [WrappedBrand]: TextDecoder;
    };
    prototype: TextDecoder & {
        readonly [WrappedBrand]: TextDecoder;
    };
    readonly [WrappedBrand]: {
        new (label?: string, options?: TextDecoderOptions): TextDecoder;
        prototype: TextDecoder;
    };
};
export type _TextDecoder = Wrapped<TextDecoder>;
export declare const _TextEncoder: Omit<{
    new (): TextEncoder;
    prototype: TextEncoder;
}, "prototype"> & {
    new (): TextEncoder & {
        readonly [WrappedBrand]: TextEncoder;
    };
    prototype: TextEncoder & {
        readonly [WrappedBrand]: TextEncoder;
    };
    readonly [WrappedBrand]: {
        new (): TextEncoder;
        prototype: TextEncoder;
    };
};
export type _TextEncoder = Wrapped<TextEncoder>;
export declare function makeWrap<T extends object>(source: T): Wrapped<T>;
export {};
