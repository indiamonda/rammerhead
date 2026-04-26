/**
 * Patch esotope-hammerhead's `generate(ast, opts)` so it can serialize the
 * modern class syntax that ships in current JS bundles. Three pre-existing
 * bugs are fixed here, all triggered by Discord's `web.*.js` chunks:
 *
 *  1. `PropertyDefinition` with `value: null` (`class Foo { x; }`) crashes
 *     the generator because it dereferences `value.type` unconditionally.
 *     We replace `null` with an `undefined` Identifier; per the TC39
 *     class-fields proposal `class Foo { x; }` is semantically identical
 *     to `class Foo { x = undefined; }` so runtime behaviour is preserved.
 *
 *  2. `static <name> = …` is emitted as `static<name>=…` in compact mode
 *     because the generator concatenates `'static' + _.optSpace` and
 *     `_.optSpace` is the empty string. We swap the identifier key for a
 *     computed string literal so the output becomes `static["<name>"]=…`,
 *     which is valid syntax and has identical semantics (defines own
 *     property `"<name>"` on the class object). Private identifiers keep
 *     their original form because `static#x=…` is itself a valid parse.
 *
 *  3. `obj.#priv` (non-computed `MemberExpression` whose property is a
 *     `PrivateIdentifier`) loses the `#` because the generator uses
 *     `'.' + property.name`. We inline the `#` into the name and re-tag
 *     the property as `Identifier` so emission yields `obj.#priv`.
 *
 * If any other unknown ESTree node type slips through and crashes the
 * generator, the wrapper around `scriptProcessor.processResource` in
 * `patchScriptProcessing.js` catches the throw and falls back to a
 * string-only `_liteRewriteJs` so the asset still serves rather than 500.
 */

const esotope = require('esotope-hammerhead');

if (!esotope.__rhCodegenPatched) {
    Object.defineProperty(esotope, '__rhCodegenPatched', { value: true });

    const SKIP_KEYS = new Set(['loc', 'range', 'parent', 'leadingComments', 'trailingComments']);

    function normalize(node) {
        if (!node || typeof node !== 'object') return;

        // Class field with no initializer: `x;` or `#x;` in a class body.
        // ESTree leaves `value: null`; esotope crashes on null.type. Replace
        // with a literal `undefined` reference so the generator emits a
        // semantically-equivalent `x=undefined;`.
        // Per the TC39 class-fields proposal, `class Foo { x; }` is exactly
        // equivalent to `class Foo { x = undefined; }`.
        if (node.type === 'PropertyDefinition' && node.value === null) {
            node.value = { type: 'Identifier', name: 'undefined' };
        }
        // Pre-existing esotope bug exposed once we let `static` fields reach
        // the generator: in compact mode, `'static' + _.optSpace` (where
        // optSpace is '') produces `staticfoo=1;` for `static foo = 1`. The
        // missing space yields invalid syntax. Convert non-private,
        // non-computed static fields to a computed-string form so the
        // generator emits `static["foo"]=...;` which IS valid and has
        // identical runtime semantics (defines own property "foo" on the
        // class object). Private identifiers (`static #x`) keep the
        // identifier form because `#x` cannot be computed and the
        // `static#x` token sequence is itself a valid parse.
        if (
            node.type === 'PropertyDefinition' &&
            node.static === true &&
            node.computed !== true &&
            node.key && node.key.type === 'Identifier'
        ) {
            node.computed = true;
            const name = node.key.name;
            node.key = {
                type: 'Literal',
                value: name,
                raw: JSON.stringify(name),
            };
        }
        // Pre-existing esotope bug: non-computed `MemberExpression` with a
        // PrivateIdentifier property emits `obj.foo` instead of `obj.#foo`,
        // because the generator does `'.' + property.name` without consulting
        // the property type. Inline the `#` into the name and re-tag as
        // Identifier so the generator emits the correct form.
        if (
            node.type === 'MemberExpression' &&
            node.computed !== true &&
            node.property &&
            node.property.type === 'PrivateIdentifier'
        ) {
            node.property = { type: 'Identifier', name: '#' + node.property.name };
        }

        for (const key in node) {
            if (SKIP_KEYS.has(key)) continue;
            const val = node[key];
            if (val && typeof val === 'object') {
                if (Array.isArray(val)) {
                    for (let i = 0; i < val.length; i++) {
                        const child = val[i];
                        if (child && typeof child === 'object') normalize(child);
                    }
                } else if (typeof val.type === 'string') {
                    normalize(val);
                }
            }
        }
    }

    const origGenerate = esotope.generate;
    esotope.generate = function rhPatchedGenerate(node, options) {
        try { normalize(node); } catch (_) { /* best effort */ }
        return origGenerate.call(this, node, options);
    };
}

module.exports = esotope;
