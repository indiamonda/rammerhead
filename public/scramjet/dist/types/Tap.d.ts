type Description = {
    context?: object;
    props?: object;
};
type Callback<T extends Description> = (context: T["context"], props: T["props"]) => void | Promise<void>;
type Sorter = (other: Plugin) => number;
type CallbackInfo<T extends Description> = {
    callback: Callback<T>;
    plugin: Plugin;
    sorter: Sorter;
};
type InternalHookDescription = {
    tap: TapInternal;
    key: string;
};
type TapInternal = {
    callbacks: Record<string, CallbackInfo<Description>[]>;
};
export type TapInstance<T extends Record<string, Description>> = {
    [K in keyof T]: T[K] & InternalHookDescription;
};
export declare class Plugin {
    name: string;
    constructor(name: string);
    tap<T extends Description>(hook: T, callback: Callback<T>, sorter?: Sorter): void;
}
export declare class Tap {
    static dispatch<T extends Description>(hook: T, context: T["context"], props: T["props"]): Promise<void[]>;
    static tap<T extends Description>(hook: T, callback: Callback<T>, plugin: Plugin, sorter: Sorter): void;
    static create<T extends Record<string, Description>>(): TapInstance<T>;
}
export {};
