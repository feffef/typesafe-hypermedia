/**
 * Hand-written ambient types for @hyperjump/uri-template v0.3.0.
 *
 * The library ships no TypeScript types. These declarations cover only the
 * two functions used by this codebase (parse, expand).
 * The library also exports `expandPartial` and `stringify` — intentionally
 * omitted because this project does not use them.
 *
 * STALENESS RISK: If the package is upgraded, verify that `parse` and
 * `expand` signatures still match. The contract test in
 * test/unit/uri-template-contract.test.ts will catch runtime drift.
 * Verified against: @hyperjump/uri-template@0.3.0
 */
declare module '@hyperjump/uri-template' {
    export interface Variable {
        name: string;
        explode: boolean;
        maxLength?: number;
    }

    export interface Segment {
        type: string; // "literal" or operator
        value?: string;
        variables?: Variable[];
    }

    export function parse(template: string): Segment[];
    export function expand(template: string | Segment[], value: Record<string, unknown>): string;
}
