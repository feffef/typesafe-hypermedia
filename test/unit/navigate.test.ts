import { Type } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../src';
import {
    Resource,
    Navigable,
    LinkSpec,
} from '../../src/type-system';
import { ResourceOrFailure } from '../../src/error-handling';
import { navigate as navigateReal, navigateAll as navigateAllReal } from '../../src/navigate';

// Mock navigate for type-only tests (avoid runtime metadata errors on type stubs)
jest.mock('../../src/navigate', () => {
    const original = jest.requireActual('../../src/navigate');
    return {
        ...original,
        navigate: jest.fn(),
        navigateAll: jest.fn(),
    };
});

const navigate: typeof navigateReal = (navigateReal as any);
const navigateAll: typeof navigateAllReal = (navigateAllReal as any);

// Configure mocks to return proxy stubs for type-only tests.
// The proxy satisfies any property access (returns 'stub' for strings)
// and supports tuple destructuring via Symbol.iterator (yields [stub, null]).
// This allows compile-time type checks to run without requiring real metadata.
(navigateReal as jest.Mock).mockImplementation(async () => {
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') return undefined;
            if (typeof prop === 'string') return 'stub';
            if (prop === Symbol.iterator) {
                return function* () {
                    yield new Proxy({}, {
                        get(_t, p) {
                            if (typeof p === 'string') return 'stub';
                            return undefined;
                        }
                    });
                    yield null;
                };
            }
            return undefined;
        }
    });
});

(navigateAllReal as jest.Mock).mockImplementation(async () => []);

// ============================================================================
// Test Schemas
// ============================================================================

const ShopSchema = Type.Object({
    name: Type.String(),
    productsLink: Type.Object({
        href: Type.String(),
    }),
    templatedLink: Type.Object({
        href: Type.String(),
    }),
});

const ProductSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    price: Type.Number(),
});

const NotFoundSchema = Type.Object({
    message: Type.String(),
    code: Type.String(),
});

const ValidationErrorSchema = Type.Object({
    message: Type.String(),
    errors: Type.Array(Type.Object({
        field: Type.String(),
        error: Type.String(),
    })),
});

const CatalogSchema = Type.Object({
    items: Type.Array(Type.Object({
        href: Type.String(),
    })),
});

// ============================================================================
// API Definitions
// ============================================================================

const apiDef = defineLinks(
    ['shop', 'product', 'catalog', 'notFound', 'validationError'],
    {
        shop: {
            schema: ShopSchema,
            links: {
                'productsLink.href': { to: 'catalog' },
                'templatedLink.href': {
                    to: 'product',
                    params: { id: Type.String() },
                },
            },
        },
        product: {
            schema: ProductSchema,
            links: {},
        },
        catalog: {
            schema: CatalogSchema,
            links: {
                'items[].href': { to: 'product' },
            },
        },
        notFound: {
            schema: NotFoundSchema,
            links: {},
        },
        validationError: {
            schema: ValidationErrorSchema,
            links: {},
        },
    }
);
interface Api extends Simplify<typeof apiDef> {}
const api: Api = apiDef;

// Error-prone API definition for type tests
const errorDef = defineLinks(
    ['root', 'pet', 'notFound', 'validationError'],
    {
        root: {
            schema: Type.Object({
                safeLink: Type.Object({ href: Type.String() }),
                proneLink: Type.Object({ href: Type.String() }),
                proneTemplatedLink: Type.Object({ href: Type.String() }),
                namedSafe: Type.String(),
                namedProne: Type.String(),
                namedProneTemplated: Type.String(),
            }),
            links: {
                'safeLink.href': { to: 'pet' },
                'proneLink.href': {
                    to: 'pet',
                    expect: { 404: 'notFound' },
                },
                'proneTemplatedLink.href': {
                    to: 'pet',
                    params: { id: Type.String() },
                    expect: {
                        404: 'notFound',
                        400: 'validationError',
                    },
                },
                'namedSafe': { to: 'pet' },
                'namedProne': {
                    to: 'pet',
                    expect: { 404: 'notFound' },
                },
                'namedProneTemplated': {
                    to: 'pet',
                    params: { id: Type.String() },
                    expect: {
                        404: 'notFound',
                        400: 'validationError',
                    },
                },
            },
        },
        pet: {
            schema: Type.Object({
                id: Type.String(),
                name: Type.String(),
            }),
            links: {},
        },
        notFound: {
            schema: NotFoundSchema,
            links: {},
        },
        validationError: {
            schema: ValidationErrorSchema,
            links: {},
        },
    }
);
interface ErrorApi extends Simplify<typeof errorDef> {}
const errorApiDef: ErrorApi = errorDef;

// ============================================================================
// POSITIVE TYPE TESTS — Must Compile
// ============================================================================

