import { ApiDefinition, LinkDefinition, ErrorResourceMap } from './link-definition';

import { FetchFactory } from './fetch-customization';
import { Static, TObject, TProperties } from '@sinclair/typebox';

// ============================================================================
// Public API Types
// ============================================================================

/**
 * Resolves a complex inferred type into a plain object signature.
 *
 * TypeScript cannot use `typeof x` directly in an `interface extends` clause.
 * `Simplify` bridges the gap — wrap the operand and the interface compiles.
 *
 * The recommended 3-line pattern for API definitions:
 *
 * ```ts
 * const apiDef = defineLinks([...], { ... });
 * export interface MyApi extends Simplify<typeof apiDef> {}
 * export const myApi: MyApi = apiDef;
 * ```
 *
 * The `: MyApi` annotation on the exported const is essential — it anchors
 * the value to the named interface so IDE tooltips show `MyApi` instead of
 * expanding the full structural type.
 */
export type Simplify<T> = { [K in keyof T]: T[K] };

/**
 * Type-level metadata describing a link's target, parameters, and expected errors.
 *
 * You'll see this type in generic constraints and type parameters, but you typically
 * don't construct LinkSpec values directly - they're created automatically by the type
 * system based on your API definition.
 *
 * Encodes everything TypeScript needs to know about a link:
 * - `Target`: Which resource this link points to
 * - `Params`: URI template parameters (if any)
 * - `Api`: The complete API definition (for looking up the target resource)
 * - `Error`: Expected error responses (if defined with `expect`)
 *
 * @template Target - Name of the target resource
 * @template Params - TypeBox schema for URI template parameters
 * @template Api - The API definition
 * @template Error - Map of HTTP status codes to error resource names
 */
export interface LinkSpec<
    Target extends string = string,
    // `any` defaults are intentional: they let callers write bare `LinkSpec` in
    // constraints (e.g. `Record<string, LinkSpec>`) and value-position assertions
    // (e.g. `Navigable<{ href: LinkSpec }>`). A tighter default like `TObject`
    // would make `LinkSpec<string, TObject, ...>` non-assignable to specific
    // instances like `LinkSpec<'x', never, MyApi, undefined>` because
    // `TObject` is not assignable to `never`. See roadmap §10 "Tighten `LinkSpec`
    // Generic Defaults" for the planned proper fix.
    Params extends TObject = any,
    Api extends ApiDefinition = any,
    Error extends ErrorResourceMap | undefined = any
> {
    Target: Target;
    Params: Params;
    Api: Api;
    Error: Error;
}

/**
 * Symbol used as the key for storing phantom link metadata.
 *
 * Required because: Symbols don't clash with regular properties and won't appear
 * in JSON serialization or iteration. This allows us to attach compile-time metadata
 * without affecting runtime behavior.
 */
export const $links = Symbol('links');

/**
 * An object with one or more link properties (string URIs or URI templates).
 *
 * Navigables are objects you navigate from by following their link properties:
 * - Link objects: `{ href: "/api/pets" }`
 * - Resources with links: `{ id: 1, self: "/api/pets/1", owner: "/api/users/2" }`
 * - API entry points: `{ href: "/api" }`
 *
 * Developers can model links however they choose - what matters is that link properties
 * are strings containing URIs or URI templates that can be resolved to fetch resources.
 *
 * Usage:
 * - `navigate(linkObject)` - Single-link navigables auto-resolve their only link
 * - `navigate(resource, { link: 'name' })` - Resolves a named link property
 *
 * @template L - Record mapping link property names to their LinkSpec metadata
 *
 * @example
 * ```typescript
 * const rootLink = linkTo({ api: myApiDef, resource: 'root', url: 'http://api.example.com' });
 * const root = await navigate(rootLink);                  // Auto-resolve the single 'href' link
 * const pets = await navigate(root, { link: 'listPets' }); // Resolve a named link
 * ```
 *
 * Note: This is a phantom type. The `[$links]` symbol only exists at compile-time for
 * type safety. At runtime, Navigables are plain objects with string properties.
 */
