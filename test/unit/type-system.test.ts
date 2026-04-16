import { defineLinks, Simplify } from '../../src';
import { Type, Static, TObject } from '@sinclair/typebox';
import { AllLinkTypesSchema, DeepNestingSchema, LinkSchema } from '../test-schemas';
import {
    $links,
    Resource,
    Navigable,
    LinkSpec,
    RootNavigable,
    MergeInner,
} from '../../src/type-system';
import { Failure } from '../../src/error-handling';
import { linkTo, navigate } from '../../src/navigate';

// Mock navigate to use the local proxy stub
jest.mock('../../src/navigate', () => {
    const original = jest.requireActual('../../src/navigate');
    return {
        ...original,
        navigate: jest.fn(),
        navigateAll: jest.fn()
    };
});


// Type assertion helper

// Helper type to check for 'any' type
type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;


const RootSchema = Type.Object({
    allLinkTypes: LinkSchema,
    deepNesting: LinkSchema,
    linkObject: LinkSchema,
    directUrl: Type.String(),
});

const TargetSchema = Type.Object({
    self: LinkSchema
});

const UserListSchema = Type.Object({
    users: Type.Array(Type.Object({
        id: Type.String(),
        name: Type.String(),
        userLink: LinkSchema
    })),
    search: LinkSchema,
    create: LinkSchema
});

const UserSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    email: Type.String(),
    self: LinkSchema,
    update: LinkSchema,
    delete: LinkSchema
});

// Complex nesting schema for edge case testing
const ComplexNestingSchema = Type.Object({
    // Direct link
    directLink: LinkSchema,
    // Nested object with link
    level1: Type.Object({
        link: LinkSchema,
        // Double nested
        level2: Type.Object({
            link: LinkSchema,
            // Triple nested
            level3: Type.Object({
                link: LinkSchema
            })
        })
    }),
    // Array at root
    rootArray: Type.Array(Type.Object({
        link: LinkSchema
    })),
    // Nested object containing array
    nestedWithArray: Type.Object({
        items: Type.Array(Type.Object({
            link: LinkSchema
        }))
    }),
    // Array containing nested object
    arrayWithNested: Type.Array(Type.Object({
        nested: Type.Object({
            link: LinkSchema
        })
    })),
    // Multiple arrays
    doubleArray: Type.Array(Type.Object({
        items: Type.Array(Type.Object({
            link: LinkSchema
        }))
    })),
    // Mixed: array -> nested -> array
    complexMixed: Type.Array(Type.Object({
        nested: Type.Object({
            items: Type.Array(Type.Object({
                link: LinkSchema
            }))
        })
    })),
    // Optional link
    optionalLink: Type.Optional(LinkSchema),
    // Optional container with link
    optionalContainer: Type.Optional(Type.Object({
        link: LinkSchema
    })),
    // Multiple links at same level
    multipleLinks: Type.Object({
        link1: LinkSchema,
        link2: LinkSchema,
        link3: LinkSchema
    })
});

type Root = Static<typeof RootSchema>;

const def = defineLinks(['root', 'allLinkTypes', 'deepNesting', 'target', 'users', 'user', 'complexNesting'], {
    root: {
        schema: RootSchema,
        links: {
            'allLinkTypes.href': { to: 'allLinkTypes' },
            'deepNesting.href': { to: 'deepNesting' },
            'linkObject.href': { to: 'target' },
            'directUrl': { to: 'target' }
        }
    },
    allLinkTypes: {
        schema: AllLinkTypesSchema,
        links: {
            "requiredLink.href": { to: 'allLinkTypes' },
            "presentLink.href": { to: 'allLinkTypes' },
            "missingLink.href": { to: 'allLinkTypes' },
            "requiredTemplate.href": { to: 'allLinkTypes' },
            "presentTemplate.href": { to: 'allLinkTypes' },
            "missingTemplate.href": { to: 'allLinkTypes' },
            "arrayOfLinks[].href": { to: 'allLinkTypes' }
        }
    },
    deepNesting: {
        schema: DeepNestingSchema,
        links: {}
    },
    target: {
        schema: TargetSchema,
        links: {
            'self.href': { to: 'target' }
        }
    },
    users: {
        schema: UserListSchema,
        links: {
            'users[].userLink.href': {
                to: 'user'
            },
            'search.href': {
                to: 'users',
                params: {
                    query: Type.String(),
                    limit: Type.Optional(Type.Number())
                }
            },
            'create.href': {
                to: 'user',
                params: {
                    name: Type.String(),
                    email: Type.String()
                }
            }
        }
    },
    user: {
        schema: UserSchema,
        links: {
            'self.href': { to: 'user' },
            'update.href': {
                to: 'user',
                params: {
                    name: Type.Optional(Type.String()),
                    email: Type.Optional(Type.String())
                }
            },
            'delete.href': { to: 'user' }
        }
    },
    complexNesting: {
        schema: ComplexNestingSchema,
        links: {
            // Direct link
            'directLink.href': { to: 'target' },
            // Nested paths
            'level1.link.href': { to: 'target' },
            'level1.level2.link.href': { to: 'target' },
            'level1.level2.level3.link.href': { to: 'target' },
            // Array at root
            'rootArray[].link.href': { to: 'target' },
            // Nested object containing array
            'nestedWithArray.items[].link.href': { to: 'target' },
            // Array containing nested object
            'arrayWithNested[].nested.link.href': { to: 'target' },
            // Multiple arrays
            'doubleArray[].items[].link.href': { to: 'target' },
            // Mixed: array -> nested -> array
            'complexMixed[].nested.items[].link.href': { to: 'target' },
            // Optional link
            'optionalLink.href': { to: 'target' },
            // Optional container with link
            'optionalContainer.link.href': { to: 'target' },
            // Multiple links at same level
            'multipleLinks.link1.href': { to: 'target' },
            'multipleLinks.link2.href': { to: 'target' },
            'multipleLinks.link3.href': { to: 'target' }
        }
    }
});