describe('navigate type tests', () => {
    describe('href mode — positive tests', () => {
        it('simple concrete href navigation returns Resource', async () => {
            type Links = {
                href: LinkSpec<'catalog', never, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj);

            const _check: Resource<'catalog', Api> = result;
        });

        it('templated href with params returns Resource', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                href: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj, { params: { id: '123' } });

            const _check: Resource<'product', Api> = result;
        });

        it('concrete href with expect returns tuple', async () => {
            type Links = {
                href: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj);

            const _check: ResourceOrFailure<Links['href']> = result;
        });

        it('templated href with expect and params returns tuple', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                href: LinkSpec<'pet', typeof ParamsSchema, ErrorApi, { 404: 'notFound'; 400: 'validationError' }>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj, { params: { id: '42' } });

            const _check: ResourceOrFailure<Links['href']> = result;
        });
    });

    describe('named link mode — positive tests', () => {
        it('named link returns Resource', async () => {
            type Links = {
                namedSafe: LinkSpec<'pet', never, ErrorApi, undefined>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav, { link: 'namedSafe' });

            const _check: Resource<'pet', ErrorApi> = result;
        });

        it('named link with params returns Resource', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                getProduct: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav, { link: 'getProduct', params: { id: '5' } });

            const _check: Resource<'product', Api> = result;
        });

        it('named link with expect returns tuple', async () => {
            type Links = {
                namedProne: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav, { link: 'namedProne' });

            const _check: ResourceOrFailure<Links['namedProne']> = result;
        });

        it('named link with expect and params returns tuple', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                namedProneTemplated: LinkSpec<'pet', typeof ParamsSchema, ErrorApi, { 404: 'notFound'; 400: 'validationError' }>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav, { link: 'namedProneTemplated', params: { id: '7' } });

            const _check: ResourceOrFailure<Links['namedProneTemplated']> = result;
        });
    });

    describe('navigateAll — positive tests', () => {
        it('array of safe concrete links returns Resource[]', async () => {
            type Links = {
                href: LinkSpec<'product', never, Api, undefined>;
            };
            const links = [] as Navigable<Links>[];

            const result = await navigateAll(links);

            const _check: Resource<'product', Api>[] = result;
        });
    });

    // ============================================================================
    // NEGATIVE TYPE TESTS — Must Fail
    // ============================================================================

    describe('href mode — negative tests', () => {
        it('rejects missing params when link has param schema', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                href: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            // @ts-expect-error — params required for templated href
            await navigate(linkObj);
        });

        it('rejects wrong params shape', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                href: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            // @ts-expect-error — wrong param shape
            await navigate(linkObj, { params: { name: 'wrong' } });
        });

        it('rejects params when none are needed', async () => {
            type Links = {
                href: LinkSpec<'catalog', never, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            // @ts-expect-error — no params expected on concrete link
            await navigate(linkObj, { params: { id: '123' } });
        });
    });

    describe('named link mode — negative tests', () => {
        it('rejects missing params when named link has param schema', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                getProduct: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // @ts-expect-error — params required for named link with params
            await navigate(nav, { link: 'getProduct' });
        });

        it('rejects invalid link name', async () => {
            type Links = {
                listProducts: LinkSpec<'catalog', never, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // @ts-expect-error — 'nonExistent' is not a valid link name
            await navigate(nav, { link: 'nonExistent' });
        });

        it('rejects navigate(nav) when navigable has no href (§5.5)', async () => {
            type Links = {
                productsUrl: LinkSpec<'catalog', never, Api, undefined>;
                searchUrl: LinkSpec<'product', never, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // @ts-expect-error — no href link; must specify { link: '...' }
            await navigate(nav);
        });

        it('rejects params on named link that has no param schema', async () => {
            type Links = {
                safeLinkName: LinkSpec<'catalog', never, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // @ts-expect-error — params forbidden when link has no param schema
            await navigate(nav, { link: 'safeLinkName', params: { anything: true } });
        });
    });

    describe('navigateAll — negative tests', () => {
        it('rejects navigateAll with prone links', async () => {
            type Links = {
                href: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const links = [] as Navigable<Links>[];

            // @ts-expect-error — navigateAll only works with safe links
            await navigateAll(links);
        });

        it('rejects navigateAll with templated links', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                href: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const links = [] as Navigable<Links>[];

            // @ts-expect-error — navigateAll only works with concrete links
            await navigateAll(links);
        });
    });

    // ============================================================================
    // RETURN TYPE VERIFICATION
    // ============================================================================

    describe('return type verification', () => {
        it('safe link result assignable to Resource', async () => {
            type Links = {
                href: LinkSpec<'product', never, Api, undefined>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj);
            const r: Resource<'product', Api> = result;
            const _id: string = r.id;
            const _name: string = r.name;
        });

        it('prone link result NOT assignable to plain Resource', async () => {
            type Links = {
                href: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj);

            // @ts-expect-error — prone result is a tuple, not a plain Resource
            const _bad: Resource<'pet', ErrorApi> = result;
        });

        it('prone link result assignable to tuple type', async () => {
            type Links = {
                href: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const linkObj = {} as Navigable<Links>;

            const result = await navigate(linkObj);

            const _tuple: ResourceOrFailure<Links['href']> = result;
        });

        it('error union narrowing works in switch', async () => {
            type Links = {
                href: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound'; 400: 'validationError' }>;
            };
            const linkObj = {} as Navigable<Links>;

            const [pet, error] = await navigate(linkObj);

            if (error) {
                switch (error.kind) {
                    case 'notFound': {
                        const _msg: string = error.resource.message;
                        const _code: string = error.resource.code;
                        break;
                    }
                    case 'validationError': {
                        const _msg: string = error.resource.message;
                        const _errors: { field: string; error: string }[] = error.resource.errors;
                        break;
                    }
                    case 'unexpected': {
                        const _msg: string = error.message;
                        break;
                    }
                }
                return;
            }

            if (pet) {
                const _id: string = pet.id;
                const _name: string = pet.name;
            }
        });

        it('prone named-link result NOT assignable to Resource', async () => {
            type Links = {
                namedProne: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav, { link: 'namedProne' });

            // @ts-expect-error — prone named-link result is a tuple, not a plain Resource
            const _bad: Resource<'pet', ErrorApi> = result;
        });

        it('prone named-link error union narrowing works in switch', async () => {
            type Links = {
                namedProneTemplated: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound'; 400: 'validationError' }>;
            };
            const nav = {} as Navigable<Links>;

            const [pet, error] = await navigate(nav, { link: 'namedProneTemplated' });

            if (error) {
                switch (error.kind) {
                    case 'notFound': {
                        const _msg: string = error.resource.message;
                        const _code: string = error.resource.code;
                        break;
                    }
                    case 'validationError': {
                        const _msg: string = error.resource.message;
                        const _errors: { field: string; error: string }[] = error.resource.errors;
                        break;
                    }
                    case 'unexpected': {
                        const _msg: string = error.message;
                        break;
                    }
                }
                return;
            }

            if (pet) {
                const _id: string = pet.id;
                const _name: string = pet.name;
            }
        });

        it('navigable with both href AND named links requires explicit link option', async () => {
            type Links = {
                href: LinkSpec<'catalog', never, Api, undefined>;
                searchUrl: LinkSpec<'product', never, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // Multiple links — must specify which one
            // @ts-expect-error — two links, navigate(nav) is ambiguous
            await navigate(nav);

            // Explicit link: 'href' works via named-link overload
            const catalog = await navigate(nav, { link: 'href' });
            const _catalogCheck: Resource<'catalog', Api> = catalog;

            // Explicit link: 'searchUrl' works via named-link overload
            const product = await navigate(nav, { link: 'searchUrl' });
            const _productCheck: Resource<'product', Api> = product;
        });

        it('single non-href link can be navigated without link option', async () => {
            type Links = {
                productsUrl: LinkSpec<'catalog', never, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            // Only one link — no need to specify link
            const catalog = await navigate(nav);
            const _check: Resource<'catalog', Api> = catalog;
        });

        it('single templated non-href link requires only params', async () => {
            const ParamsSchema = Type.Object({ id: Type.String() });
            type Links = {
                getProduct: LinkSpec<'product', typeof ParamsSchema, Api, undefined>;
            };
            const nav = {} as Navigable<Links>;

            const product = await navigate(nav, { params: { id: '42' } });
            const _check: Resource<'product', Api> = product;
        });

        it('single prone non-href link returns tuple', async () => {
            type Links = {
                riskyLink: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const nav = {} as Navigable<Links>;

            const result = await navigate(nav);
            const _tuple: ResourceOrFailure<Links['riskyLink']> = result;

            // @ts-expect-error — prone result is not assignable to plain Resource
            const _bad: Resource<'pet', ErrorApi> = result;
        });

        it('navigable with both safe and prone links: return types are discriminated per link', async () => {
            type Links = {
                safeLink: LinkSpec<'pet', never, ErrorApi, undefined>;
                proneLink: LinkSpec<'pet', never, ErrorApi, { 404: 'notFound' }>;
            };
            const nav = {} as Navigable<Links>;

            // Safe link — returns Resource directly, not a tuple
            const safeResult = await navigate(nav, { link: 'safeLink' });
            const _safePet: Resource<'pet', ErrorApi> = safeResult;

            // Prone link — returns tuple
            const proneResult = await navigate(nav, { link: 'proneLink' });
            const _proneTuple: ResourceOrFailure<Links['proneLink']> = proneResult;

            // Safe link result is NOT a tuple
            // @ts-expect-error — safe link result is not a tuple
            const [_bad] = await navigate(nav, { link: 'safeLink' });

            // Prone link result is NOT a plain Resource
            // @ts-expect-error — prone link result is not a plain Resource
            const _badResource: Resource<'pet', ErrorApi> = await navigate(nav, { link: 'proneLink' });
        });
    });

});

