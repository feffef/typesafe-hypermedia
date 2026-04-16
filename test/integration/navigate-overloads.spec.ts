/**
 * navigate-overloads.spec.ts — Which navigate() overload fires?
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input (null, undefined, primitive, plain object,
 *     unknown resource, unknown link) asserting an error → runtime-guards
 *  2. Custom fetchFactory installed, or compile-time check on the typed
 *     navigable union → fetch-customization
 *  3. errorVerbosity: 'safe' anywhere → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error (safe throw vs prone tuple,
 *     kind narrowing, recovery via embedded links) → error-handling
 *  8. Which navigate() overload fires for a correctly-shaped navigable
 *     (single-link auto vs named-link, zero/2+ link reject) → navigate-overloads ← THIS FILE
 *  9. "A navigable can live here too" (array element, nested, HAL _links,
 *     siblings, optional) → link-locations
 * 10. Bootstrap step (linkTo → first navigate(root)) or its return type
 *     → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo } from '../../src';
import { navigate } from '../../src/navigate';
import { mockResponse } from '../mock-responses';
import { DashboardSchema, SimpleCatalogSchema, SimpleProductSchema } from '../test-schemas';

describe('navigate — overload dispatch', () => {

    describe('named-link mode', () => {
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
            catalog: {
                schema: SimpleCatalogSchema,
                links: { 'items[].href': { to: 'product' } },
            },
            product: {
                schema: SimpleProductSchema,
                links: {},
            },
        });

        const mockDashboard = {
            welcomeMessage: 'Welcome!',
            catalogUrl: '/catalog',
            productUrl: '/products/{id}',
        };

        const mockSimpleCatalog = {
            items: [{ href: '/products/1' }, { href: '/products/2' }],
        };

        it('follows a link selected by name', async () => {
            mockResponse(DashboardSchema, mockDashboard);
            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            mockResponse(SimpleCatalogSchema, mockSimpleCatalog);
            const catalog = await navigate(dashboard, { link: 'catalogUrl' });

            expect(catalog.items).toHaveLength(2);
        });

        it('follows each link independently when multiple exist on one object', async () => {
            const MultiLinkSchema = Type.Object({
                self: Type.String(),
                next: Type.String(),
            });
            const NextPageSchema = Type.Object({ id: Type.String() });

            const multiLinkApi = defineLinks(['root', 'nextPage'], {
                root: {
                    schema: MultiLinkSchema,
                    links: {
                        self: { to: 'root' },
                        next: { to: 'nextPage' },
                    },
                },
                nextPage: { schema: NextPageSchema, links: {} },
            });

            mockResponse(MultiLinkSchema, { self: '/root', next: '/page/2' });
            const root = await navigate(linkTo({
                api: multiLinkApi,
                resource: 'root',
                url: 'http://api.com',
            }));

            mockResponse(MultiLinkSchema, { self: '/root', next: '/page/2' });
            const self = await navigate(root, { link: 'self' });
            expect(self.self).toBe('/root');

            mockResponse(NextPageSchema, { id: 'page2' });
            const next = await navigate(root, { link: 'next' });
            expect(next.id).toBe('page2');
        });
    });

    describe('single-link mode', () => {
        it('auto-resolves without a link name when the object has exactly one link', async () => {
            const SingleLinkSchema = Type.Object({
                productsUrl: Type.String(),
            });

            const singleApi = defineLinks(['root', 'catalog'], {
                root: {
                    schema: SingleLinkSchema,
                    links: { productsUrl: { to: 'catalog' } },
                },
                catalog: { schema: SimpleCatalogSchema, links: {} },
            });

            mockResponse(SingleLinkSchema, { productsUrl: '/catalog' });
            const root = await navigate(linkTo({
                api: singleApi,
                resource: 'root',
                url: 'http://localhost:3000',
            }));

            // Single link — navigate auto-resolves without { link: 'productsUrl' }
            mockResponse(SimpleCatalogSchema, { items: [{ href: '/p/1' }] });
            const catalog = await navigate(root);
            expect(catalog.items).toHaveLength(1);
        });

        it('accepts params alone (no link name) when the sole link is templated', async () => {
            const SingleSchema = Type.Object({ getProduct: Type.String() });

            const singleApi = defineLinks(['root', 'product'], {
                root: {
                    schema: SingleSchema,
                    links: {
                        getProduct: {
                            to: 'product',
                            params: { id: Type.String() },
                        },
                    },
                },
                product: { schema: SimpleProductSchema, links: {} },
            });

            mockResponse(SingleSchema, { getProduct: '/products/{id}' });
            const root = await navigate(linkTo({
                api: singleApi,
                resource: 'root',
                url: 'http://localhost:3000',
            }));

            // Single templated link — params only, no link option needed
            mockResponse(SimpleProductSchema, { id: '42', name: 'Widget', price: 9.99 });
            const product = await navigate(root, { params: { id: '42' } });
            expect(product.id).toBe('42');
        });

        it('rejects at runtime and compile time when the object has more than one link', async () => {
            mockResponse(DashboardSchema, {
                welcomeMessage: 'Hi',
                catalogUrl: '/catalog',
                productUrl: '/products/{id}',
            });
            const namedLinkApi = defineLinks(['dashboard', 'catalog', 'product'], {
                dashboard: {
                    schema: DashboardSchema,
                    links: {
                        catalogUrl: { to: 'catalog' },
                        productUrl: { to: 'product' },
                    },
                },
                catalog: { schema: SimpleCatalogSchema, links: {} },
                product: { schema: SimpleProductSchema, links: {} },
            });

            const dashboard = await navigate(linkTo({
                api: namedLinkApi,
                resource: 'dashboard',
                url: 'http://localhost:3000',
            }));

            // @ts-expect-error — multiple links, navigate(nav) is ambiguous
            // The runtime guard reports this as an "Internal library bug" because
            // SingleKeyGuard<L> normally prevents this at compile time; reaching
            // it requires bypassing the type system (here via @ts-expect-error).
            await expect(navigate(dashboard)).rejects.toThrow(
                /Internal library bug in recallLink: called without a link name on a navigable with 2 links/
            );
        });

        it('rejects when the object has no links at all', async () => {
            const EmptySchema = Type.Object({ id: Type.String() });
            const emptyApi = defineLinks(['empty'], {
                empty: { schema: EmptySchema, links: {} },
            });

            const entry = linkTo({
                api: emptyApi,
                resource: 'empty',
                url: 'http://localhost:3000',
            });

            mockResponse(EmptySchema, { id: '1' });
            const empty = await navigate(entry);

            // @ts-expect-error — no links on empty object
            await expect(navigate(empty)).rejects.toThrow('Link metadata not found');
        });
    });

});
