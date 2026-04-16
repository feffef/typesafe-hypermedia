/**
 * url-resolution.spec.ts — How is the final request URL produced?
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution  ← THIS FILE
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo } from '../../src';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopSchema, CatalogSchema } from '../../examples/petshop-api';
import { mockResponse } from '../mock-responses';
import {
    mockPetshop, mockCatalog,
    DashboardSchema, SimpleCatalogSchema, SimpleProductSchema,
} from '../test-schemas';

describe('navigate — URL resolution', () => {

    describe('params passing', () => {
        it('forwards param values to a templated href link object', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.searchPets, { params: { q: 'dog' } });

            expect(catalog.pets[0].href).toBe('/pets/1');
        });

        it('forwards param values to a templated named link', async () => {
            const namedLinkApi = defineLinks(['dashboard', 'catalog', 'product'], {
                dashboard: {
                    schema: DashboardSchema,
                    links: {
                        catalogUrl: { to: 'catalog' },
                        productUrl: {
                            to: 'product',
                            params: { id: Type.String() },
                        },
                    },
                },
                catalog: { schema: SimpleCatalogSchema, links: { 'items[].href': { to: 'product' } } },
                product: { schema: SimpleProductSchema, links: {} },
            });

            mockResponse(DashboardSchema, {
                welcomeMessage: 'Welcome!',
                catalogUrl: '/catalog',
                productUrl: '/products/{id}',
            });
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            mockResponse(SimpleProductSchema, { id: '1', name: 'Widget', price: 9.99 });
            const product = await navigate(dashboard, {
                link: 'productUrl',
                params: { id: '1' },
            });

            expect(product.id).toBe('1');
            expect(product.name).toBe('Widget');
        });

        it('expands both path and query params for a named templated link', async () => {
            const SearchSchema = Type.Object({ query: Type.String() });
            const ResultsSchema = Type.Object({ count: Type.Number() });

            const templatedApi = defineLinks(['search', 'results'], {
                search: {
                    schema: SearchSchema,
                    links: {
                        query: {
                            to: 'results',
                            params: {
                                q: Type.String(),
                                limit: Type.Optional(Type.Number()),
                            },
                        },
                    },
                },
                results: { schema: ResultsSchema, links: {} },
            });

            mockResponse(SearchSchema, { query: '/search{?q,limit}' });
            const search = await navigate(linkTo({
                api: templatedApi,
                resource: 'search',
                url: 'http://api.com',
            }));

            expect(search.query).toBe('/search{?q,limit}');

            mockResponse(ResultsSchema, { count: 42 });
            const results = await navigate(search, {
                link: 'query',
                params: { q: 'test', limit: 10 },
            });
            expect(results.count).toBe(42);
            expect(global.fetch).toHaveBeenLastCalledWith('http://api.com/search?q=test&limit=10');
        });
    });

    describe('template expansion', () => {
        const UriRootSchema = Type.Object({
            itemLink: Type.Object({ href: Type.String() }),
            searchLink: Type.Object({ href: Type.String() }),
        });
        const ItemSchema = Type.Object({ id: Type.String(), name: Type.String() });
        const SearchSchema = Type.Object({ results: Type.Array(Type.String()) });

        const uriApi = defineLinks(['root', 'item', 'search'], {
            root: {
                schema: UriRootSchema,
                links: {
                    'itemLink.href': {
                        to: 'item',
                        params: { id: Type.String() },
                    },
                    'searchLink.href': {
                        to: 'search',
                        params: {
                            q: Type.String(),
                            limit: Type.Optional(Type.Number()),
                        },
                    },
                },
            },
            item: { schema: ItemSchema, links: {} },
            search: { schema: SearchSchema, links: {} },
        });

        const uriConfig = { api: uriApi, resource: 'root' as const, url: '/' };

        async function setupUriRoot() {
            mockResponse(UriRootSchema, {
                itemLink: { href: '/items/{id}' },
                searchLink: { href: '/search{?q,limit}' },
            });
            return await navigate(linkTo(uriConfig));
        }

        it('substitutes path parameters into the URL', async () => {
            const root = await setupUriRoot();

            mockResponse(ItemSchema, { id: '123', name: 'Test Item' });
            const item = await navigate(root.itemLink, { params: { id: '123' } });

            expect(global.fetch).toHaveBeenLastCalledWith('/items/123');
            expect(item).toEqual({ id: '123', name: 'Test Item' });
        });

        it('substitutes query parameters into the URL', async () => {
            const root = await setupUriRoot();

            mockResponse(SearchSchema, { results: [] });
            await navigate(root.searchLink, { params: { q: 'test', limit: 10 } });

            expect(global.fetch).toHaveBeenLastCalledWith('/search?q=test&limit=10');
        });

        it('runs for named-link selections too', async () => {
            const NamedTemplateSchema = Type.Object({
                searchUrl: Type.String(),
            });

            const namedApi = defineLinks(['root', 'search'], {
                root: {
                    schema: NamedTemplateSchema,
                    links: {
                        searchUrl: {
                            to: 'search',
                            params: { q: Type.String() },
                        },
                    },
                },
                search: { schema: SearchSchema, links: {} },
            });

            mockResponse(NamedTemplateSchema, { searchUrl: '/search{?q}' });
            const root = await navigate(linkTo({
                api: namedApi,
                resource: 'root',
                url: 'http://api.com',
            }));

            mockResponse(SearchSchema, { results: ['r1'] });
            await navigate(root, { link: 'searchUrl', params: { q: 'query' } });

            expect(global.fetch).toHaveBeenLastCalledWith('http://api.com/search?q=query');
        });

        describe('params validation', () => {
            it('rejects when a required template parameter is missing', async () => {
                const root = await setupUriRoot();

                // @ts-expect-error — Testing runtime validation of missing required parameter
                await expect(navigate(root.itemLink, { params: {} }))
                    .rejects.toThrow(/Values do not match schema/);
            });

            it('rejects when a param is provided that the template does not accept', async () => {
                const BadRootSchema = Type.Object({ link: Type.Object({ href: Type.String() }) });
                const badApi = defineLinks(['root', 'target'], {
                    root: {
                        schema: BadRootSchema,
                        links: {
                            'link.href': {
                                to: 'target',
                                params: {
                                    id: Type.String(),
                                    extra: Type.String(),
                                },
                            },
                        },
                    },
                    target: { schema: Type.Any(), links: {} },
                });

                mockResponse(BadRootSchema, { link: { href: '/target/{id}' } });
                const root = await navigate(linkTo({
                    api: badApi,
                    resource: 'root',
                    url: '/',
                }));

                await expect(navigate(root.link, { params: { id: '1', extra: 'val' } }))
                    .rejects.toThrow(/Schema defines more properties.*extra/);
            });
        });
    });

    describe('baseURL resolution', () => {
        const ResourceSchema = Type.Object({
            link: Type.Optional(Type.Object({
                href: Type.String(),
                title: Type.Optional(Type.String()),
            })),
        });

        const urlApi = defineLinks(['resource'], {
            resource: {
                schema: ResourceSchema,
                links: { 'link.href': { to: 'resource' } },
            },
        });

        it('handles absolute-path hrefs against the entry baseURL', async () => {
            mockResponse(ResourceSchema, { link: { href: '/api/resource/2' } });

            const entry = linkTo({
                api: urlApi,
                resource: 'resource',
                url: 'https://api.example.com/api/resource/1',
            });
            const root = await navigate(entry);

            // Response JSON is not mutated
            expect(root.link!.href).toBe('/api/resource/2');

            const mock = mockResponse(ResourceSchema, {});
            await navigate(root.link!);

            // Verify fetch was called with full URL (baseURL + absolute path)
            expect(mock).toHaveBeenLastCalledWith('https://api.example.com/api/resource/2');
        });

        it('preserves the port when resolving absolute-path hrefs', async () => {
            mockResponse(ResourceSchema, { link: { href: '/api/resource/2' } });

            const entry = linkTo({
                api: urlApi,
                resource: 'resource',
                url: 'http://localhost:8080/api/resource/1',
            });
            const root = await navigate(entry);

            expect(root.link!.href).toBe('/api/resource/2');

            const mock = mockResponse(ResourceSchema, {});
            await navigate(root.link!);

            // Full URL includes port
            expect(mock).toHaveBeenLastCalledWith('http://localhost:8080/api/resource/2');
        });

        it('uses fully-qualified hrefs as-is without re-resolution', async () => {
            mockResponse(ResourceSchema, { link: { href: 'https://other-api.com/resource/2' } });

            const entry = linkTo({
                api: urlApi,
                resource: 'resource',
                url: 'https://api.example.com/resource/1',
            });
            const root = await navigate(entry);

            const mock = mockResponse(ResourceSchema, {});
            await navigate(root.link!);

            // Fully qualified URL used as-is, ignoring the linkTo baseURL
            expect(mock).toHaveBeenLastCalledWith('https://other-api.com/resource/2');
        });

        it('adopts the new host when navigation crosses to a different origin', async () => {
            mockResponse(ResourceSchema, { link: { href: 'https://other-api.com/resource/2' } });

            const entry = linkTo({
                api: urlApi,
                resource: 'resource',
                url: 'https://api.example.com/resource/1',
            });
            const root = await navigate(entry);

            // Navigate to a different host; its response uses an absolute path
            mockResponse(ResourceSchema, { link: { href: '/resource/3' } });
            const child = await navigate(root.link!);

            expect(child.link!.href).toBe('/resource/3');

            // Subsequent absolute-path link should resolve against the *new* host
            const mock = mockResponse(ResourceSchema, {});
            await navigate(child.link!);

            expect(mock).toHaveBeenLastCalledWith('https://other-api.com/resource/3');
        });

        it('expands templated absolute-path hrefs against the entry baseURL', async () => {
            const TemplatedResourceSchema = Type.Object({
                search: Type.Object({ href: Type.String() }),
            });

            const templatedApi = defineLinks(['search'], {
                search: {
                    schema: TemplatedResourceSchema,
                    links: {
                        'search.href': {
                            to: 'search',
                            params: { q: Type.String() },
                        },
                    },
                },
            });

            mockResponse(TemplatedResourceSchema, { search: { href: '/search{?q}' } });

            const entry = linkTo({
                api: templatedApi,
                resource: 'search',
                url: 'https://api.example.com:3000/',
            });
            const root = await navigate(entry);

            // Template is not pre-expanded
            expect(root.search.href).toBe('/search{?q}');

            const mock = mockResponse(TemplatedResourceSchema, { search: { href: '/search{?q}' } });
            await navigate(root.search, { params: { q: 'test' } });

            expect(mock).toHaveBeenLastCalledWith('https://api.example.com:3000/search?q=test');
        });
    });

});
