import { defineLinks, Resource, ApiDefinition } from '../../src';
import { rememberLinks, recallLink, compilePath, traverse } from '../../src/runtime-metadata';
import type { ApiClient } from '../../src/api-client';
import { Type } from '@sinclair/typebox';

// runtime-metadata holds module-level WeakMaps. The fake client only needs
// to be a stable object reference for ownership tracking — its methods are
// never called by rememberLinks/recallLink.
const fakeClient = {} as ApiClient<any>;

// Generic helper to create mock Resource instances for any API in tests.
function mockResource<N extends string, A extends ApiDefinition>(
    data: Record<string, any>
): Resource<N, A> {
    return data as Resource<N, A>;
}

// ============================================================================
// Why this file is small
//
// Most of runtime-metadata's behaviour — link extraction across nested objects,
// arrays, optional siblings, mixed nesting, single-link auto-resolve, named-link
// resolution, ownership tracking — is exercised at integration level via real
// `linkTo` + `navigate` flows in:
//
//   - test/integration/link-locations.spec.ts  (extraction edge cases)
//   - test/integration/navigate-overloads.spec.ts (resolve modes + dispatch)
//   - test/integration/metadata.spec.ts (metadata invariants, baseURL, isolation)
//   - test/integration/runtime-guards.spec.ts (TypeScript-prevented runtime guards
//     using @ts-expect-error to dual-test the compile-time and runtime contracts)
//
// This file therefore contains *only* tests for branches that cannot be reached
// from the public `navigate()` / `linkTo()` API even with `@ts-expect-error`:
//
//   1. Defensive invariant guards: branches reachable solely via direct,
//      module-internal calls to compilePath / traverse / recallLink.
//   2. Validation-bypass branches: branches that fire only when
//      `validateResource` (which always runs before rememberLinks in the
//      ApiClient pipeline) is bypassed by calling rememberLinks directly with
//      schema-violating data.
//
// Anything that *can* be tested via integration belongs there.
// ============================================================================

// ============================================================================
// 1. Defensive invariant guards
//
// Every test in this block exercises a throw branch that is unreachable
// through the public API:
//
// - `compilePath` and `traverse` guards fire only if some upstream caller
//   bypasses path compilation. Reaching them means a library bug.
// - `recallLink`'s `!links` branch fires only if `apiClientByNavigable` and
//   `linksByNavigable` are out of sync — `navigate()` catches unknown objects
//   via `getOwningClient` upstream, so this branch only fires on a true
//   library invariant violation. The named-link-miss branch is legitimately
//   reachable when an optional string-property link is absent from the
//   server response — tested at integration level in runtime-guards.spec.ts.
//   The multi-link no-name branch is TypeScript-prevented and tested in
//   navigate-overloads.spec.ts.
//
// The "no link map" and "multi-link auto-resolve" messages are tagged
// "Internal library bug" so a developer who hits one knows immediately
// it is a framework-level problem. The named-link-miss message is
// user-facing (actionable guidance about optional links). The tests
// reach into `@internal` exports on purpose — silently no-oping on a broken
// invariant is strictly worse than failing fast.
// ============================================================================

describe("runtime-metadata defensive invariant guards", () => {

    describe("compilePath", () => {

        it('throws when given an empty segments array (invariant: callers always split a non-empty path)', () => {
            expect(() => compilePath([])).toThrow(/empty segments array/);
            expect(() => compilePath([])).toThrow(/internal invariant violation/);
        });

        it('accepts a single empty-string segment (the natural result of "".split("."))', () => {
            // Sanity check: '' .split('.') === [''], which has length 1, so the
            // empty-segments guard must NOT fire on it. This locks in why the
            // guard is unreachable through public callers.
            expect(() => compilePath([''])).not.toThrow();
        });
    });

    describe("traverse", () => {

        it('throws when index >= segments.length (invariant: only entered with index < length)', () => {
            // Direct invocation that bypasses compilePath. This is the only way
            // to trip the guard — it would never fire from rememberLinks because
            // (a) compilePath rejects empty segments and (b) recursion only
            // advances when !isTerminal, so the next index never overshoots.
            const results: Array<{ navigable: object; key: string; href: string }> = [];
            expect(() => traverse([{}], ['a', 'b'], 2, results)).toThrow(
                /traverse invariant violation: index 2 >= segments.length 2/
            );
            expect(() => traverse([{}], ['a', 'b'], 5, results)).toThrow(
                /Caller bypassed compilePath validation/
            );
        });

        it('throws when a terminal segment is an array marker (e.g. items[])', () => {
            // defineLinks validates this at definition time (link-definition.ts),
            // so this traverse guard is defense-in-depth. Reachable only via
            // direct invocation — compilePath itself does not filter segments.
            const results: Array<{ navigable: object; key: string; href: string }> = [];
            expect(() => traverse([{ items: [{ href: '/x' }] }], ['items[]'], 0, results)).toThrow(
                /Array segment 'items\[\]' cannot be terminal/
            );
            expect(() => traverse([{ items: [{ href: '/x' }] }], ['items[]'], 0, results)).toThrow(
                /Specify the property name to extract \(e\.g\., 'items\[\]\.href'\)/
            );
        });
    });

    describe("recallLink", () => {

        it('throws "Internal library bug" when navigable has no link map (apiClientByNavigable / linksByNavigable out of sync)', () => {
            // Through navigate() this branch is unreachable: getOwningClient
            // catches unknown objects upstream and throws a user-facing error.
            // The branch fires only on a true library invariant violation,
            // which has no public-API path and so cannot be expressed via
            // `@ts-expect-error` at integration level.
            expect(() => recallLink({})).toThrow(/Internal library bug in recallLink/);
            expect(() => recallLink({})).toThrow(/has no link map/);
            expect(() => recallLink({})).toThrow(/apiClientByNavigable and linksByNavigable are out of sync/);
        });
    });
});