interface TestApi extends Simplify<typeof def> { }
const api: TestApi = def;


// ============================================================================
// Error-Aware API Definition for Testing
// ============================================================================

const NotFoundSchema = Type.Object({
    message: Type.String(),
    resourceType: Type.String()
});

const ValidationErrorSchema = Type.Object({
    message: Type.String(),
    errors: Type.Array(Type.Object({
        field: Type.String(),
        error: Type.String()
    }))
});

const errorDef = defineLinks(['root', 'pet', 'notFound', 'validationError'], {
    root: {
        schema: Type.Object({
            safeLinkNoExpect: LinkSchema,
            errorProneLinkWithExpect: LinkSchema,
            concreteErrorProneLink: LinkSchema
        }),
        links: {
            // Safe link - no expect, returns resource directly
            'safeLinkNoExpect.href': { to: 'pet' },
            // Error-prone link - has expect, returns tuple
            'errorProneLinkWithExpect.href': {
                to: 'pet',
                params: { id: Type.String() },
                expect: {
                    404: 'notFound',
                    400: 'validationError'
                }
            },
            // Concrete error-prone link
            'concreteErrorProneLink.href': {
                to: 'pet',
                expect: {
                    404: 'notFound'
                }
            }
        }
    },
    pet: {
        schema: Type.Object({
            id: Type.String(),
            name: Type.String()
        }),
        links: {}
    },
    notFound: {
        schema: NotFoundSchema,
        links: {}
    },
    validationError: {
        schema: ValidationErrorSchema,
        links: {}
    }
});

interface ErrorApi extends Simplify<typeof errorDef> { }
const errorApiDef: ErrorApi = errorDef;

// ============================================================================
// Runtime Stubs
// ============================================================================

/**
 * Creates a Proxy to simulate the runtime behavior for tests.
 * The tests check for existence of properties and function calls.
 */
function createProxy(path: string = 'root'): any {
    return new Proxy(
        // The target object (function to allow it to be called)
        () => Promise.resolve(createProxy()),
        {
            get(_target, prop) {
                if (prop === 'then') return undefined; // Not a promise itself (unless called)
                if (prop === 'expected') return true; // Jest internal
                if (prop === $links) return {}; // Simulate presence of metadata
                if (prop === Symbol.iterator) {
                    // Make it iterable so it can be destructured as a tuple [res, err]
                    return function* () {
                        yield createProxy('response');
                        yield null;
                    };
                }
                if (typeof prop === 'string') {
                    // Return a proxy for any property access to simulate nested structure
                    // For the test specific case: root.allLinkTypes.href should return string
                    if (prop === 'href') return '/' + path;
                    if (prop === 'allLinkTypes') return createProxy('allLinkTypes');
                    if (prop === 'deepNesting') return createProxy('deepNesting');
                    return createProxy(prop);
                }
                return undefined;
            },
            apply(_target, _thisArg, _argArray) {
                // When called as a function, return a promise resolving to a proxy
                return Promise.resolve(createProxy());
            }
        }
    );
}

(navigate as jest.Mock).mockImplementation((navigable: any, options?: any) => {
    // Runtime validation mimicking real navigate's metadata check.
    // In this test file, valid navigables are either createProxy() instances
    // (which have $links via the proxy get trap) or real entry points from linkTo().
    if (navigable == null) {
        return Promise.reject(new Error('Link metadata not found'));
    }
    return Promise.resolve(createProxy() as any);
});

