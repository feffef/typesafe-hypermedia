import { ApiDefinition } from './link-definition';
import { Static, TObject, TSchema } from '@sinclair/typebox';

// ============================================================================
// Fetch Factory Types
// ============================================================================

/**
 * Context information passed to your custom {@link FetchFactory} when following a link.
 *
 * Use this to customize HTTP requests based on:
 * - Which resource is being fetched (`targetResourceName`)
 * - Custom properties the **server included** on the link object (`navigable`)
 *
 * **Important:** The `navigable` object contains whatever properties the server returned.
 * There are no standard properties - your API server decides what to include. Common
 * patterns are properties like `method`, `body`, or `headers`, but these must be designed
 * into your API's hypermedia format.
 *
 * When parameterized with a specific API definition, `navigable` is typed as the union of
 * all link object shapes across all resources. When unparameterized, `navigable` stays `any`
 * for backwards compatibility.
 *
 * @template Api - Optional API definition for typed navigable
 *
 * @example
 * ```typescript
 * // Your API server returns links like: { href: "/orders", method: "POST", body: {...} }
 * // Your FetchFactory reads these server-defined properties:
 *
 * const factory: FetchFactory<MyApi> = (context) => {
 *   return async (url: string) => {
 *     // navigable is typed as the union of all link shapes in MyApi
 *     const method = context.navigable?.method || 'GET';
 *     const body = context.navigable?.body;
 *
 *     // targetResourceName is narrowed to valid resource names in MyApi
 *     const headers: HeadersInit = {
 *       'Authorization': context.targetResourceName === 'admin'
 *         ? `Bearer ${adminToken}`
 *         : `Bearer ${userToken}`
 *     };
 *
 *     return fetch(url, { method, headers, body: JSON.stringify(body) });
 *   };
 * };
 * ```
 */
export type FetchContext<Api extends ApiDefinition = ApiDefinition> =
    [ApiDefinition] extends [Api]
        ? {
            /** The target resource name (from the link definition's 'to' property) */
            targetResourceName: string;
            /** The navigable object containing the link - may have custom properties that your server included */
            navigable: any;
          }
        : {
            /** The target resource name (from the link definition's 'to' property) */
            targetResourceName: string & keyof Api;
            /** The navigable object containing the link - may have custom properties that your server included */
            navigable: AllLinkNavigables<Api>;
          };

/**
 * A factory function that creates a customized fetch function based on fetch context.
 *
 * Context is always provided — it contains information about the link being followed,
 * including the target resource name and the navigable object that holds the link.
 *
 * The factory is responsible for "baking in" any request configuration (method, headers, body, etc.)
 * into the returned fetch function. ApiClient will only pass the URL to the returned function.
 *
 * When parameterized with a specific API definition, the context's `navigable` is typed as the union
 * of all link object shapes, and `targetResourceName` is narrowed to valid resource names.
 *
 * @template Api - Optional API definition for typed context
 *
 * @example
 * ```typescript
 * const factory: FetchFactory<MyApi> = (context) => {
 *   return async (url: string) => {
 *     // navigable is typed as the union of all link shapes in MyApi
 *     const method = context.navigable?.method || 'GET';
 *     return fetch(url, { method });
 *   };
 * };
 * ```
 */
export interface FetchFactory<Api extends ApiDefinition = ApiDefinition> {
    (context: FetchContext<Api>): (url: string) => Promise<Response>;
}

/**
 * Default fetch factory used when no custom factory is provided.
 * Makes simple GET requests with global fetch.
 *
 * @internal
 */
export const defaultFetchFactory: FetchFactory = (_context) => {
    return (url: string) => fetch(url);
};

// ============================================================================
// FetchContext Type Derivation (internal)
// ============================================================================

/**
 * Resolves a dot-notation path string to the type at that location in an object type.
 *
 * Handles:
 * - Simple property access: `'name'` → `T['name']`
 * - Dot-notation nesting: `'actions.listPets'` → `T['actions']['listPets']`
 * - Array brackets: `'items[].author'` → `T['items'][number]['author']`
 *
 * @template T - The root object type to traverse
 * @template Path - Dot-notation path string
 */
export type TypeAtPath<T, Path extends string> =
    Path extends `${infer Head}.${infer Tail}`
        ? Head extends `${infer Prop}[]`
            ? Prop extends keyof T
                ? T[Prop] extends readonly (infer Item)[]
                    ? TypeAtPath<Item, Tail>
                    : never
                : never
            : Head extends keyof T
                ? TypeAtPath<NonNullable<T[Head]>, Tail>
                : never
        : Path extends `${infer Prop}[]`
            ? Prop extends keyof T
                ? T[Prop] extends readonly (infer Item)[]
                    ? Item
                    : never
                : never
            : Path extends keyof T
                ? T[Path]
                : never;

/**
 * Strips the last segment from a dot-notation path.
 *
 * `'actions.createPet.href'` → `'actions.createPet'`
 * `'link.href'` → `'link'`
 * `'href'` → `never` (no parent)
 *
 * @template P - Dot-notation path string
 */
export type ParentPath<P extends string> =
    P extends `${infer Head}.${infer Tail}`
        ? Tail extends `${string}.${string}`
            ? `${Head}.${ParentPath<Tail>}`
            : Head
        : never;

/**
 * Resolves the navigable object type for a given link path in a schema.
 *
 * For a link path like `'actions.createPet.href'`, the navigable is the **parent**
 * of the terminal property — the object at `actions.createPet` (e.g., `{ href: string, method: string }`).
 *
 * When the path has no parent (single segment like `'href'`), the navigable is the
 * schema root itself.
 *
 * @template Schema - TypeBox schema type
 * @template LinkPath - Dot-notation link path string
 */
export type LinkNavigable<Schema extends TSchema, LinkPath extends string> =
    Schema extends TObject
        ? ParentPath<LinkPath> extends never
            ? Static<Schema>
            : NonNullable<TypeAtPath<Static<Schema>, ParentPath<LinkPath>>>
        // Resource schemas are always TObject (enforced by defineLinks validation).
        // The `any` fallback is needed as a bail-out for TypeScript's type resolver —
        // using `never` here causes TS2589 (excessive type instantiation depth).
        : any;

/**
 * Unions all link navigable types across all resources and all links in an API definition.
 *
 * For each resource, for each link path, resolves the parent object type (the navigable)
 * and unions them all together. This gives the complete set of object shapes that can
 * appear as `FetchContext.navigable`.
 *
 * @template Api - The API definition type
 */
export type AllLinkNavigables<Api extends ApiDefinition> =
    [ApiDefinition] extends [Api]
        ? any
        : {
            [N in keyof Api & string]: {
                [P in keyof Api[N]['links'] & string]: LinkNavigable<Api[N]['schema'], P>
            }[keyof Api[N]['links'] & string]
        }[keyof Api & string];
