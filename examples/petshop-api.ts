import { Type, Static, Optional } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../src';

/* a domain specific link schema that allows the server to specify the HTTP method to use */
export const LinkSchema = Type.Object({
    href: Type.String(),
    title: Type.Optional(Type.String()),
    method: Type.Optional(Type.String()),
});

export type Link = Static<typeof LinkSchema>;

// --- Domain Schemas---
export const PetSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    species: Type.Union([Type.Literal('Dog'), Type.Literal('Cat')]),
    price: Type.Number(),

    actions: Type.Object({
        order: Optional(LinkSchema),
    }),
});

export type Pet = Static<typeof PetSchema>;

export const OrderSchema = Type.Object({
    orderId: Type.String(),
    status: Type.String(),
    total: Type.Number(),

    pet: LinkSchema,
});

export type Order = Static<typeof OrderSchema>;

export const CatalogSchema = Type.Object({
    pets: Type.Array(LinkSchema),
});
export type Catalog = Static<typeof CatalogSchema>;

export const PetshopSchema = Type.Object({
    actions: Type.Object({
        listPets: LinkSchema,
        getPet: LinkSchema,
        searchPets: LinkSchema,
    }),
});

export type Petshop = Static<typeof PetshopSchema>;

// Minimal problem schema — see docs/housekeeping.md for full RFC 7807 expansion.
// The optional `suggestionsLink` demonstrates the recovery-link pattern: an
// error resource can itself carry a link to a useful fallback (e.g. the
// catalog/search endpoint) that the client can navigate to after handling
// the failure.
export const ProblemSchema = Type.Object({
    title: Type.String(),
    suggestionsLink: Optional(LinkSchema),
});

export type Problem = Static<typeof ProblemSchema>;

// --- API Definition ---

/**
 * Shared Petshop API definition used by both the test server and integration tests.
 * This ensures consistency between what the server produces and what clients consume.
 */
const apiDef = defineLinks(['petshop', 'catalog', 'pet', 'order', 'problem'], {
    petshop: {
        schema: PetshopSchema,
        links: {
            'actions.listPets.href': { to: 'catalog' },
            'actions.getPet.href': {
                to: 'pet',
                params: { id: Type.String() },
                expect: {
                    404: 'problem'
                }
            },
            'actions.searchPets.href': {
                to: 'catalog',
                params: { q: Type.String() }
            }
        }
    },
    catalog: {
        schema: CatalogSchema,
        links: {
            'pets[].href': { to: 'pet' }
        }
    },
    pet: {
        schema: PetSchema,
        links: {
            'actions.order.href': { to: 'order' }
        }
    },
    order: {
        schema: OrderSchema,
        links: {
            'pet.href': { to: 'pet' }
        }
    },
    problem: {
        schema: ProblemSchema,
        // The error resource has a recovery link back to the catalog.
        // Clients handling a 404 can navigate this link to get a list of
        // available pets instead of dead-ending on the failure.
        links: {
            'suggestionsLink.href': { to: 'catalog' }
        }
    }
});

/**
 * Named interface for IDE tooltip readability — hover shows `PetshopApi`
 * instead of the full structural type. See `test/e2e/petshop-fastify.spec.ts`
 * for the canonical client-side usage patterns, including `FetchFactory` with
 * server-driven HTTP methods and prone-link error handling with a recovery
 * link.
 */
export interface PetshopApi extends Simplify<typeof apiDef> { }
export const petshopApi: PetshopApi = apiDef;
