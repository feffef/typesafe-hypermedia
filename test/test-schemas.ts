
import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo, Simplify } from '../src';
import { navigate } from '../src/navigate';
import { mockResponse } from './mock-responses';

export const LinkSchema = Type.Object({
    href: Type.String(),
    title: Type.Optional(Type.String()),
    method: Type.Optional(Type.String()),
});

export const AllLinkTypesSchema = Type.Object({
    requiredLink: LinkSchema,
    presentLink: Type.Optional(LinkSchema),
    missingLink: Type.Optional(LinkSchema),
    requiredTemplate: LinkSchema,
    presentTemplate: Type.Optional(LinkSchema),
    missingTemplate: Type.Optional(LinkSchema),
    arrayOfLinks: Type.Array(LinkSchema),
});

export const SingleLinkSchema = Type.Object({
    link: LinkSchema,
});

export const OnlyIdSchema = Type.Object({
    id: Type.String(),
});

// Common schemas for api-definition tests
export const NestedLinksSchema = Type.Object({
    requiredLink: LinkSchema,
    optionalLink: Type.Optional(LinkSchema),
    manyLinks: Type.Array(LinkSchema),
    nested: Type.Object({
        deepLink: LinkSchema
    })
});

export const ErrorSchema = Type.Object({
    message: Type.String()
});

// Schema for testing deeply nested structures (nesting only, links in resource property)
// Each level can have: resource (links), nested (object), and items (array)
export const DeepNestingSchema = Type.Object({
    // Resource with all link types at this level
    resource: Type.Optional(AllLinkTypesSchema),

    // Nested object - can contain resource, nested, and items
    nested: Type.Optional(Type.Object({
        resource: Type.Optional(AllLinkTypesSchema),
        nested: Type.Optional(Type.Object({
            resource: Type.Optional(AllLinkTypesSchema)
        })),
        items: Type.Optional(Type.Array(Type.Object({
            resource: Type.Optional(AllLinkTypesSchema)
        })))
    })),

    // Array - items can contain resource, nested, and items
    items: Type.Optional(Type.Array(Type.Object({
        resource: Type.Optional(AllLinkTypesSchema),
        nested: Type.Optional(Type.Object({
            resource: Type.Optional(AllLinkTypesSchema),
            items: Type.Optional(Type.Array(Type.Object({
                resource: Type.Optional(AllLinkTypesSchema)
            })))
        })),
        items: Type.Optional(Type.Array(Type.Object({
            resource: Type.Optional(AllLinkTypesSchema)
        })))
    })))
});

const apiDef = defineLinks(['root', 'linked'], {
    root: {
        schema: SingleLinkSchema,
        links: {
            'link.href': { to: 'linked' }
        }
    },
    linked: {
        schema: OnlyIdSchema,
        links: {}
    }
});
export interface RootWithLinkApi extends Simplify<typeof apiDef> { }
export const rootWithLinkApiDef: RootWithLinkApi = apiDef;

// Union and intersection schemas for testing
export const IntersectionLinkSchema = Type.Intersect([
    LinkSchema,
    Type.Object({ propA: Type.String() })
]);

export const UnionLinkSchema = Type.Union([
    LinkSchema,
    Type.Object({ propB: Type.Number() })
]);

// ============================================================================
// Shared Petshop mock data — used across many integration files
// ============================================================================

export const mockPetshop = {
    actions: {
        listPets: { href: '/pets' },
        getPet: { href: '/pets/{id}' },
        searchPets: { href: '/pets{?q}' },
    },
};

export const mockCatalog = {
    pets: [
        { href: '/pets/1', title: 'Fido' },
        { href: '/pets/2', title: 'Whiskers' },
    ],
};

export const mockPet1 = { id: '1', name: 'Fido', species: 'Dog' as const, price: 100, actions: {} };
export const mockPet2 = { id: '2', name: 'Whiskers', species: 'Cat' as const, price: 150, actions: {} };
export const mockPet123 = { id: '123', name: 'Buddy', species: 'Dog' as const, price: 200, actions: {} };

// ============================================================================
// Shared schemas for named-link / custom-property tests
// ============================================================================

export const SimpleProductSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    price: Type.Number(),
});

export const SimpleCatalogSchema = Type.Object({
    items: Type.Array(Type.Object({ href: Type.String() })),
});

export const DashboardSchema = Type.Object({
    welcomeMessage: Type.String(),
    catalogUrl: Type.String(),
    productUrl: Type.String(),
});

// ============================================================================
// Shared error-handling fixtures (api definition + mock root + setup helper)
// ============================================================================

export const ErrorLinkSchema = Type.Object({
    href: Type.String(),
    title: Type.Optional(Type.String()),
});

export const NotFoundErrorSchema = Type.Object({
    message: Type.String(),
    code: Type.Literal('NOT_FOUND'),
    resourceType: Type.String(),
    actions: Type.Object({
        search: ErrorLinkSchema,
        home: ErrorLinkSchema,
    }),
});

export const ValidationErrorSchema = Type.Object({
    message: Type.String(),
    code: Type.Literal('VALIDATION_ERROR'),
    errors: Type.Array(Type.Object({
        field: Type.String(),
        error: Type.String(),
    })),
});

export const ServerErrorSchema = Type.Object({
    message: Type.String(),
    code: Type.Literal('SERVER_ERROR'),
    requestId: Type.String(),
    actions: Type.Object({
        retry: ErrorLinkSchema,
        support: ErrorLinkSchema,
    }),
});

export const ErrorRootSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    actions: Type.Object({
        safeLink: ErrorLinkSchema,
        errorProneLink: ErrorLinkSchema,
        multiErrorLink: ErrorLinkSchema,
    }),
});

export const ErrorTargetSchema = Type.Object({
    id: Type.String(),
    data: Type.String(),
});

export const errorApi = defineLinks(
    ['root', 'target', 'notFound', 'validationError', 'serverError'],
    {
        root: {
            schema: ErrorRootSchema,
            links: {
                'actions.safeLink.href': { to: 'target' },
                'actions.errorProneLink.href': {
                    to: 'target',
                    expect: { 404: 'notFound' },
                },
                'actions.multiErrorLink.href': {
                    to: 'target',
                    expect: {
                        404: 'notFound',
                        400: 'validationError',
                        500: 'serverError',
                    },
                },
            },
        },
        target: { schema: ErrorTargetSchema, links: {} },
        notFound: {
            schema: NotFoundErrorSchema,
            links: {
                'actions.search.href': { to: 'root' },
                'actions.home.href': { to: 'root' },
            },
        },
        validationError: { schema: ValidationErrorSchema, links: {} },
        serverError: {
            schema: ServerErrorSchema,
            links: {
                'actions.retry.href': { to: 'target' },
                'actions.support.href': { to: 'root' },
            },
        },
    }
);

export const mockErrorRoot = {
    id: 'root',
    name: 'Root Resource',
    actions: {
        safeLink: { href: '/safe' },
        errorProneLink: { href: '/error-prone' },
        multiErrorLink: { href: '/multi-error' },
    },
};

export async function setupErrorRoot(options?: { errorVerbosity?: 'verbose' | 'safe' }) {
    mockResponse(ErrorRootSchema, 200, mockErrorRoot);
    const entry = linkTo({
        api: errorApi,
        resource: 'root',
        url: 'http://localhost:3000/root',
        ...options,
    });
    return await navigate(entry);
}
