/**
 * metadata.spec.ts — Metadata system invariants
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata  ← THIS FILE
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type, Static } from '@sinclair/typebox';
import { defineLinks, linkTo } from '../../src';
import { navigate, navigateAll } from '../../src/navigate';
import { petshopApi, PetshopSchema, CatalogSchema } from '../../examples/petshop-api';
import { mockResponse, mockResponses } from '../mock-responses';
import {
    mockPetshop, mockCatalog, IntersectionLinkSchema, UnionLinkSchema,
} from '../test-schemas';

describe('navigate — metadata', () => {

    describe('source of truth', () => {
        it('resolves from stored metadata even after the runtime href is tampered with', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            // Corrupt the runtime property — navigate uses metadata, not the runtime value
            (shop.actions.listPets as any).href = 12345;

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.listPets);
            expect(catalog.pets).toHaveLength(2);
        });

        it('preserves server-sent link metadata fields verbatim', async () => {
            const ResourceSchema = Type.Object({
                id: Type.String(),
                link: Type.Object({
                    href: Type.String(),
                    title: Type.Optional(Type.String()),
                    templated: Type.Optional(Type.Boolean()),
                    method: Type.Optional(Type.String()),
                }),
            });
            const DataSchema = Type.Object({ value: Type.String() });

            const api = defineLinks(['resource', 'data'], {
                resource: {
                    schema: ResourceSchema,
                    links: { 'link.href': { to: 'data' } },
                },
                data: { schema: DataSchema, links: {} },
            });

            mockResponse(ResourceSchema, {
                id: '123',
                link: {
                    href: '/target',
                    title: 'Go to target',
                    templated: false,
                    method: 'POST',
                    // @ts-expect-error additional HAL property not declared in the schema
                    customProp: 'custom value',
                },
            });
            const resource = await navigate(linkTo({
                api,
                resource: 'resource',
                url: 'http://api.com/resource',
            }));

            // Standard HAL properties preserved (declared in the schema)
            expect(resource.link.href).toBe('/target');
            expect(resource.link.title).toBe('Go to target');
            expect(resource.link.templated).toBe(false);
            expect(resource.link.method).toBe('POST');
            // Custom HAL+JSON properties preserved (not stripped by metadata system).
            // This guards against accidental whitelisting — the library must not
            // strip undeclared fields when hydrating link metadata.
            expect((resource.link as any).customProp).toBe('custom value');
        });
    });

    describe('serialization', () => {
        it('round-trips cleanly through JSON.stringify/parse', async () => {
            const ResourceSchema = Type.Object({
                id: Type.String(),
                name: Type.String(),
                link: Type.Object({
                    href: Type.String(),
                    title: Type.Optional(Type.String()),
                }),
            });
            const DataSchema = Type.Object({ value: Type.String() });

            const api = defineLinks(['resource', 'data'], {
                resource: {
                    schema: ResourceSchema,
                    links: { 'link.href': { to: 'data' } },
                },
                data: { schema: DataSchema, links: {} },
            });

            mockResponse(ResourceSchema, {
                id: '123',
                name: 'Test Resource',
                link: { href: '/target', title: 'Go to target' },
            });
            const resource = await navigate(linkTo({
                api,
                resource: 'resource',
                url: 'http://api.com/resource',
            }));

            // JSON.stringify works and produces no internal metadata keys
            const serialized = JSON.stringify(resource);
            expect(serialized).not.toContain('__linkDef__');

            // Round-trip equals the original structure
            const parsed = JSON.parse(serialized);
            expect(parsed).toEqual({
                id: '123',
                name: 'Test Resource',
                link: { href: '/target', title: 'Go to target' },
            });

            // Original object still navigable (metadata lives in the per-client WeakMap)
            mockResponse(DataSchema, { value: 'test' });
            const target = await navigate(resource.link);
            expect(target.value).toBe('test');

            // A parsed-from-JSON copy has no metadata and cannot be navigated
            await expect(navigate(parsed.link as any)).rejects.toThrow(/metadata not found/i);
        });

        it('does not leak the phantom metadata symbol into JSON', async () => {
            const SourceSchema = Type.Object({
                id: Type.String(),
                link: Type.Object({ href: Type.String() }),
            });
            const TargetSchema = Type.Object({
                id: Type.String(),
                value: Type.String(),
            });

            const api = defineLinks(['source', 'target'], {
                source: {
                    schema: SourceSchema,
                    links: { 'link.href': { to: 'target' } },
                },
                target: { schema: TargetSchema, links: {} },
            });

            const mockedObject: Static<typeof SourceSchema> = {
                id: '1',
                link: { href: '/target/1' },
            };
            mockResponse(SourceSchema, mockedObject);

            const resource = await navigate(linkTo({
                api,
                resource: 'source',
                url: 'http://api.com/source/1',
            }));

            // No phantom symbol leaked into JSON.stringify output
            expect(JSON.stringify(resource)).toEqual(JSON.stringify(mockedObject));
        });

        it('retains metadata on nested links across shallow spread copies (the React/Redux consumer pattern)', async () => {
            const SourceSchema = Type.Object({
                id: Type.String(),
                link: Type.Object({ href: Type.String() }),
            });
            const TargetSchema = Type.Object({
                id: Type.String(),
                value: Type.String(),
            });

            const api = defineLinks(['source', 'target'], {
                source: {
                    schema: SourceSchema,
                    links: { 'link.href': { to: 'target' } },
                },
                target: { schema: TargetSchema, links: {} },
            });

            mockResponse(SourceSchema, {
                id: '1',
                link: { href: '/target/1' },
            });
            const source = await navigate(linkTo({
                api,
                resource: 'source',
                url: 'http://api.com/source/1',
            }));

            // Baseline: navigate the original's nested link
            mockResponse(TargetSchema, { id: 't1', value: 'from client' });
            const normalTarget = await navigate(source.link);
            expect(normalTarget.value).toBe('from client');

            // Shallow spread preserves the nested link reference (same object in WeakMap)
            const spreadSource = { ...source };
            mockResponse(TargetSchema, { id: 't2', value: 'from spread object' });
            const spreadTarget = await navigate(spreadSource.link);
            expect(spreadTarget.value).toBe('from spread object');
        });
    });

    describe('composed schemas', () => {
        const RootSchema = Type.Object({
            intersectionLink: IntersectionLinkSchema,
            unionLink: UnionLinkSchema,
            intersectionLinks: Type.Array(IntersectionLinkSchema),
        });

        const TargetSchema = Type.Object({
            id: Type.String(),
            name: Type.String(),
        });

        const TestApi = defineLinks(['root', 'target'], {
            root: {
                schema: RootSchema,
                links: {
                    'intersectionLink.href': { to: 'target' },
                    'unionLink.href': { to: 'target' },
                    'intersectionLinks[].href': { to: 'target' },
                },
            },
            target: {
                schema: TargetSchema,
                links: {},
            },
        });

        it('hydrates and follows intersection-schema link objects', async () => {
            mockResponse(RootSchema, {
                intersectionLink: {
                    href: 'http://api.test/target/1',
                    propA: 'valueA',
                    title: 'Intersection Link',
                },
                unionLink: { href: '/union' },
                intersectionLinks: [],
            });

            const root = await navigate(linkTo({
                api: TestApi,
                resource: 'root',
                url: 'http://api.test/root',
            }));

            expect(root.intersectionLink.href).toBe('http://api.test/target/1');
            expect(root.intersectionLink.propA).toBe('valueA');
            expect(root.intersectionLink.title).toBe('Intersection Link');

            mockResponse(TargetSchema, { id: '1', name: 'Target Resource' });
            const target = await navigate(root.intersectionLink);

            expect(target.id).toBe('1');
            expect(target.name).toBe('Target Resource');
        });

        it('hydrates and follows union-schema link objects', async () => {
            mockResponse(RootSchema, {
                intersectionLink: { href: '/intersection', propA: 'value' },
                unionLink: {
                    href: 'http://api.test/target/2',
                    title: 'Union Link',
                },
                intersectionLinks: [],
            });

            const root = await navigate(linkTo({
                api: TestApi,
                resource: 'root',
                url: 'http://api.test/root',
            }));

            expect((root.unionLink as any).href).toBe('http://api.test/target/2');

            mockResponse(TargetSchema, { id: '2', name: 'Union Target' });
            const target = await navigate(root.unionLink as any);

            expect(target.id).toBe('2');
            expect(target.name).toBe('Union Target');
        });

        it('hydrates arrays of composed-schema link objects', async () => {
            mockResponse(RootSchema, {
                intersectionLink: { href: '/intersection', propA: 'value' },
                unionLink: { href: '/union' },
                intersectionLinks: [
                    { href: 'http://api.test/target/1', propA: 'value1', title: 'Link 1' },
                    { href: 'http://api.test/target/2', propA: 'value2', title: 'Link 2' },
                ],
            });

            const root = await navigate(linkTo({
                api: TestApi,
                resource: 'root',
                url: 'http://api.test/root',
            }));

            expect(root.intersectionLinks).toHaveLength(2);
            expect(root.intersectionLinks[0].propA).toBe('value1');
            expect(root.intersectionLinks[1].propA).toBe('value2');

            mockResponses(
                TargetSchema,
                { id: '1', name: 'Target 1' },
                { id: '2', name: 'Target 2' },
            );

            const targets = await navigateAll(root.intersectionLinks);

            expect(targets).toHaveLength(2);
            expect(targets[0].name).toBe('Target 1');
            expect(targets[1].name).toBe('Target 2');
        });
    });

});