// ============================================================================
// 2. Validation-bypass branches
//
// Every test in this block calls `rememberLinks` directly with data that
// would never reach the function in the real ApiClient pipeline, because
// `validateResource` runs before `rememberLinks` and would reject the data
// against its TypeBox schema. Through the public `linkTo` + `navigate` API
// these branches are therefore unreachable — a server returning the same
// shapes would be rejected at the validation step. The tests live here to
// pin the runtime-metadata layer's own contract: even if validation is
// somehow bypassed, extraction degrades gracefully.
// ============================================================================

describe("runtime-metadata validation-bypass branches", () => {

    describe("null array entry mid-traversal", () => {

        it('skips a null entry inside an array (validateResource would have rejected an Array(Object) schema with a null element)', () => {
            const Schema = Type.Object({
                items: Type.Optional(Type.Array(Type.Object({
                    href: Type.String()
                })))
            });
            const api = defineLinks(['r'], {
                r: {
                    schema: Schema,
                    links: { 'items[].href': { to: 'r' } }
                }
            });
            const resource = mockResource<'r', typeof api>({
                items: [
                    null as any,                  // null entry — must be skipped silently
                    { href: '/found' }            // valid entry — must be extracted
                ]
            });

            rememberLinks(resource, api.r, 'https://example.com', fakeClient);

            // Valid entry was extracted; the null entry was silently skipped
            // (the skip is in traverse() at the `obj == null || typeof obj !== 'object'`
            // branch). validateResource would normally reject the null upstream
            // because the schema says Array(Object), but if validation is
            // somehow bypassed, extraction degrades gracefully.
            const link = recallLink(resource.items![1] as object);
            expect(link.href).toBe('/found');
        });
    });

    describe("non-string terminal value in a link path", () => {

        it('skips silently when a terminal href is a number (validateResource would have caught this upstream)', () => {
            const Schema = Type.Object({
                resource: Type.Optional(Type.Object({
                    requiredLink: Type.Object({ href: Type.String() })
                }))
            });
            const api = defineLinks(['r'], {
                r: {
                    schema: Schema,
                    links: { 'resource.requiredLink.href': { to: 'r' } }
                }
            });
            const resource = mockResource<'r', typeof api>({
                resource: {
                    requiredLink: { href: 42 as unknown as string }
                }
            });

            rememberLinks(resource, api.r, 'https://example.com', fakeClient);

            // Non-string terminal values are skipped — no navigable registered.
            expect(() => recallLink(resource.resource!.requiredLink as object)).toThrow(
                /Internal library bug in recallLink.*has no link map/
            );
        });
    });

    // FINDING-02: array-marked path segments receiving non-array values
    // Previously, traverse() wrapped the bare object in a one-element array,
    // silently producing incorrect link extraction. The fix adds an explicit
    // skip so the non-local invariant (validateResource runs before
    // rememberLinks) is made local and safe.
    describe("array-segment contract (FINDING-02)", () => {

        // Minimal schema: items[] mid-path followed by href terminal
        const ArrayMidPathSchema = Type.Object({
            items: Type.Optional(Type.Array(Type.Object({
                href: Type.String()
            })))
        });

        const arrayMidPathApi = defineLinks(['r'], {
            r: {
                schema: ArrayMidPathSchema,
                links: {
                    'items[].href': { to: 'r' }
                }
            }
        });

        // Nested schema: outer[].inner[].href — two array segments in sequence
        const NestedArraySchema = Type.Object({
            outer: Type.Optional(Type.Array(Type.Object({
                inner: Type.Optional(Type.Array(Type.Object({
                    href: Type.String()
                })))
            })))
        });

        const nestedArrayApi = defineLinks(['r'], {
            r: {
                schema: NestedArraySchema,
                links: {
                    'outer[].inner[].href': { to: 'r' }
                }
            }
        });

        it('mid-path array-marked segment receives bare object → 0 links extracted (no silent wrap)', () => {
            const resource = mockResource<'r', typeof arrayMidPathApi>({
                items: { href: '/should-not-be-extracted' } as any
            });

            rememberLinks(resource, arrayMidPathApi.r, 'https://example.com', fakeClient);
            expect(() => recallLink(resource.items as object)).toThrow(
                /Internal library bug in recallLink.*has no link map/
            );
        });

        it('mid-path array-marked segment receives a primitive string → 0 links extracted', () => {
            const resource = mockResource<'r', typeof arrayMidPathApi>({
                items: 'foo' as any
            });

            rememberLinks(resource, arrayMidPathApi.r, 'https://example.com', fakeClient);
            // Resource is registered (it defines links) but the link map is
            // empty because the array path couldn't be traversed.
            expect(() => recallLink(resource)).toThrow(
                /No links are available on this resource/
            );
        });

        it('nested array: outer[].inner[].href where one inner value is a bare object → only valid entries extracted', () => {
            const resource = mockResource<'r', typeof nestedArrayApi>({
                outer: [
                    { inner: [{ href: '/good/1' }, { href: '/good/2' }] }, // valid: 2 links
                    { inner: { href: '/bad' } as any }                      // bare object: skip
                ]
            });

            rememberLinks(resource, nestedArrayApi.r, 'https://example.com', fakeClient);

            const link1 = recallLink(resource.outer![0].inner![0] as object);
            expect(link1.href).toBe('/good/1');

            const link2 = recallLink(resource.outer![0].inner![1] as object);
            expect(link2.href).toBe('/good/2');
        });
    });
});
