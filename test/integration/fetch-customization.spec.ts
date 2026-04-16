/**
 * fetch-customization.spec.ts — FetchFactory, FetchContext, AllLinkNavigables
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization  ← THIS FILE
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type, Static } from '@sinclair/typebox';
import { defineLinks, linkTo, FetchFactory, FetchContext } from '../../src';
import { AllLinkNavigables } from '../../src/fetch-customization';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopApi, PetshopSchema } from '../../examples/petshop-api';
import { mockResponse, mockResponses } from '../mock-responses';
import {
    LinkSchema as TestLinkSchema, OnlyIdSchema, rootWithLinkApiDef, mockPetshop,
} from '../test-schemas';

describe('navigate — fetch customization', () => {

    describe('factory installation', () => {
        it('uses a default factory when none is supplied', async () => {
            mockResponse(OnlyIdSchema, { id: '123' });
            const entry = linkTo({
                api: rootWithLinkApiDef,
                resource: 'linked',
                url: '/',
            });
            const root = await navigate(entry);
            expect(root.id).toBe('123');
        });

        it('invokes a user-supplied factory for every request', async () => {
            let factoryCalled = false;
            const customFactory: FetchFactory<PetshopApi> = (_context) => {
                factoryCalled = true;
                return fetch;
            };

            mockResponse(PetshopSchema, mockPetshop);
            const root = linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
                fetchFactory: customFactory,
            });
            const shop = await navigate(root);
            expect(factoryCalled).toBe(true);
            expect(shop.actions.listPets.href).toBe('/pets');
        });
    });

    describe('context propagation', () => {
        const SourceSchema = Type.Object({
            link: TestLinkSchema,
            links: Type.Array(TestLinkSchema),
        });

        const ctxApi = defineLinks(['source', 'target'], {
            source: {
                schema: SourceSchema,
                links: {
                    'link.href': { to: 'target' },
                    'links[].href': { to: 'target' },
                },
            },
            target: {
                schema: OnlyIdSchema,
                links: {},
            },
        });

        type LocalApi = typeof ctxApi;
        let capturedContexts: Array<FetchContext<LocalApi>> = [];

        beforeEach(() => {
            capturedContexts = [];
        });

        async function mockAndNavigateRoot() {
            mockResponse(SourceSchema, {
                link: { href: '/target/1', title: 'Target 1' },
                links: [
                    { href: '/target/1', title: 'First' },
                    { href: '/target/2', title: 'Second' },
                ],
            });

            const fetchFactory: FetchFactory<LocalApi> = (context) => {
                capturedContexts.push(context);
                return fetch;
            };

            const entry = linkTo({
                api: ctxApi,
                resource: 'source',
                url: '/source/1',
                fetchFactory,
            });
            return await navigate(entry);
        }

        it('supplies a context for the entry fetch even though no link object exists yet', async () => {
            await mockAndNavigateRoot();

            expect(capturedContexts).toHaveLength(1);
            expect(capturedContexts[0].targetResourceName).toBe('source');
            // Entry navigable is { href } created by linkTo
            expect(capturedContexts[0].navigable).toEqual({ href: '/source/1' });
        });

        it('supplies the parent link object and target resource name when following a single link', async () => {
            const source = await mockAndNavigateRoot();
            capturedContexts = [];

            mockResponse(OnlyIdSchema, { id: '123' });
            await navigate(source.link);

            expect(capturedContexts).toHaveLength(1);
            expect(capturedContexts[0].targetResourceName).toBe('target');
            expect((capturedContexts[0].navigable as any).href).toBe('/target/1');
            expect((capturedContexts[0].navigable as any).title).toBe('Target 1');
        });

        it('supplies one context per element when following an array of links', async () => {
            const source = await mockAndNavigateRoot();
            capturedContexts = [];

            mockResponses(OnlyIdSchema, { id: '123' }, { id: '456' });
            await Promise.all(source.links.map(l => navigate(l)));

            expect(capturedContexts).toHaveLength(2);

            expect(capturedContexts[0].targetResourceName).toBe('target');
            expect((capturedContexts[0].navigable as any).href).toBe('/target/1');
            expect((capturedContexts[0].navigable as any).title).toBe('First');

            expect(capturedContexts[1].targetResourceName).toBe('target');
            expect((capturedContexts[1].navigable as any).href).toBe('/target/2');
            expect((capturedContexts[1].navigable as any).title).toBe('Second');
        });

        it('allows the factory to derive HTTP method and headers from server-supplied link metadata', async () => {
            const CustomLinkSchema = Type.Object({
                href: Type.String(),
                method: Type.Optional(Type.String()),
                headers: Type.Optional(Type.Object({
                    authorization: Type.String(),
                })),
            });

            const CustomSourceSchema = Type.Object({
                link: CustomLinkSchema,
            });

            const apiDef = defineLinks(['source', 'target'], {
                source: {
                    schema: CustomSourceSchema,
                    links: { 'link.href': { to: 'target' } },
                },
                target: {
                    schema: OnlyIdSchema,
                    links: {},
                },
            });

            type CustomApi = typeof apiDef;
            const fetchFactory: FetchFactory<CustomApi> = (context) => {
                const method = (context.navigable as any)?.method || 'GET';
                const headers = (context.navigable as any)?.headers || {};
                return (url: string) => fetch(url, { method, headers });
            };

            const entry = linkTo({
                api: apiDef,
                resource: 'source',
                url: '/source/1',
                fetchFactory,
            });

            mockResponse(CustomSourceSchema, {
                link: {
                    href: '/target/1',
                    method: 'PUT',
                    headers: { authorization: 'Bearer token123' },
                },
            });
            const source = await navigate(entry);

            mockResponse(OnlyIdSchema, { id: '123' });
            await navigate(source.link);

            const mockedFetch = global.fetch as jest.Mock;
            expect(mockedFetch).toHaveBeenCalledWith('/target/1', {
                method: 'PUT',
                headers: { authorization: 'Bearer token123' },
            });
        });
    });

    describe('typed navigable', () => {
        // Two resources with different link shapes:
        // - Document has selfUrl (string) and downloadUrl (string)
        // - Preview  has selfUrl (string) and previewUrl (string)
        // Both use string URL properties, so the navigable is the parent resource.

        const DocumentSchema = Type.Object({
            title: Type.String(),
            selfUrl: Type.String(),
            downloadUrl: Type.String(),
        });

        const PreviewSchema = Type.Object({
            thumbnail: Type.String(),
            selfUrl: Type.String(),
            previewUrl: Type.String(),
        });

        const TargetSchema = Type.Object({
            id: Type.String(),
        });

        const docApi = defineLinks(['document', 'preview', 'target'], {
            document: {
                schema: DocumentSchema,
                links: {
                    selfUrl: { to: 'document' },
                    downloadUrl: { to: 'target' },
                },
            },
            preview: {
                schema: PreviewSchema,
                links: {
                    selfUrl: { to: 'preview' },
                    previewUrl: { to: 'target' },
                },
            },
            target: {
                schema: TargetSchema,
                links: {},
            },
        });

        type DocApi = typeof docApi;
        type IsAny<T> = 0 extends (1 & T) ? true : false;

        it('produces a concrete union type, never any or never', () => {
            type Nav = AllLinkNavigables<DocApi>;
            const notAny: IsAny<Nav> = false;
            expect(notAny).toBe(false);

            type IsNever = [Nav] extends [never] ? true : false;
            const notNever: IsNever = false;
            expect(notNever).toBe(false);
        });

        it('exposes properties common to every link shape without narrowing', () => {
            type Nav = AllLinkNavigables<DocApi>;
            type HasSelfUrl = Nav extends { selfUrl: string } ? true : false;
            const hasSelfUrl: HasSelfUrl = true;
            expect(hasSelfUrl).toBe(true);
        });

        it('hides resource-specific properties behind narrowing', () => {
            type Nav = AllLinkNavigables<DocApi>;

            // downloadUrl only exists on Document
            type HasDownloadUrl = Nav extends { downloadUrl: string } ? true : false;
            const noDownloadUrl: HasDownloadUrl = false;
            expect(noDownloadUrl).toBe(false);

            // previewUrl only exists on Preview
            type HasPreviewUrl = Nav extends { previewUrl: string } ? true : false;
            const noPreviewUrl: HasPreviewUrl = false;
            expect(noPreviewUrl).toBe(false);
        });

        it('lists each concrete link shape as an assignable member of the union', () => {
            type Doc = Static<typeof DocumentSchema>;
            type Preview = Static<typeof PreviewSchema>;
            type Nav = AllLinkNavigables<DocApi>;

            type DocAssignable = Doc extends Nav ? true : false;
            const docOk: DocAssignable = true;
            expect(docOk).toBe(true);

            type PreviewAssignable = Preview extends Nav ? true : false;
            const previewOk: PreviewAssignable = true;
            expect(previewOk).toBe(true);
        });

        it('delivers the typed navigable to the factory at runtime', async () => {
            let capturedNavigable: AllLinkNavigables<DocApi> | undefined;

            const factory: FetchFactory<DocApi> = (context) => {
                capturedNavigable = context.navigable;
                // selfUrl is accessible without narrowing (shared across resources)
                const _selfUrl: string = (context.navigable as any).selfUrl;
                return fetch;
            };

            mockResponse(DocumentSchema, {
                title: 'Report.pdf',
                selfUrl: '/docs/1',
                downloadUrl: '/docs/1/download',
            });

            const entry = linkTo({
                api: docApi,
                resource: 'document',
                url: '/docs/1',
                fetchFactory: factory,
            });
            const doc = await navigate(entry);

            expect(capturedNavigable).toBeDefined();

            // After resolving the string-property link `downloadUrl`, the navigable
            // passed to the factory is the document itself (parent of the link prop).
            capturedNavigable = undefined;
            mockResponse(TargetSchema, { id: 'downloaded' });
            await navigate(doc, { link: 'downloadUrl' });

            expect(capturedNavigable).toEqual({
                title: 'Report.pdf',
                selfUrl: '/docs/1',
                downloadUrl: '/docs/1/download',
            });
        });
    });

});