export interface Navigable<L extends Record<string, LinkSpec>> {
    [$links]: L;
}

/**
 * Configuration options for connecting to a hypermedia API.
 *
 * Passed to `linkTo()` to initialize the client and create the root entry point.
 *
 * @example
 * ```typescript
 * const api = defineLinks(['shop', 'product'], { ... });
 *
 * const shopLink = linkTo({
 *   api,                    // API definition from defineLinks
 *   resource: 'shop',       // Which resource is the root
 *   url: 'https://api.example.com',  // Base URL of the API
 *   fetchFactory: myCustomFactory    // Optional: for auth, custom methods, etc.
 * });
 * ```
 */
/**
 * Controls how much detail the library includes in error messages.
 *
 * - `'verbose'` (default): includes full URL, resource names, schema paths — best for client-side debugging.
 * - `'safe'`: omits URLs and internal identifiers — use in BFF/API gateway contexts.
 *
 * Single source of truth for the verbosity union — every internal helper that
 * branches on verbosity (`api-client`, `error-handling`, `uri-templates`)
 * imports this alias rather than restating the literal union.
 */
export type Verbosity = 'verbose' | 'safe';

export interface ConnectOptions<
    ApiDef extends ApiDefinition,
    RootResource extends ResourceNameFrom<ApiDef> = ResourceNameFrom<ApiDef>
> {
    /** API definition created with `defineLinks()` - describes all resources and their links */
    api: ApiDef;

    /** Name of the root resource type (must be one of the resources defined in the API) */
    resource: RootResource;

    /** Base URL of the API (e.g., 'https://api.example.com') */
    url: string;

    /**
     * Optional custom fetch factory for authentication, custom HTTP methods, headers, etc.
     * If not provided, uses the default factory (GET requests with global fetch).
     *
     * Parameterize with your API definition for typed `navigable` and `targetResourceName`
     * in the context: `const factory: FetchFactory<MyApi> = (ctx) => { ... }`
     */
    fetchFactory?: FetchFactory<ApiDef>;

    /**
     * Controls how much detail is included in error messages. See {@link Verbosity}.
     */
    errorVerbosity?: Verbosity;
}

// ============================================================================
// Internal Type Helpers
// ============================================================================

/**
 * Extracts all resource names from an API definition.
 */
export type ResourceNameFrom<A extends ApiDefinition> = keyof A & string;

/**
 * Converts a union type to an intersection type.
 * Example: (A | B | C) => (A & B & C)
 *
 * Required because: Each link creates its own overlay structure. We need to merge
 * all these overlays into a single type that can be deeply merged with the schema.
 * Intersection types preserve all properties from all overlays.
 *
 * How it works: Uses conditional type distributive property with contravariant
 * position inference to convert union to intersection.
 */
type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

/**
 * Transforms a user-facing LinkDefinition into internal LinkSpec metadata.
 * 
 * Required because: LinkDefinition is the configuration format, while LinkSpec
 * is the normalized format used by the type system for navigation.
 * 
 * What it does:
 * 1. Extracts target resource name from 'to'
 * 2. Normalizes parameters schema (using 'never' for simple links)
 * 3. Extracts error map (if 'expect' is present)
 */
type LinkIn<Api extends ApiDefinition, Def extends LinkDefinition> = LinkSpec<
    Def['to'] & string,
    // Re-wrap the bare TProperties bag as TObject so Static<Params> resolves correctly.
    // DO NOT simplify to TProperties — the TObject wrapper is required by Static<>.
    Def['params'] extends TProperties ? TObject<Def['params']> : never,
    Api,
    Def extends { expect: infer E } ? E & ErrorResourceMap : undefined
>;

/**
 * Creates a link overlay: phantom metadata for a link property.
 *
 * The schema already declares the property as a string, so the overlay
 * only needs to attach the phantom {@link LinkSpec} via {@link Navigable}.
 *
 * What it does: Given a property name like 'href', creates:
 * Navigable<{ href: LinkSpec }>
 */