const rootObject: Root = {
    allLinkTypes: { href: '/allLinkTypes' },
    deepNesting: { href: '/deepNesting' },
    linkObject: { href: '/linkObject' },
    directUrl: '/directUrl',
}

// Helper functions for parameterized link tests
async function connectUsers() {
    const entry = linkTo({
        api,
        resource: 'users',
        url: 'http://localhost:3000/users'
    });
    return navigate(entry);
}

async function connectUser() {
    const entry = linkTo({
        api,
        resource: 'user',
        url: 'http://localhost:3000/users/123'
    });
    return navigate(entry);
}

async function connectComplexNesting() {
    const entry = linkTo({
        api,
        resource: 'complexNesting',
        url: 'http://localhost:3000/complex'
    });
    return navigate(entry);
}

describe('MergeInner with readonly arrays', () => {
    // FINDING-06: MergeInner only matched mutable Array<infer Item>, missing
    // `readonly T[]` (e.g. produced by `as const` or hand-written readonly annotations).
    // Hand-build a readonly-array source type and verify MergeInner recurses
    // into its element type and applies the overlay.
    type ItemSchema = { href: string };
    type ReadonlySource = { items: readonly ItemSchema[] };
    type Overlay = { items: { href: { phantom: true } }[] };

    it('recurses into readonly arrays and merges per-element overlays', () => {
        type Merged = MergeInner<ReadonlySource, Overlay>;
        // Access the element type via [number] indexing on the merged items array.
        type Item = Merged['items'][number];

        // Item must not collapse to never (would mean readonly array was ignored).
        type ItemNotNever = [Item] extends [never] ? true : false;
        const notNever: AssertEqual<ItemNotNever, false> = true;
        expect(notNever).toBe(true);

        // The merged item must carry both the original href (string) and the
        // overlay-introduced phantom field.
        const hasHref: AssertEqual<Item extends { href: string } ? true : false, true> = true;
        const hasPhantom: AssertEqual<Item extends { href: { phantom: true } } ? true : false, true> = true;
        expect(hasHref).toBe(true);
        expect(hasPhantom).toBe(true);
    });

    it('falls through to S & O for Date schema fields (FINDING-05)', () => {
        // FINDING-05: MergeInner used `S extends object`, which matched Date /
        // Function / RegExp and tried to recursively merge them. The tightened
        // `Record<string, unknown>` branch should leave them as `S & O`.
        type WithDate = { createdAt: Date; href: string };
        type O = { href: { phantom: true } };
        type Merged = MergeInner<WithDate, O>;

        // createdAt is still a Date -- its instance methods must remain visible.
        const dateOk: AssertEqual<Merged['createdAt'], Date> = true;
        expect(dateOk).toBe(true);
    });
});

describe('AllLinkTypes', () => {
    // Helper type for the resource
    type AllLinkTypesResource = Resource<'allLinkTypes', TestApi>;

    // We use a mock/stub populated with data to pass runtime checks
    const resource = {
        requiredLink: { href: '/req' },
        presentLink: { href: '/pres' },
        missingLink: undefined,
        requiredTemplate: { href: '/req-tmpl' },
        presentTemplate: { href: '/pres-tmpl' },
        missingTemplate: undefined,
        arrayOfLinks: [{ href: '/arr' }]
    } as unknown as AllLinkTypesResource;

    it('requiredLink has correct phantom type', () => {
        // LinkSpec<'allLinkTypes', never, TestApi, undefined>
        // The property 'requiredLink' itself is the link object, so it should be Navigable.
        // It should have an 'href' link to 'allLinkTypes'.
        type SpecificLinkSpec = LinkSpec<'allLinkTypes', never, TestApi, undefined>;
        type ExpectedNavigable = Navigable<{ href: SpecificLinkSpec }>;

        const typed: ExpectedNavigable = resource.requiredLink;
        expect(typed).toBeDefined();
    });

    it('presentLink (optional but present) has correct phantom type', () => {
        // Optional links are Type | undefined in the resource.
        // We verify that the NonNullable version is Navigable.
        type SpecificLinkSpec = LinkSpec<'allLinkTypes', never, TestApi, undefined>;
        type ExpectedNavigable = Navigable<{ href: SpecificLinkSpec }>;

        expect(resource.presentLink).toBeDefined();
        if (resource.presentLink) {
            const typed: ExpectedNavigable = resource.presentLink;
            expect(typed).toBeDefined();
        }
    });

    it('missingLink (optional) allows undefined assignment', () => {
        type PropertyType = AllLinkTypesResource['missingLink'];

        const check: PropertyType = undefined;
        expect(check).toBeUndefined();
    });

    it('requiredTemplate has correct phantom type', () => {
        type SpecificLinkSpec = LinkSpec<'allLinkTypes', never, TestApi, undefined>;
        type ExpectedNavigable = Navigable<{ href: SpecificLinkSpec }>;

        const typed: ExpectedNavigable = resource.requiredTemplate;
        expect(typed).toBeDefined();
    });

    it('presentTemplate (optional) has correct phantom type', () => {
        type SpecificLinkSpec = LinkSpec<'allLinkTypes', never, TestApi, undefined>;
        type ExpectedNavigable = Navigable<{ href: SpecificLinkSpec }>;

        expect(resource.presentTemplate).toBeDefined();
        if (resource.presentTemplate) {
            const typed: ExpectedNavigable = resource.presentTemplate;
            expect(typed).toBeDefined();
        }
    });

    it('missingTemplate (optional) allows undefined assignment', () => {
        type PropertyType = AllLinkTypesResource['missingTemplate'];
        const check: PropertyType = undefined;
        expect(check).toBeUndefined();
    });

    it('arrayOfLinks has correct phantom type interactions', () => {
        // The array itself is LinkSchema[] with overlay
        // Accessing element should give Navigable

        type SpecificLinkSpec = LinkSpec<'allLinkTypes', never, TestApi, undefined>;
        type ExpectedNavigable = Navigable<{ href: SpecificLinkSpec }>;

        const firstItem = resource.arrayOfLinks[0];
        // The item from the array should be assignable to the Navigable type
        const typed: ExpectedNavigable = firstItem;

        expect(typed).toBeDefined();
    });
});

