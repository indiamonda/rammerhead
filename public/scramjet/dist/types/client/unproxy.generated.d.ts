/**
 * Single character proxy "kind" tag:
 *   "w" -> Window/WindowProxy   "d" -> Document
 *   "*" -> overload disagrees, probe the value at runtime
 */
export type ProxyKind = "w" | "d" | "*";
/**
 * Selector for a Window/Document value reachable from an operation argument.
 *   [argIdx, kind]                 -- the entire argument
 *   [argIdx, kind, ...path]        -- a property path inside a dict arg
 *                                     (e.g. options.root)
 */
export type ArgSelector = readonly [
    argIdx: number,
    kind: "w" | "d",
    ...path: string[]
];
/**
 * Operation/constructor table entry:
 *   [owner, member, isStatic, isCtor, argSelectors, returnKind]
 *
 * - owner is the interface/namespace name (e.g. "Document", "Window")
 * - member is the method name; "" for constructors
 * - isStatic=true patches `Owner.member`, false patches `Owner.prototype.member`
 * - isCtor=true patches the interface constructor itself
 * - returnKind=""  means no return wrapping needed
 */
export type OpEntry = readonly [
    owner: string,
    member: string,
    isStatic: boolean,
    isCtor: boolean,
    argSelectors: readonly ArgSelector[],
    returnKind: ProxyKind | ""
];
/**
 * Attribute table entry:
 *   [owner, member, isStatic, kind, readonly]
 *
 * isStatic=true patches `Owner.member`, false patches `Owner.prototype.member`.
 */
export type AttrEntry = readonly [
    owner: string,
    member: string,
    isStatic: boolean,
    kind: ProxyKind,
    readonly: boolean
];
export declare const OPERATIONS: readonly OpEntry[];
export declare const ATTRIBUTES: readonly AttrEntry[];
