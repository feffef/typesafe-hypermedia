/**
 * runtime-guards.spec.ts — Programmer-error handling
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input (null, undefined, primitive, plain object,
 *     unknown resource, unknown link) asserting an error → runtime-guards  ← THIS FILE
 *  2. Bad link path that defineLinks accepts but the runtime later rejects
 *     (deferred user-input validation, e.g. terminal '[]') → runtime-guards  ← THIS FILE
 *  3. Custom fetchFactory or typed navigable union check → fetch-customization
 *  4. errorVerbosity: 'safe' → error-verbosity
 *  5. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  6. navigateAll, or array fan-out edge cases → navigate-all
 *  7. params:/URI template/baseURL/final URL assertion → url-resolution
 *  8. Return shape/contents of an error → error-handling
 *  9. Which navigate() overload fires → navigate-overloads
 * 10. "A navigable can live here too" → link-locations
 * 11. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo, NavigationError } from '../../src';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopSchema, PetSchema } from '../../examples/petshop-api';
import { mockResponse } from '../mock-responses';
import {
    DashboardSchema, SimpleCatalogSchema, SimpleProductSchema, mockPetshop,
} from '../test-schemas';

describe('navigate — runtime guards', () => {

    describe('terminal resources', () => {
        it('tolerate a resource definition whose links field is undefined (distinct from {})', async () => {
            const TerminalSchema = Type.Object({
                id: Type.String(),
                data: Type.String(),
            });
            const RootSchema = Type.Object({
                terminalLink: Type.Object({ href: Type.String() }),
            });

            // Manually construct the API to bypass defineLinks validation and
            // hit the defensive `if (!resourceDef.links) return` early return
            // in ApiClient.rememberLinks when `links` is undefined (rather than `{}`).
            const api: any = {
                root: {
                    schema: RootSchema,
                    links: { 'terminalLink.href': { to: 'terminal' } },
                },
                terminal: {
                    schema: TerminalSchema,
                    links: undefined,
                },
            };

            mockResponse(RootSchema, { terminalLink: { href: 'http://api.test/terminal' } });
            const root = await navigate(linkTo({
                api,
                resource: 'root',
                url: 'http://api.test/root',
            }));

            mockResponse(TerminalSchema, { id: '123', data: 'terminal data' });
            const terminal = await navigate(root.terminalLink);

            expect(terminal.id).toBe('123');
            expect(terminal.data).toBe('terminal data');
        });

        it('reject an attempt to navigate from a resource with no outgoing links', async () => {
            const TerminalSchema = Type.Object({ id: Type.String() });
            const RootSchema = Type.Object({ terminalLink: Type.Object({ href: Type.String() }) });
            const terminalApi = defineLinks(['root', 'terminal'], {
                root: { schema: RootSchema, links: { 'terminalLink.href': { to: 'terminal' } } },
                terminal: { schema: TerminalSchema, links: {} },
            });

            mockResponse(RootSchema, { terminalLink: { href: 'http://api.test/terminal' } });
            const root = await navigate(linkTo({ api: terminalApi, resource: 'root', url: 'http://api.test' }));

            mockResponse(TerminalSchema, { id: '42' });
            const terminal = await navigate(root.terminalLink);

            // Terminal resources with no outgoing links are not registered in navigableOwner,
            // so calling navigate() on the terminal resource itself throws the metadata-not-found error.
            await expect(navigate(terminal as any))
                .rejects.toThrow('Link metadata not found. Object was not created by typesafe-hypermedia.');
        });
    });

    describe('unknown link names', () => {
        const namedLinkApi = defineLinks(['dashboard', 'catalog', 'product'], {
            dashboard: {
                schema: DashboardSchema,
                links: {
                    catalogUrl: { to: 'catalog' },
                    productUrl: { to: 'product', params: { id: Type.String() } },
                },
            },
            catalog: { schema: SimpleCatalogSchema, links: {} },
            product: { schema: SimpleProductSchema, links: {} },
        });

        const dashboardBody = {
            welcomeMessage: 'Hello',
            catalogUrl: '/catalog',
            productUrl: '/products/{id}',
        };

        // Every test in this block exercises a runtime guard that TypeScript
        // already rejects at compile time. Each `await expect(navigate(...))`
        // is preceded by `// @ts-expect-error` so the test fails *both* if
        // the type-level rejection regresses (the directive becomes an
        // unused error) *and* if the runtime fallback regresses (the
        // .rejects.toThrow assertion fires). This dual-axis check is the
        // canonical home for the message contract — the unit-level
        // defensive-guards block in test/unit/runtime-metadata.test.ts
        // intentionally avoids duplicating these branches.

        it('list the available link names when the caller asks for a name that does not exist', async () => {
            mockResponse(DashboardSchema, dashboardBody);
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            // @ts-expect-error — 'nonExistent' is not a key of dashboard's link record
            await expect(navigate(dashboard, { link: 'nonExistent' })).rejects.toThrow(
                /Link "nonExistent" is not available on this resource.*available: catalogUrl, productUrl/
            );
        });

        it('include the available link names even when errorVerbosity: safe is configured', async () => {
            mockResponse(DashboardSchema, dashboardBody);
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
                errorVerbosity: 'safe',
            }));

            // Navigate uses link names (compile-time constants), so errors are
            // always verbose even under errorVerbosity: 'safe'. This test
            // guards against ApiClient accidentally routing internal-bug
            // errors through verbosity sanitization.
            // @ts-expect-error — 'nonExistingLink' is not a key of dashboard's link record
            await expect(navigate(dashboard, { link: 'nonExistingLink' }))
                .rejects.toThrow(/Link "nonExistingLink" is not available on this resource.*available:/);
        });

        it('reject an empty string as a link name instead of falling through', async () => {
            mockResponse(DashboardSchema, dashboardBody);
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            // Empty string '' is falsy — without the explicit `name !== undefined`
            // check in recallLink it would silently fall through to the
            // multiple-links error path. With the fix it hits the named-link
            // not-found path.
            // @ts-expect-error — '' is not a key of dashboard's link record
            await expect(navigate(dashboard, { link: '' }))
                .rejects.toThrow(/Link "" is not available on this resource/);
        });
    });

    describe('missing optional link properties', () => {
        // With link objects, navigating a missing optional is caught early:
        // the navigable IS the link object, so resource.downloadLink is
        // undefined → getOwningClient(undefined) → "Link metadata not found".
        //
        // With plain string link properties the navigable is the parent
        // resource (which IS registered); only the individual link entry is
        // absent. This describe block pins the error for that gap.

        it('throw a descriptive error when navigating an optional string-property link the server omitted', async () => {
            const ResourceSchema = Type.Object({
                id: Type.String(),
                downloadUrl: Type.Optional(Type.String()),
                previewUrl: Type.Optional(Type.String()),
            });
            const TargetSchema = Type.Object({ data: Type.String() });

            const api = defineLinks(['resource', 'target'], {
                resource: {
                    schema: ResourceSchema,
                    links: {
                        downloadUrl: { to: 'target' },
                        previewUrl: { to: 'target' },
                    },
                },
                target: { schema: TargetSchema, links: {} },
            });

            // Server returns only previewUrl — downloadUrl is absent.
            mockResponse(ResourceSchema, {
                id: '1',
                previewUrl: '/preview/1',
            });
            const resource = await navigate(linkTo({
                api,
                resource: 'resource',
                url: 'http://api.test',
            }));

            expect(resource.downloadUrl).toBeUndefined();
            expect(resource.previewUrl).toBe('/preview/1');

            // Navigating the missing optional link should produce a clear,
            // actionable error — not an "Internal library bug" message.
            await expect(navigate(resource, { link: 'downloadUrl' }))
                .rejects.toThrow(
                    /Link "downloadUrl" is not available.*available: previewUrl.*optional/
                );

            // The present optional link still works.
            mockResponse(TargetSchema, { data: 'preview-data' });
            const preview = await navigate(resource, { link: 'previewUrl' });
            expect(preview.data).toBe('preview-data');
        });

        it('throw a descriptive error when auto-resolving a single optional link the server omitted', async () => {
            const ResourceSchema = Type.Object({
                id: Type.String(),
                downloadUrl: Type.Optional(Type.String()),
            });
            const TargetSchema = Type.Object({ data: Type.String() });

            const api = defineLinks(['resource', 'target'], {
                resource: {
                    schema: ResourceSchema,
                    links: {
                        downloadUrl: { to: 'target' },
                    },
                },
                target: { schema: TargetSchema, links: {} },
            });

            // Server returns without the only defined link.
            mockResponse(ResourceSchema, { id: '1' });
            const resource = await navigate(linkTo({
                api,
                resource: 'resource',
                url: 'http://api.test',
            }));

            expect(resource.downloadUrl).toBeUndefined();

            // Single-link auto-resolve: navigate(resource) with no link name.
            // The resource IS registered (it defines links), but the link map
            // is empty because the server omitted the optional property.
            await expect(navigate(resource as any))
                .rejects.toThrow(
                    /No links are available on this resource.*optional/
                );
        });
    });

    describe('invalid resource names', () => {
        it('reject an unknown root resource name with a descriptive error', async () => {
            // linkTo is typed to reject unknown resource names, but at runtime a
            // caller can force an invalid key (e.g. via `as any`). The client
            // must surface a descriptive error, not a cryptic crash.
            const api = defineLinks(['petshop', 'pet'], {
                petshop: {
                    schema: PetshopSchema,
                    links: { 'actions.listPets.href': { to: 'pet' } },
                },
                pet: { schema: PetSchema, links: {} },
            });

            mockResponse(PetshopSchema, mockPetshop);
            const entry = linkTo({
                api,
                resource: 'nonexistent' as any,
                url: 'http://localhost:3000',
            });

            await expect(navigate(entry))
                .rejects.toThrow(/Resource definition not found for: nonexistent/);
        });
    });

    describe('terminal-array link paths (defense-in-depth runtime guard)', () => {
        // defineLinks now rejects link paths whose terminal segment is a bare
        // array marker (e.g. 'tags[]') up front (see the matching unit test in
        // test/unit/link-definition.test.ts). The runtime guard inside
        // `traverse` (src/runtime-metadata.ts) remains as defense-in-depth for
        // direct callers that bypass defineLinks; this integration-level test
        // pins the up-front rejection through the public API.
        it('rejects a terminal array segment in a link path at definition time', () => {
            const TagsSchema = Type.Object({
                tags: Type.Optional(Type.Array(Type.String()))
            });

            expect(() => defineLinks(['tagged'], {
                tagged: {
                    schema: TagsSchema,
                    links: {
                        // Bad path: terminal '[]' has no property name to extract.
                        'tags[]': { to: 'tagged' }
                    }
                }
            })).toThrow(
                /Array segment 'tags\[\]' cannot be terminal\. Specify the property name to extract \(e\.g\., 'tags\[\]\.href'\)/
            );
        });
    });

    describe('non-navigable inputs', () => {
        // Plain-object rejection family (consolidated from 4 individual tests).
        // All four exercise the same branch — the metadata-lookup miss for any
        // object that was not created by the library — with different shapes
        // to document that the guard is not pattern-matching specific keys.
        it.each([
            ['plain object without metadata',                { notALink: true }],
            ['manually constructed {href} object',           { href: '/api/users' }],
            // The original tests included a @ts-expect-error here. The .each
            // shape proves the runtime guard fires irrespective of whether the
            // type system was bypassed; the compile-time guard is exercised
            // separately by passing values that violate `Navigable<...>`.
            ['plain object even when the type system was bypassed', { simpleUrl: '/target' }],
            ['object whose shape does not resemble a link at all', { notHref: 'value' }],
        ])('reject a %s', async (_label, input) => {
            // @ts-expect-error — Intentionally bypassing type system to exercise the runtime guard
            await expect(navigate(input))
                .rejects.toThrow(/Link metadata not found/);
        });

        // Primitive/nullish rejection family (consolidated from 3 individual tests).
        // getOwningClient guards against non-object inputs, returning undefined
        // for null, undefined, and primitives so the existing `!client` check
        // in navigate() produces the library's own descriptive error.
        it.each([
            ['null',         null],
            ['undefined',    undefined],
            ['plain string', 'http://example.com'],
            ['number (0)',   0],
            ['NaN',          NaN],
            ['empty string', ''],
            ['Symbol',       Symbol()],
            // Arrays are objects; fall through to WeakMap miss → throws
            ['empty array',  []],
            // Functions are not typeof 'object'; caught by the guard early.
            // The result is the same as a WeakMap miss since functions are
            // never registered as navigables.
            ['function',     function() {}],
            ['bigint',       BigInt(0)],
        ])('reject %s', async (_label, input) => {
            // The @ts-expect-error below is correct for a parameterized test:
            // TypeScript infers `input` as the union of ALL table values
            // (null | undefined | string | number | ...), which is not
            // assignable to `Navigable<any>`, so a single directive covers
            // every parameterized invocation.
            // @ts-expect-error — Intentionally bypassing type system
            await expect(navigate(input))
                .rejects.toThrow(/Link metadata not found/);
        });
    });

    describe('NavigationError class contract', () => {
        // These tests pin the subclass contract: `NavigationError extends
        // Error`, so broad-catch code relying on `instanceof Error` still
        // works, while specific catch code can use `instanceof
        // NavigationError` for a precise catch path.

        const namedLinkApi = defineLinks(['dashboard', 'catalog', 'product'], {
            dashboard: {
                schema: DashboardSchema,
                links: {
                    catalogUrl: { to: 'catalog' },
                    productUrl: { to: 'product', params: { id: Type.String() } },
                },
            },
            catalog: { schema: SimpleCatalogSchema, links: {} },
            product: { schema: SimpleProductSchema, links: {} },
        });

        const dashboardBody = {
            welcomeMessage: 'Hello',
            catalogUrl: '/catalog',
            productUrl: '/products/{id}',
        };

        it('throws NavigationError (and instanceof Error) when navigating with an unknown link name', async () => {
            mockResponse(DashboardSchema, dashboardBody);
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            // @ts-expect-error — 'bogus' is not a key of dashboard's link record
            const thrown = await navigate(dashboard, { link: 'bogus' }).catch(e => e);

            expect(thrown).toBeInstanceOf(NavigationError);
            expect(thrown).toBeInstanceOf(Error); // broad-catch compat
            expect(thrown.name).toBe('NavigationError');
            expect((thrown as Error).message).toMatch(/Link "bogus" is not available on this resource/);
        });

        it('throws NavigationError (and instanceof Error) when passed a non-navigable object', async () => {
            // @ts-expect-error — plain object bypasses the type system
            const thrown = await navigate({ href: '/nope' }).catch(e => e);

            expect(thrown).toBeInstanceOf(NavigationError);
            expect(thrown).toBeInstanceOf(Error);
            expect(thrown.name).toBe('NavigationError');
            expect((thrown as Error).message).toMatch(/Link metadata not found/);
        });
    });

});