type LinkOverlay<Prop extends string, Info extends LinkSpec> =
    Navigable<{ [K in Prop]: Info }>;

/**
 * Recursively builds nested object structure from dot-notation path.
 * Handles both 'prop.subprop' and 'prop[]' array syntax.
 *
 * Required because: Link paths like 'users[].profile.avatar.href' need to be
 * transformed into nested types:
 * { users?: { profile?: { avatar?: Value } }[] }
 *
 * What it does: Recursively processes each segment:
 * - 'prop.rest' => { prop?: BuildPath<rest, Value> }
 * - 'prop[]' => { prop?: Value[] }
 * - 'prop' => { prop?: Value }
 * All properties are optional (?) to preserve schema optionality when intersected.
 */
type BuildPath<Path extends string, Value> =
    Path extends `${infer First}.${infer Rest}`
    ? First extends `${infer Prop}[]`
    ? { [K in Prop]?: BuildPath<Rest, Value>[] }
    : { [K in First]?: BuildPath<Rest, Value> }
    : Path extends `${infer Prop}[]`
    ? { [K in Prop]?: Value[] }
    : { [K in Path]?: Value };

/**
 * Creates the complete overlay structure for a single link path.
 *
 * Required because: Combines BuildPath and LinkOverlay to create the full
 * nested structure for a link. For example:
 * 'users[].profile.href' => { users?: { profile?: LinkOverlay<'href'> }[] }
 *
 * What it does: Recursively processes the path left-to-right:
 * - Splits on first dot to get Head and Tail
 * - If Tail has more dots, recursively process it
 * - If Tail is final segment, create LinkOverlay for it
 * - Wraps result in BuildPath to create nested structure
 */
type PathOverlay<Path extends string, Info extends LinkSpec> =
    Path extends `${infer Head}.${infer Tail}`
    ? Tail extends `${string}.${string}`
    ? BuildPath<Head, PathOverlay<Tail, Info>>  // More segments remain
    : BuildPath<Head, LinkOverlay<Tail, Info>>  // Tail is final property
    : LinkOverlay<Path, Info>;  // No dots, Path is the property

/**
 * Merges all link overlays for a resource into a single intersection type.
 *
 * Required because: Each link path creates its own overlay. We need to combine
 * all overlays into one type that can be merged with the schema. Uses intersection
 * to preserve all properties from all links.
 *
 * What it does:
 * 1. For each link path 'P', gets its definition 'D' from the API
 * 2. Maps 'D' to 'LinkSpec' metadata using LinkIn
 * 3. Creates 'PathOverlay' for each link and merges via 'UnionToIntersection'
 *
 * Why N instead of Links parameter: Passing the resource name directly is simpler
 * than extracting links at the call site. The type can access Api[N]['links']
 * internally, resulting in cleaner usage: MergedOverlay<A, N> instead of
 * MergedOverlay<A, A[N]['links']>.
 */
type MergedOverlay<Api extends ApiDefinition, N extends ResourceNameFrom<Api>> =
    UnionToIntersection<{
        [P in keyof Api[N]['links']]: PathOverlay<P & string, LinkIn<Api, Api[N]['links'][P]>>
    }[keyof Api[N]['links']]>;

/**
 * Recursively merges schema with overlay, preserving phantom types.
 *
 * Required because: We need to deeply merge two object types:
 * - Schema: the runtime JSON structure (from TypeBox)
 * - Overlay: the phantom link metadata (from our link paths)
 *
 * Why two types (Merge + MergeInner):
 * - Merge wraps overlay in NonNullable to handle optional overlays
 * - MergeInner does the actual recursive merge
 *
 * Critical detail: Symbol properties from O (like [$links]) must survive
 * the merge. We use `Pick<O, Exclude<keyof O, keyof S>>` to add only
 * O's non-overlapping keys (the phantom symbol), avoiding the duplication
 * that a blanket `& O` would cause in IDE tooltips.
 */
type Merge<S, O> = MergeInner<S, NonNullable<O>>;