describe('Resource', () => {

    function expectResourceRoot(root: Resource<'root', TestApi>) {
        expect(root).toBeDefined();
    }
    function expectNavigable(root: Navigable<any>) {
        expect(root).toBeDefined();
    }
    it('can be casted using \'as\' from matching schema type', () => {
        expectResourceRoot(rootObject as Resource<'root', TestApi>);
    });

    it('cannot be casted using \'as\' from unrelated object', () => {
        // @ts-expect-error this should throw a type error
        expectResourceRoot({ foo: 'bar' } as Resource<'root', TestApi>);
    });

    it('cannot be converted from valid runtime object without metadata', () => {
        // @ts-expect-error this should throw a type error
        expectResourceRoot(rootObject);
    });

    it('mirrors original properties of the schema', () => {
        const root = rootObject as Resource<'root', TestApi>;
        expect(root.allLinkTypes).toBeDefined();
        expect(root.allLinkTypes.href).toBe('/allLinkTypes');
        expect(root.deepNesting).toBeDefined();
        expect(root.deepNesting.href).toBe('/deepNesting');
    });

    it('has overlays for all navigables', () => {
        const root = rootObject as Resource<'root', TestApi>;
        expectNavigable(root.allLinkTypes);
        expectNavigable(root.deepNesting);
        expectNavigable(root.linkObject);
        expectNavigable(root);
    });

    it('does not have valid navigable for resources without links', () => {
        // Create a dummy resource without links to test regression
        const noLinkDef = defineLinks(['root'], {
            root: {
                schema: Type.Object({ foo: Type.String() }),
                links: {}
            }
        });
        type NoLinkApi = typeof noLinkDef;
        const noLinkParams = { foo: 'bar' };

        // This cast should NOT satisfy Navigable
        // We can't easily check for "not assignable" in runtime test without compilation check types
        // asking for navigable on it should be unknown at runtime (no metadata symbol)
        expect((noLinkParams as any)[$links]).toBeUndefined();

        // Type-level check:
        // @ts-expect-error
        expectNavigable(noLinkParams as Resource<'root', NoLinkApi>);
    });

    describe('with arrays', () => {

        it('preserves phantom types through array indexing', async () => {
            const users = await connectUsers();

            // Array indexing works - phantom types are preserved
            const firstUser = users.users[0];

            // Type-level verification: the Navigable phantom type is correctly preserved
            // through array indexing, so navigate() infers the correct target type.
            const johnUser: Resource<'user', TestApi> = await navigate(firstUser.userLink);
            expect(johnUser).toBeDefined();
        });

        it('array element type includes Navigable', () => {
            // The array element type correctly has the Navigable structure:
            type UsersResource = Resource<'users', TestApi>;
            type UsersArray = UsersResource['users'];
            type ArrayElement = UsersArray extends Array<infer E> ? E : never;
            type UserLinkProp = ArrayElement extends { userLink: infer UL } ? UL : never;
            type HasSymbol = UserLinkProp extends Navigable<any> ? true : false;

            // This proves the type system correctly defines and preserves the structure:
            const typeSystemCorrect: HasSymbol = true;
            expect(typeSystemCorrect).toBe(true);
        });

        it('map result preserves phantom types', () => {
            type UsersResource = Resource<'users', TestApi>;

            // Type-level: map should preserve the element type
            type MappedArray = ReturnType<UsersResource['users']['map']>;
            type MappedElement = MappedArray extends Array<infer E> ? E : never;
            type MappedLink = MappedElement extends { userLink: infer UL } ? UL : never;

            type HasSymbol = MappedLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });

        it('filter result preserves phantom types', () => {
            type UsersResource = Resource<'users', TestApi>;

            // Type-level: filter should preserve the element type
            type FilteredArray = ReturnType<UsersResource['users']['filter']>;
            type FilteredElement = FilteredArray extends Array<infer E> ? E : never;
            type FilteredLink = FilteredElement extends { userLink: infer UL } ? UL : never;

            type HasSymbol = FilteredLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });

        it('find result preserves phantom types when narrowed', () => {
            type UsersResource = Resource<'users', TestApi>;

            // Type-level: find returns element | undefined, narrowing should preserve phantom
            type FoundElement = ReturnType<UsersResource['users']['find']>;
            type NarrowedElement = NonNullable<FoundElement>;
            type FoundLink = NarrowedElement extends { userLink: infer UL } ? UL : never;

            type HasSymbol = FoundLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });

        it('slice result preserves phantom types', () => {
            type UsersResource = Resource<'users', TestApi>;

            // Type-level: slice should preserve the element type
            type SlicedArray = ReturnType<UsersResource['users']['slice']>;
            type SlicedElement = SlicedArray extends Array<infer E> ? E : never;
            type SlicedLink = SlicedElement extends { userLink: infer UL } ? UL : never;

            type HasSymbol = SlicedLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });

        it('flatMap result preserves phantom types for simple case', () => {
            type UsersResource = Resource<'users', TestApi>;

            // Type-level: flatMap that returns same type should preserve phantom
            type FlatMappedArray = ReturnType<UsersResource['users']['flatMap']>;
            type FlatMappedElement = FlatMappedArray extends Array<infer E> ? E : never;

            // FlatMap returns the element or array of elements, so we check if the base type is preserved
            type CheckElement = FlatMappedElement extends { userLink: infer UL } ? UL : never;
            type HasSymbol = CheckElement extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });
    });

    describe('with deeply nested objects', () => {

        it('preserves phantom types through single nesting level', async () => {
            const resource = await connectComplexNesting();

            // level1.link should have Navigable — navigate() requires it
            const level1Target = await navigate(resource.level1.link);
            expect(level1Target).toBeDefined();
        });

        it('preserves phantom types through double nesting', async () => {
            const resource = await connectComplexNesting();

            // level1.level2.link should have Navigable
            const level2Target = await navigate(resource.level1.level2.link);
            expect(level2Target).toBeDefined();
        });

        it('preserves phantom types through triple nesting', async () => {
            const resource = await connectComplexNesting();

            // level1.level2.level3.link should have Navigable
            const level3Target = await navigate(resource.level1.level2.level3.link);
            expect(level3Target).toBeDefined();
        });

        it('nested link types extend Navigable', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type Level1Link = ComplexResource['level1']['link'];
            type Level2Link = ComplexResource['level1']['level2']['link'];
            type Level3Link = ComplexResource['level1']['level2']['level3']['link'];

            type Check1 = Level1Link extends Navigable<any> ? true : false;
            type Check2 = Level2Link extends Navigable<any> ? true : false;
            type Check3 = Level3Link extends Navigable<any> ? true : false;

            const check1: Check1 = true;
            const check2: Check2 = true;
            const check3: Check3 = true;

            expect(check1 && check2 && check3).toBe(true);
        });
    });

    describe('with arrays at different nesting levels', () => {

        it('preserves phantom types in root-level array', async () => {
            const resource = await connectComplexNesting();

            // rootArray[0].link should have Navigable
            const firstItem = resource.rootArray[0];
            const itemTarget = await navigate(firstItem.link);
            expect(itemTarget).toBeDefined();
        });

        it('preserves phantom types in nested object containing array', async () => {
            const resource = await connectComplexNesting();

            // nestedWithArray.items[0].link should have Navigable
            const firstItem = resource.nestedWithArray.items[0];
            const itemTarget = await navigate(firstItem.link);
            expect(itemTarget).toBeDefined();
        });

        it('preserves phantom types in array containing nested object', async () => {
            const resource = await connectComplexNesting();

            // arrayWithNested[0].nested.link should have Navigable
            const firstItem = resource.arrayWithNested[0];
            const nestedTarget = await navigate(firstItem.nested.link);
            expect(nestedTarget).toBeDefined();
        });

        it('array element types include Navigable', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type RootArrayElement = ComplexResource['rootArray'][number];
            type RootArrayLink = RootArrayElement['link'];

            type HasSymbol = RootArrayLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });
    });

    describe('with multiple levels of arrays', () => {

        it('preserves phantom types through double array indexing', async () => {
            const resource = await connectComplexNesting();

            // doubleArray[0].items[0].link should have Navigable
            const firstOuter = resource.doubleArray[0];
            const firstInner = firstOuter.items[0];
            const itemTarget = await navigate(firstInner.link);
            expect(itemTarget).toBeDefined();
        });

        it('double array element types include Navigable', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type OuterArrayElement = ComplexResource['doubleArray'][number];
            type InnerArrayElement = OuterArrayElement['items'][number];
            type InnerLink = InnerArrayElement['link'];

            type HasSymbol = InnerLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });
    });

    describe('with mixed nesting patterns', () => {

        it('preserves phantom types through array-nested-array pattern', async () => {
            const resource = await connectComplexNesting();

            // complexMixed[0].nested.items[0].link should have Navigable
            const firstOuter = resource.complexMixed[0];
            const firstInner = firstOuter.nested.items[0];
            const itemTarget = await navigate(firstInner.link);
            expect(itemTarget).toBeDefined();
        });

        it('complex mixed types include Navigable', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type OuterElement = ComplexResource['complexMixed'][number];
            type NestedObject = OuterElement['nested'];
            type InnerElement = NestedObject['items'][number];
            type InnerLink = InnerElement['link'];

            type HasSymbol = InnerLink extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });
    });

    describe('with optional links and containers', () => {

        it('preserves phantom types for optional link', async () => {
            const resource = await connectComplexNesting();

            // optionalLink might be undefined, but when present has Navigable
            if (resource.optionalLink) {
                const optTarget = await navigate(resource.optionalLink);
                expect(optTarget).toBeDefined();
            }
        });

        it('preserves phantom types for link in optional container', async () => {
            const resource = await connectComplexNesting();

            // optionalContainer.link might be undefined, but when present has Navigable
            if (resource.optionalContainer) {
                const containerTarget = await navigate(resource.optionalContainer.link);
                expect(containerTarget).toBeDefined();
            }
        });

        it('optional link types are unions with undefined', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type OptionalLinkType = ComplexResource['optionalLink'];

            // Should be Navigable | undefined
            type IsOptional = undefined extends OptionalLinkType ? true : false;
            const isOptional: IsOptional = true;
            expect(isOptional).toBe(true);

            // When narrowed, should have Navigable
            type Narrowed = NonNullable<OptionalLinkType>;
            type HasSymbol = Narrowed extends Navigable<any> ? true : false;
            const hasSymbol: HasSymbol = true;
            expect(hasSymbol).toBe(true);
        });
    });

    describe('with multiple links at same level', () => {

        it('preserves phantom types for all links in same object', async () => {
            const resource = await connectComplexNesting();

            // All three links should have Navigable — navigate() requires it on each
            const target1 = await navigate(resource.multipleLinks.link1);
            const target2 = await navigate(resource.multipleLinks.link2);
            const target3 = await navigate(resource.multipleLinks.link3);

            expect(target1).toBeDefined();
            expect(target2).toBeDefined();
            expect(target3).toBeDefined();
        });

        it('all links at same level include Navigable', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type MultipleLinks = ComplexResource['multipleLinks'];
            type Link1 = MultipleLinks['link1'];
            type Link2 = MultipleLinks['link2'];
            type Link3 = MultipleLinks['link3'];

            type Check1 = Link1 extends Navigable<any> ? true : false;
            type Check2 = Link2 extends Navigable<any> ? true : false;
            type Check3 = Link3 extends Navigable<any> ? true : false;

            const check1: Check1 = true;
            const check2: Check2 = true;
            const check3: Check3 = true;

            expect(check1 && check2 && check3).toBe(true);
        });

        it('each link has correct metadata', () => {
            type ComplexResource = Resource<'complexNesting', TestApi>;
            type Link1Meta = ComplexResource['multipleLinks']['link1'][typeof $links];
            type Link2Meta = ComplexResource['multipleLinks']['link2'][typeof $links];
            type Link3Meta = ComplexResource['multipleLinks']['link3'][typeof $links];

            // All should have href property in metadata
            type Has1 = 'href' extends keyof Link1Meta ? true : false;
            type Has2 = 'href' extends keyof Link2Meta ? true : false;
            type Has3 = 'href' extends keyof Link3Meta ? true : false;

            const has1: Has1 = true;
            const has2: Has2 = true;
            const has3: Has3 = true;

            expect(has1 && has2 && has3).toBe(true);
        });
    });
});

