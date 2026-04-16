/**
 * navigate-all.spec.ts — navigateAll() and array fan-out edge cases
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all  ← THIS FILE
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo } from '../../src';
import { navigate, navigateAll } from '../../src/navigate';
import { petshopApi, PetshopSchema, CatalogSchema, PetSchema } from '../../examples/petshop-api';
import { mockResponse, mockResponses } from '../mock-responses';
import { mockPetshop, mockCatalog, mockPet1, mockPet2 } from '../test-schemas';

describe('navigate — navigateAll', () => {

    describe('navigateAll', () => {
        it('fetches every link in an array in parallel', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.listPets);

            mockResponses(PetSchema, mockPet1, mockPet2);
            const pets = await navigateAll(catalog.pets);

            expect(pets).toHaveLength(2);
            expect(pets[0].name).toBe('Fido');
            expect(pets[1].name).toBe('Whiskers');
        });
    });

    describe('navigateAll (array edge cases)', () => {
        it('returns an empty result without issuing fetches when the array is empty', async () => {
            const CollectionSchema = Type.Object({
                id: Type.String(),
                items: Type.Array(Type.Object({ href: Type.String() })),
            });
            const ItemSchema = Type.Object({
                id: Type.String(),
                name: Type.String(),
            });

            const api = defineLinks(['collection', 'item'], {
                collection: {
                    schema: CollectionSchema,
                    links: { 'items[].href': { to: 'item' } },
                },
                item: { schema: ItemSchema, links: {} },
            });

            mockResponse(CollectionSchema, { id: 'col-1', items: [] });
            const collection = await navigate(linkTo({
                api,
                resource: 'collection',
                url: 'http://api.com/collections/1',
            }));

            expect(collection.items).toBeDefined();
            expect(collection.items).toEqual([]);

            // navigateAll on an empty array returns an empty array (no fetches issued)
            const items = await navigateAll(collection.items);
            expect(items).toEqual([]);
        });

        it('tolerates missing optional link arrays on the parent resource', async () => {
            const CollectionSchema = Type.Object({
                id: Type.String(),
                items: Type.Optional(Type.Array(Type.Object({ href: Type.String() }))),
            });
            const ItemSchema = Type.Object({
                id: Type.String(),
                name: Type.String(),
            });

            const api = defineLinks(['collection', 'item'], {
                collection: {
                    schema: CollectionSchema,
                    links: { 'items[].href': { to: 'item' } },
                },
                item: { schema: ItemSchema, links: {} },
            });

            mockResponse(CollectionSchema, { id: 'col-1' });
            const withoutItems = await navigate(linkTo({
                api,
                resource: 'collection',
                url: 'http://api.com/collections/1',
            }));

            expect(withoutItems.items).toBeUndefined();
        });

        it('rejects the aggregate when any individual fetch fails', async () => {
            const CollectionSchema = Type.Object({
                id: Type.String(),
                items: Type.Array(Type.Object({ href: Type.String() })),
            });
            const ItemSchema = Type.Object({
                id: Type.String(),
                value: Type.String(),
            });

            const api = defineLinks(['collection', 'item'], {
                collection: {
                    schema: CollectionSchema,
                    links: { 'items[].href': { to: 'item' } },
                },
                item: { schema: ItemSchema, links: {} },
            });

            mockResponse(CollectionSchema, {
                id: 'col-1',
                items: [
                    { href: '/items/1' },
                    { href: '/items/2' },
                    { href: '/items/3' },
                ],
            });
            const collection = await navigate(linkTo({
                api,
                resource: 'collection',
                url: 'http://api.com/collections/1',
            }));

            // One middle response fails — Promise.all (and navigateAll) must reject
            const mock = global.fetch as jest.Mock;
            mock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: '1', value: 'Item 1' }) });
            mock.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
            mock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: '3', value: 'Item 3' }) });

            await expect(navigateAll(collection.items)).rejects.toThrow(/HTTP 404/);
        });

        it('fans out cleanly across large arrays', async () => {
            const CollectionSchema = Type.Object({
                total: Type.Number(),
                items: Type.Array(Type.Object({ href: Type.String() })),
            });
            const ItemSchema = Type.Object({ id: Type.String() });

            const api = defineLinks(['collection', 'item'], {
                collection: {
                    schema: CollectionSchema,
                    links: { 'items[].href': { to: 'item' } },
                },
                item: { schema: ItemSchema, links: {} },
            });

            const itemLinks = Array.from({ length: 100 }, (_, i) => ({ href: `/items/${i + 1}` }));
            mockResponse(CollectionSchema, { total: 100, items: itemLinks });

            const collection = await navigate(linkTo({
                api,
                resource: 'collection',
                url: 'http://api.com/collections/1',
            }));

            mockResponses(
                ItemSchema,
                ...Array.from({ length: 100 }, (_, i) => ({ id: `item-${i + 1}` })),
            );
            const items = await navigateAll(collection.items);

            expect(items).toHaveLength(100);
            expect(items[0].id).toBe('item-1');
            expect(items[99].id).toBe('item-100');

            // 1 collection fetch + 100 parallel item fetches
            expect(global.fetch).toHaveBeenCalledTimes(101);
        });
    });

});