/**
 * Inner merge logic that handles arrays, objects, and primitives.
 *
 * What it does:
 * - Arrays: Recursively merge element types. Uses `O[number]` (not `infer`)
 *   to extract overlay elements because TypeScript's `infer` from an
 *   intersection of arrays (e.g. `A[] & B[]`) only captures the last
 *   constituent — `O[number]` correctly yields `A & B`.
 * - Objects: Map over S's keys, recursively merge matching O keys.
 *   If O carries phantom link metadata (extends Navigable), re-attach
 *   it as `& Navigable<L>` so IDE tooltips show a clean domain type
 *   instead of utility-type noise like `Pick<…, typeof $links>`.
 *   Non-Navigable overlays (intermediate path segments) add `& unknown`
 *   which TypeScript simplifies away.
 * - Primitives: Simple intersection S & O
 */
/**
 * @internal Exported solely for type-level test access in `test/unit/type-system.test.ts`.
 * Not intended for public consumption — consume `Resource<N, A>` instead.
 */
export type MergeInner<S, O> =
    S extends readonly (infer SItem)[]
    ? O extends readonly any[]
    ? Merge<SItem, O[number]>[]
    : S & O
    : S extends Record<string, unknown>
    ? { [K in keyof S]: K extends keyof O ? Merge<S[K], O[K]> : S[K] } & (O extends Navigable<infer L> ? Navigable<L> : unknown)
    : S & O;

// ============================================================================
// Public API
// ============================================================================

/**
 * A fetched resource with full type safety for properties and links.
 *
 * This is what you get when you `navigate()` to a link. It combines:
 * - All properties from the resource's schema (type-safe access)
 * - Navigable link properties that you can follow with `navigate()`
 *
 * You'll see this type in:
 * - Return types from `navigate()` and `navigateAll()`
 * - Type parameters and generic constraints
 * - Error handler signatures
 *
 * @template N - The resource name from the API definition
 * @template A - The API definition
 *
 * @example
 * ```typescript
 * const api = defineLinks(['shop', 'product'], {
 *   shop: {
 *     schema: Type.Object({
 *       name: Type.String(),
 *       productsUrl: Type.String()  // Named link property
 *     }),
 *     links: { 'productsUrl': { to: 'product' } }
 *   },
 *   // ... other resources
 * });
 *
 * // shop is Resource<'shop', typeof api>
 * const shop = await navigate(rootLink);
 *
 * // Access schema properties
 * console.log(shop.name);
 *
 * // Follow link properties with navigate()
 * const products = await navigate(shop, { link: 'productsUrl' });
 * ```
 */
export type Resource<N extends ResourceNameFrom<A>, A extends ApiDefinition> =
    Merge<Static<A[N]['schema']>, MergedOverlay<A, N>>;

/**
 * Convenience helper to extract the direct success resource for a link.
 */
export type LinkedResource<L extends LinkSpec> = Resource<L['Target'], L['Api']>;

/**
 * An unfetched link to the API root resource, returned by `linkTo()`.
 *
 * This represents the entry point to your hypermedia API. It's a navigable object with an `href`
 * property that hasn't been fetched yet - call `navigate()` on it to fetch the root resource and
 * begin navigation.
 *
 * The type combines:
 * - A runtime property: `{ href: string }` - the root URL
 * - Phantom metadata: `Navigable<...>` - type-level information about the root resource
 *
 * @template N - Name of the root resource type
 * @template A - The API definition
 *
 * @example
 * ```typescript
 * const api = defineLinks(['shop', 'product'], { ... });
 *
 * // linkTo returns RootNavigable - an unfetched link
 * const shopLink = linkTo({
 *   api,
 *   resource: 'shop',
 *   url: 'https://api.example.com'
 * });
 *
 * // Call navigate() to fetch the root resource
 * const shop = await navigate(shopLink);
 *
 * // Now you can navigate through the API
 * const products = await navigate(shop, { link: 'listProducts' });
 * ```
 */
export type RootNavigable<N extends ResourceNameFrom<A>, A extends ApiDefinition> =
    { href: string } & Navigable<{ href: LinkSpec<N, never, A, undefined> }>;