async function connectRoot() {
    const entry = linkTo({
        api,
        resource: 'root',
        url: 'http://localhost:3000'
    });
    return navigate(entry);
}
describe('linkTo()', () => {
    describe('accepts', () => {
        it('a valid API definition and root resource', () => {
            const entry = linkTo({
                api,
                resource: 'root',
                url: 'http://localhost:3000'
            });
            expect(entry).toBeDefined();
        });
    });

    describe('rejects', () => {
        it('an invalid root resource name (type check)', () => {
            const entry = linkTo({
                api,
                // @ts-expect-error this should throw a type error
                resource: 'invalid', // should fail compile-time check
                url: 'http://localhost:3000'
            });
        });

        it('missing required options (type check)', () => {
            // @ts-expect-error this should throw a type error
            const entry = linkTo({});
        });
    });

    describe('returns', () => {
        it('a Navigable entry point', () => {
            const entry = linkTo({
                api,
                resource: 'root',
                url: 'http://localhost:3000'
            });
            expect(entry.href).toBe('http://localhost:3000');
            // Verify it handles like a navigable object without crashing
            // expect(entry[$links]).toBeUndefined(); // It's a phantom type!
            expect(entry).toBeDefined();
        });

        it('a Navigable with correct LinkSpec for root', () => {
            const entry = linkTo({
                api,
                resource: 'root',
                url: 'http://localhost:3000'
            });

            // Verify types (compile-time check)
            type ExpectedEntry = RootNavigable<'root', TestApi>;
            const match: ExpectedEntry = entry;
            expect(match).toBeDefined();
        });
    });
});







