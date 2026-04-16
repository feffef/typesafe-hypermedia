/**
 * navigate-entry.spec.ts — Bootstrapping: linkTo() → first navigate(entry)
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
 *     (single-link auto vs named-link, zero/2+ link reject) → navigate-overloads
 *  9. "A navigable can live here too" (array element, nested, HAL _links,
 *     siblings, optional) → link-locations
 * 10. Bootstrap step (linkTo → first navigate(root)) or its return type
 *     → navigate-entry  ← THIS FILE
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo, Navigable, LinkSpec } from '../../src';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopSchema } from '../../examples/petshop-api';
import { mockResponse } from '../mock-responses';
import { mockPetshop } from '../test-schemas';

describe('navigate — entry point', () => {

    describe('entry point', () => {
        it('resolves the root resource from a configured client', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const root = linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            });
            const shop = await navigate(root);

            expect(shop.actions.listPets).toBeDefined();
            expect(shop.actions.getPet).toBeDefined();
            expect(shop.actions.searchPets).toBeDefined();
            expect(shop.actions.listPets.href).toBe('/pets');
            expect(shop.actions.getPet.href).toBe('/pets/{id}');
            expect(shop.actions.searchPets.href).toBe('/pets{?q}');
        });

        it('honors the configured root resource name', async () => {
            const MultiRootApi = defineLinks(['a', 'b'], {
                a: {
                    schema: Type.Object({
                        linkB: Type.Object({ href: Type.String() }),
                    }),
                    links: { 'linkB.href': { to: 'b' } },
                },
                b: {
                    schema: Type.Object({
                        linkA: Type.Object({ href: Type.String() }),
                    }),
                    links: { 'linkA.href': { to: 'a' } },
                },
            });

            mockResponse(Type.Object({ linkA: Type.Object({ href: Type.String() }) }), {
                linkA: { href: '/a' },
            });

            const bEntry = linkTo({
                api: MultiRootApi,
                resource: 'b',
                url: 'http://localhost:3000',
            });
            const bResource = await navigate(bEntry);
            expect(bResource.linkA).toBeDefined();
            expect(bResource.linkA.href).toBe('/a');
        });
    });

    describe('return type', () => {
        it('is a typed promise, never Promise<any>', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const root = linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            });
            const promise = navigate(root);
            const rv = await promise;

            type IsAny<T> = 0 extends (1 & T) ? true : false;
            const isAny: IsAny<typeof rv> = false;
            expect(isAny).toBe(false);
        });

        it('is assignable to Navigable when the root has top-level link properties', async () => {
            // Top-level URL string pattern: the property itself is the link, not nested href
            const TopLevelUrlSchema = Type.Object({
                directUrl: Type.String(),
            });
            const topLevelApi = defineLinks(['root', 'target'], {
                root: {
                    schema: TopLevelUrlSchema,
                    links: {
                        'directUrl': { to: 'target' },
                    },
                },
                target: {
                    schema: Type.Object({ id: Type.String() }),
                    links: {},
                },
            });

            mockResponse(TopLevelUrlSchema, { directUrl: '/target' });
            const root = linkTo({
                api: topLevelApi,
                resource: 'root',
                url: 'http://localhost:3000',
            });

            // Type-level assertion: result is assignable to Navigable
            // with phantom types describing the top-level link
            const api: Navigable<{ directUrl: LinkSpec }> = await navigate(root);
            expect(api).toBeDefined();
        });
    });

});
