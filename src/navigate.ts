import { ApiDefinition } from './link-definition';
import { Navigable, LinkSpec, LinkedResource, ConnectOptions, RootNavigable, ResourceNameFrom } from './type-system';
import { NavigationError, ResourceOrFailure } from './error-handling';
import { ApiClient } from './api-client';
import { getOwningClient } from './runtime-metadata';
import { Static, TObject } from '@sinclair/typebox';

// ============================================================================
// linkTo — API Entry Point
// ============================================================================

/**
 * Creates a typed link to a hypermedia API root.
 *
 * This is the starting point for all navigation - it creates an unfetched link to the API root.
 * Call `navigate()` on the returned object to fetch the root resource and begin navigating.
 *
 * @param options - Configuration for connecting to the API
 * @param options.api - API definition created with `defineLinks`
 * @param options.resource - Name of the root resource type
 * @param options.url - Base URL of the API
 * @param options.fetchFactory - Optional custom fetch factory for auth, custom methods, etc.
 * @param options.errorVerbosity - Optional error detail level: `'verbose'` (default) for full debugging info, `'safe'` to strip URLs and internal identifiers from errors (use in BFF/gateway contexts).
 *
 * @returns An unfetched navigable link to the root resource
 *
 * @example
 * ```typescript
 * const api = defineLinks(['shop', 'product'], {
 *   shop: { schema: ShopSchema, links: { products: { to: 'product' } } },
 *   product: { schema: ProductSchema, links: {} }
 * });
 *
 * const shopLink = linkTo({
 *   api,
 *   resource: 'shop',
 *   url: 'https://api.example.com'
 * });
 *
 * const shop = await navigate(shopLink);
 * const products = await navigate(shop, { link: 'products' });
 * ```
 */