describe('Overall flow', () => {

    it('should allow to navigate to linked resources in a type-safe way', async () => {
        const root = await connectRoot();

        const allLinkTypes = await navigate(root.allLinkTypes);
        expect(allLinkTypes).toBeDefined();
        const typed1: Resource<'allLinkTypes', TestApi> = allLinkTypes;

        // navigate() works on any link object with href
        const required = await navigate(allLinkTypes.requiredLink);
        expect(required).toBeDefined();
        const typed2: Resource<'allLinkTypes', TestApi> = required;

        const deepNesting = await navigate(root.deepNesting);
        expect(deepNesting).toBeDefined();
        const typed3: Resource<'deepNesting', TestApi> = deepNesting;
    });
});

describe('Error Handling Types', () => {

    describe('Failure type', () => {
        it('is a discriminated union with kind field', () => {
            type Fail = Failure<ErrorApi, { 404: 'notFound', 400: 'validationError' }>;

            // All variants should have kind
            type HasKind = 'kind' extends keyof Fail ? true : false;
            const hasKind: HasKind = true;
            expect(hasKind).toBe(true);

            // All variants should have message
            type HasMessage = 'message' extends keyof Fail ? true : false;
            const hasMessage: HasMessage = true;
            expect(hasMessage).toBe(true);
        });

        it('narrows resource type via kind discriminant', () => {
            type Fail = Failure<ErrorApi, { 404: 'notFound', 400: 'validationError' }>;

            // When narrowed to kind === 'notFound', resource should be Resource<'notFound', ErrorApi>
            type NotFoundVariant = Extract<Fail, { kind: 'notFound' }>;
            type NotFoundResource = NotFoundVariant['resource'];
            type IsCorrectType = NotFoundResource extends Resource<'notFound', ErrorApi> ? true : false;
            const isCorrectType: IsCorrectType = true;
            expect(isCorrectType).toBe(true);

            // When narrowed to kind === 'validationError', resource should be Resource<'validationError', ErrorApi>
            type ValidationVariant = Extract<Fail, { kind: 'validationError' }>;
            type ValidationResource = ValidationVariant['resource'];
            type IsValidationType = ValidationResource extends Resource<'validationError', ErrorApi> ? true : false;
            const isValidationType: IsValidationType = true;
            expect(isValidationType).toBe(true);
        });

        it('unexpected variant has undefined resource', () => {
            type Unexpected = Extract<Failure<ErrorApi, { 404: 'notFound' }>, { kind: 'unexpected' }>;

            type HasKind = Unexpected['kind'] extends 'unexpected' ? true : false;
            const hasKind: HasKind = true;
            expect(hasKind).toBe(true);

            type ResourceIsUndefined = Unexpected['resource'] extends undefined ? true : false;
            const resourceIsUndefined: ResourceIsUndefined = true;
            expect(resourceIsUndefined).toBe(true);
        });
    });

    describe('Integration with navigate', () => {
        it('safe links work as before (no breaking changes)', async () => {
            // Simulate connecting to error-aware API
            const root = createProxy('root') as Resource<'root', ErrorApi>;

            // Navigating a safe link returns the resource directly
            const pet = await navigate(root.safeLinkNoExpect);

            // Should be assignable to Resource directly (no tuple)
            const typed: Resource<'pet', ErrorApi> = pet;
            expect(typed).toBeDefined();
        });

        it('error-prone links return tuples', async () => {
            const root = createProxy('root') as Resource<'root', ErrorApi>;
            // Navigating an error-prone link returns tuple at type level
            const result = await navigate(root.errorProneLinkWithExpect, { params: { id: '123' } });

            // Type-level verification: Should be a tuple type
            type IsTuple = typeof result extends [any, any] ? true : false;
            const isTuple: IsTuple = true;
            expect(isTuple).toBe(true);

            // Type-level verification: error side is a discriminated union with kind
            type ErrorSide = typeof result extends [any, infer E] ? NonNullable<E> : never;
            type HasKind = 'kind' extends keyof ErrorSide ? true : false;
            const hasKind: HasKind = true;
            expect(hasKind).toBe(true);

            // Runtime behavior not implemented yet (types only)
        });


        it('enforces checking error before accessing response', async () => {
            const root = createProxy('root') as Resource<'root', ErrorApi>;
            // Navigating an error-prone link returns tuple at type level
            const [response, error] = await navigate(root.errorProneLinkWithExpect, { params: { id: '123' } });

            // @ts-expect-error can't access id without checking response is not null
            let id = response.id

            if (error) {
                expect(response).toBeNull();
                return;
            }
            // since we checked error is null, compiler knows response is not null
            id = response.id;

            expect(response).toBeDefined();
            expect(response).not.toBeNull();
        });
    });

    // ========================================================================
    // Pure type-level rescues from the old `navigate.spec.ts` Section 3.
    // The original tests issued real fetches just to assign the result to a
    // typed variable. The actual claim is purely about type inference, so
    // there is no value in running them through the integration harness.
    // ========================================================================
    describe('Resource<N, A> type assignability', () => {
        // Minimal pet/petshop API surface — only enough to express the types.
        const PetshopSchema = Type.Object({
            actions: Type.Object({
                listPets: LinkSchema,
            }),
        });
        const PetSchema = Type.Object({
            id: Type.String(),
            name: Type.String(),
            species: Type.Union([Type.Literal('Dog'), Type.Literal('Cat')]),
            price: Type.Number(),
        });
        const CatalogSchema = Type.Object({
            pets: Type.Array(LinkSchema),
        });

        const petshopApi = defineLinks(['petshop', 'catalog', 'pet'], {
            petshop: {
                schema: PetshopSchema,
                links: { 'actions.listPets.href': { to: 'catalog' } },
            },
            catalog: {
                schema: CatalogSchema,
                links: { 'pets[].href': { to: 'pet' } },
            },
            pet: {
                schema: PetSchema,
                links: {},
            },
        });

        type PetshopApi = typeof petshopApi;

        it('a pet Resource is assignable to a plain domain interface', () => {
            // The original integration test (`should cast to pure domain object
            // interface`) wrapped the same claim in a real fetch + map. The
            // actual claim is type-only: a navigated `Resource<'pet', PetshopApi>`
            // can be passed to a function whose parameter is the plain `Pet`
            // interface, because the runtime shape matches the schema.
            type Pet = Static<typeof PetSchema>;

            function constructLabel(pet: Pet) {
                return `${pet.name} (${pet.species})`;
            }

            type PetResource = Resource<'pet', PetshopApi>;
            type ResourceAssignable = PetResource extends Pet ? true : false;
            const ok: ResourceAssignable = true;
            expect(ok).toBe(true);

            // Also verify the function signature accepts a Resource<'pet', ...>
            // by referencing the type — no runtime call needed.
            type FnArg = Parameters<typeof constructLabel>[0];
            type ResourceFitsFnArg = PetResource extends FnArg ? true : false;
            const fits: ResourceFitsFnArg = true;
            expect(fits).toBe(true);
        });

        it('typed array element preserves Resource<...> when assigned explicitly', () => {
            // The original integration test (`should keep type info with array
            // processing`) was a runtime fetch that did nothing more than
            // assert `firstPet.foo` was a `@ts-expect-error`. The real claim is
            // that the explicit annotation `Resource<'pet', PetshopApi>` is
            // valid (i.e. the inferred type is at least the resource), and
            // that arbitrary properties are not.
            type PetResource = Resource<'pet', PetshopApi>;

            // Type-level check: a PetResource has `name` (from the schema) but
            // not `foo`.
            type HasName = PetResource extends { name: string } ? true : false;
            const hasName: HasName = true;
            expect(hasName).toBe(true);

            type HasFoo = PetResource extends { foo: unknown } ? true : false;
            const noFoo: HasFoo = false;
            expect(noFoo).toBe(false);

            // And the inference flow: a PetResource is *not* `any`.
            const isAny: IsAny<PetResource> = false;
            expect(isAny).toBe(false);
        });
    });

});