export function linkTo<N extends ResourceNameFrom<A>, A extends ApiDefinition>(
    options: ConnectOptions<A, N>
): RootNavigable<N, A> {
    const client = new ApiClient(options.api, options.fetchFactory, options.errorVerbosity);
    return client.createEntryPoint(options.url, options.resource);
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Detects whether T is a union type (two or more members).
 *
 * Uses distributive conditional types: when T is a union like 'a' | 'b',
 * the outer `T extends unknown` distributes — each member checks whether
 * the full union [U] extends just that member [T]. For a single member
 * they're equal (false); for a union they differ (true).
 */
type IsUnion<T, U = T> = T extends unknown
    ? [U] extends [T] ? false : true
    : never;

/**
 * Guard type that resolves to `unknown` when L has exactly one string key,
 * and `never` when L has multiple keys (making the parameter unsatisfiable).
 *
 * Used in single-link overloads: `navigable: Navigable<L> & SingleKeyGuard<L>`
 * so that the overload only matches navigables with exactly one link.
 */
type SingleKeyGuard<L> = IsUnion<keyof L & string> extends false ? unknown : never;

/**
 * Shorthand for the single link's LinkSpec when L has exactly one key.
 * When L has multiple keys this is a union — but it's only used in overloads
 * guarded by SingleKeyGuard, so it's always a single spec in practice.
 */
type TheLink<L extends Record<string, LinkSpec>> = L[keyof L & string];

/**
 * Extracts the params requirement for a link.
 *
 * When a link has no parameters (Params is never or undefined), the caller
 * does not need to supply params. When parameters exist, the caller must
 * provide them as a `params` property.
 */
type ConditionalParams<Spec extends LinkSpec> =
    [Spec['Params']] extends [never] | [undefined]
    ? { params?: never }
    : { params: Static<Spec['Params']> };

/**
 * Filters a link record to only safe links (no error map).
 */
type SafeLinks<L extends Record<string, LinkSpec>> = {
    [K in keyof L as L[K]['Error'] extends undefined ? K : never]: L[K]
};

/**
 * Filters a link record to only prone links (with error map).
 */
type ProneLinks<L extends Record<string, LinkSpec>> = {
    [K in keyof L as L[K]['Error'] extends undefined ? never : K]: L[K]
};

// ============================================================================
// navigate — Unified Navigation Function
// ============================================================================

/**
 * Navigates to a resource by following a link.
 *
 * Supports two modes:
 * 1. **Single-link mode** (no `link` option): when the navigable has exactly
 *    one link defined, it is resolved automatically — no need to specify which.
 * 2. **Named link mode** (`link` option): resolves a named link property on
 *    the navigable. Required when the navigable has multiple links.
 *
 * The return type depends on whether the link has `expect` defined:
 * - Safe links (no `expect`): Returns the resource directly
 * - Prone links (with `expect`): Returns `[resource, null] | [null, error]`
 *
 * @example
 * ```typescript
 * // Single-link mode — navigable has exactly one link (e.g., a link object with href)
 * const shop = await navigate(shopLink);
 *
 * // Named link mode — navigable has multiple links
 * const products = await navigate(shop, { link: 'listProducts' });
 *
 * // With URI template parameters
 * const product = await navigate(shop, { link: 'getProduct', params: { id: '123' } });
 * ```
 */

// --- Single-link overloads (no `link` option) ---
// Match when the navigable has exactly one link defined (guarded by SingleKeyGuard).

// Overload 1: Single safe concrete link
export async function navigate<
    L extends Record<string, LinkSpec<any, never, any, undefined>>
>(
    navigable: Navigable<L> & SingleKeyGuard<L>
): Promise<LinkedResource<TheLink<L>>>;

// Overload 2: Single safe templated link
export async function navigate<
    L extends Record<string, LinkSpec<any, TObject, any, undefined>>
>(
    navigable: Navigable<L> & SingleKeyGuard<L>,
    options: { params: Static<TheLink<L>['Params']> }
): Promise<LinkedResource<TheLink<L>>>;

// Overload 3: Single prone concrete link
export async function navigate<
    L extends Record<string, LinkSpec<any, never, any, Record<number, string>>>
>(
    navigable: Navigable<L> & SingleKeyGuard<L>
): Promise<ResourceOrFailure<TheLink<L>>>;

// Overload 4: Single prone templated link
export async function navigate<
    L extends Record<string, LinkSpec<any, TObject, any, Record<number, string>>>
>(
    navigable: Navigable<L> & SingleKeyGuard<L>,
    options: { params: Static<TheLink<L>['Params']> }
): Promise<ResourceOrFailure<TheLink<L>>>;

// --- Named link overloads ---

// Overload 5: Safe named link with conditional params
export async function navigate<
    L extends Record<string, LinkSpec>,
    K extends keyof SafeLinks<L> & string
>(
    navigable: Navigable<L>,
    options: { link: K } & ConditionalParams<L[K]>
): Promise<LinkedResource<L[K]>>;

// Overload 6: Prone named link with conditional params
export async function navigate<
    L extends Record<string, LinkSpec>,
    K extends keyof ProneLinks<L> & string
>(
    navigable: Navigable<L>,
    options: { link: K } & ConditionalParams<L[K]>
): Promise<ResourceOrFailure<L[K]>>;

// --- Implementation signature ---

export async function navigate(
    navigable: Navigable<any>,
    options?: { link?: string; params?: any }
): Promise<any> {
    const client = getOwningClient(navigable);
    if (!client) {
        throw new NavigationError('Link metadata not found. Object was not created by typesafe-hypermedia.');
    }

    return client.resolve(navigable, options?.link, options?.params);
}

// ============================================================================
// navigateAll — Parallel Navigation
// ============================================================================

/**
 * Fetches multiple resources in parallel by following their single link.
 *
 * Each navigable must have exactly one link, and that link must be safe
 * (no `expect`) and concrete (no URI template parameters).
 *
 * @param links - Array of single-link navigable objects
 * @returns Promise resolving to array of fetched resources (same order as input)
 *
 * @example
 * ```typescript
 * const products = await navigateAll(catalog.productLinks);
 * ```
 */
export async function navigateAll<
    L extends Record<string, LinkSpec<any, never, any, undefined>>
>(
    links: (Navigable<L> & SingleKeyGuard<L>)[]
): Promise<LinkedResource<TheLink<L>>[]> {
    return Promise.all(links.map(l => navigate(l)));
}
