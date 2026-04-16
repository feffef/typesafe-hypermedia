import type { ApiClient } from './api-client';
import { LinkDefinition, ResourceDefinition } from './link-definition';

// ============================================================================
// Module-level state
//
// Three module-level WeakMaps hold the runtime metadata the framework needs
// to operate on plain JSON objects without modifying them. This is the
// runtime counterpart to type-system.ts (which holds compile-time phantom-type
// metadata via symbols). WeakMap keyed by object identity is JavaScript's
// native mechanism for keeping hidden out-of-band state about objects you
// don't own — exactly the canonical use case TC39/MDN documents for WeakMap.
// ============================================================================

/**
 * Which ApiClient produced a given navigable — the entry point for navigate()
 * to dispatch to the right client. Last-writer-wins on re-registration.
 */
const apiClientByNavigable = new WeakMap<object, ApiClient<any>>();

/**
 * The followable links the framework knows about on each navigable, by name.
 */
const linksByNavigable = new WeakMap<object, Map<string, KnownLink>>();

/**
 * Compiled path-accessor cache, keyed by the link-definitions object reference
 * on a ResourceDefinition. Shared across all clients of the same API definition.
 *
 * Caveat: this requires referentially stable link-definitions objects. API
 * definitions declared once at module scope (the normal case) benefit from the
 * cache; definitions constructed inline per call (e.g. `{ ...base, ...extra }`)
 * produce a new object reference each time and thrash the cache silently.
 */
const accessorCache = new WeakMap<Record<string, LinkDefinition>, CompiledAccessor[]>();

// ============================================================================
// Public type
// ============================================================================

/**
 * Everything the framework needs to follow one link, derived from the JSON at
 * fetch time. `name` makes every KnownLink self-describing: a consumer that
 * holds one knows which link it is without consulting the surrounding map.
 */
export interface KnownLink {
    /** The property key on its navigable (e.g. 'next', 'self', 'href'). */
    name: string;
    /**
     * The link definition from the API definition — carries the target
     * resource name, the optional URI-template params schema, and any
     * `expect`ed error map. Needed by ApiClient.resolve() to expand
     * templates, validate params, fetch, and pick the right error path.
     */
    linkDef: LinkDefinition;
    /** Base URL for resolving absolute paths returned by the server. */
    baseURL: string;
    /** The extracted href or URI template from the link. */
    href: string;
}

// ============================================================================
// Public functions
// ============================================================================

/**
 * Returns the ApiClient that produced a navigable, or undefined for unknown
 * objects. Used by navigate() to find the right client to dispatch to.
 *
 * Accepts `unknown` rather than `object` so that callers (including navigate())
 * can pass null/undefined without crashing into WeakMap's native TypeError.
 * The guard returns undefined for any value that is not a non-null object —
 * null, undefined, primitives, and functions are all rejected early. Functions
 * are technically legal WeakMap keys but are never registered as navigables,
 * so the early return is equivalent to a WeakMap miss. The existing
 * `if (!client)` check in navigate() handles all undefined returns
 * transparently.
 */
export function getOwningClient(navigable: unknown): ApiClient<any> | undefined {
    if (navigable === null || typeof navigable !== 'object') {
        return undefined;
    }
    return apiClientByNavigable.get(navigable);
}

/**
 * Extract every link from a fetched resource, file the resulting KnownLinks
 * in linksByNavigable, and claim ownership of each navigable in
 * apiClientByNavigable.
 *
 * When the resource defines links but none were extracted (e.g. all optional
 * link properties absent from the server response), we still register the
 * resource in both WeakMaps so that `getOwningClient` recognises it and
 * `recallLink` can produce a user-facing "link not available" error instead
 * of the misleading "not created by typesafe-hypermedia".
 */
export function rememberLinks(
    resource: any,
    def: ResourceDefinition,
    baseURL: string,
    client: ApiClient<any>
): void {
    if (!def.links) return;

    const hasDefinedLinks = Object.keys(def.links).length > 0;
    const extracted = extractLinks(resource, def.links, baseURL);
    for (const { navigable, link } of extracted) {
        putLink(navigable, link);
        apiClientByNavigable.set(navigable, client);
    }
    // Claim ownership of the top-level resource when it defines links, even
    // if none were extracted. Initialise an empty link map (via putLink guard)
    // so recallLink finds it and produces a specific error.
    if (hasDefinedLinks && typeof resource === 'object' && resource !== null) {
        apiClientByNavigable.set(resource, client);
        if (!linksByNavigable.has(resource)) {
            linksByNavigable.set(resource, new Map());
        }
    }
}

/**
 * Store the single-link KnownLink for a root entry point and claim ownership.
 */
export function rememberEntryPoint(
    client: ApiClient<any>,
    navigable: object,
    linkDef: LinkDefinition,
    href: string
): void {
    putLink(navigable, { name: 'href', linkDef, baseURL: '', href });
    apiClientByNavigable.set(navigable, client);
}

/**
 * Look up a KnownLink on a navigable.
 *
 * - **No link map**: navigate() always calls `getOwningClient()` first and
 *   throws a user-facing error if the object is unknown, so by the time we
 *   reach `recallLink` the navigable should always have an entry in
 *   `linksByNavigable`. If it doesn't, the two WeakMaps are out of sync —
 *   a library bug, since `rememberLinks` / `rememberEntryPoint` write to
 *   both atomically.
 * - **Named link miss**: can happen legitimately when a link property is
 *   optional in the schema and the server didn't include it. With link
 *   objects the navigable itself is `undefined` (caught by `navigate()`'s
 *   `getOwningClient` guard at the type level), but with plain string link
 *   properties the navigable exists — only the individual link entry is
 *   absent. Also reachable via type-system bypass (`as any`).
 * - **No links at all** (size 0): all defined link properties were optional
 *   and the server omitted every one. `rememberLinks` still registers the
 *   resource so we reach here rather than the misleading "not created by
 *   typesafe-hypermedia" error in `navigate()`.
 * - **Multi-link auto-resolve**: navigate()'s single-link overload is gated
 *   by `SingleKeyGuard<L>`, so calling it on a multi-link navigable is a
 *   TypeScript error. Same reasoning — types were bypassed or the library
 *   produced inconsistent metadata.
 */
export function recallLink(navigable: object, name?: string): KnownLink {
    const links = linksByNavigable.get(navigable);
    if (!links) {
        throw new Error(
            'Internal library bug in recallLink: navigable has no link map. ' +
            'navigate() should have caught this upstream via getOwningClient(); ' +
            'reaching this branch means apiClientByNavigable and linksByNavigable ' +
            'are out of sync.'
        );
    }

    if (name !== undefined) {
        const link = links.get(name);
        if (!link) {
            const available = Array.from(links.keys());
            throw new Error(
                `Link "${name}" is not available on this resource ` +
                `(available: ${available.join(', ')}). ` +
                `If this is an optional link, check that the property exists before navigating.`
            );
        }
        return link;
    }

    if (links.size === 1) {
        return links.values().next().value!;
    }

    // size === 0: resource defines links but the server didn't include any.
    if (links.size === 0) {
        throw new Error(
            'No links are available on this resource. ' +
            'If this resource defines optional links, the server did not include any of them.'
        );
    }

    // size > 1: TypeScript's single-link auto-resolve should have prevented this.
    const available = Array.from(links.keys());
    throw new Error(
        `Internal library bug in recallLink: called without a link name on a navigable with ` +
        `${available.length} links (${available.join(', ')}). TypeScript's single-link ` +
        `auto-resolve only matches navigables with exactly one link — likely a type-system ` +
        `bypass (e.g. 'as any') or a library bug.`
    );
}

// ============================================================================
// File-private helpers
// ============================================================================

/**
 * Atomically creates-or-updates a single link entry on a navigable.
 * If no entry exists yet for the navigable, creates it first.
 */
function putLink(navigable: object, link: KnownLink): void {
    let links = linksByNavigable.get(navigable);
    if (!links) {
        links = new Map();
        linksByNavigable.set(navigable, links);
    }
    links.set(link.name, link);
}

/**
 * Scans a fetched resource for links using compiled (and cached) path
 * accessors, then assembles each structural triple into a KnownLink with
 * baseURL and the resolved linkDef.
 */
function extractLinks(
    resource: Record<string, unknown>,
    linkDefs: Record<string, LinkDefinition>,
    baseURL: string
): Array<{ navigable: object; link: KnownLink }> {
    let accessors = accessorCache.get(linkDefs);
    if (accessors === undefined) {
        accessors = compileAccessors(linkDefs);
        accessorCache.set(linkDefs, accessors);
    }

    const out: Array<{ navigable: object; link: KnownLink }> = [];
    for (const { extract, linkDef } of accessors) {
        for (const { navigable, key, href } of extract(resource)) {
            out.push({ navigable, link: { name: key, linkDef, baseURL, href } });
        }
    }
    return out;
}

interface CompiledAccessor {
    extract: (resource: Record<string, unknown>) => Array<{ navigable: object; key: string; href: string }>;
    linkDef: LinkDefinition;
}

/**
 * Splits one-time compilation work from repeated extraction work.
 * Turns each path string into a reusable extraction function that can be
 * called on every resource instance of this type.
 */
function compileAccessors(linkDefs: Record<string, LinkDefinition>): CompiledAccessor[] {
    return Object.entries(linkDefs).map(([path, linkDef]) => ({
        extract: compilePath(path.split('.')),
        linkDef
    }));
}

/**
 * Creates a closure that captures path segments but can be called repeatedly.
 * Parses the path once but extracts from many resource instances efficiently.
 *
 * @internal Exported only for unit testing the internal invariant guard.
 */
export function compilePath(
    segments: string[]
): (obj: Record<string, unknown>) => Array<{ navigable: object; key: string; href: string }> {
    if (segments.length === 0) {
        throw new Error(
            'compilePath received an empty segments array. This is an internal invariant violation: ' +
            'callers (compileAccessors via path.split(".")) always produce at least one segment.'
        );
    }
    return (obj: Record<string, unknown>) => {
        const results: Array<{ navigable: object; key: string; href: string }> = [];
        traverse([obj], segments, 0, results);
        return results;
    };
}

/**
 * Recursive traversal handles the complexity of nested objects and arrays.
 *
 * Key challenges this solves:
 * - Array notation (items[]) requires iterating and collecting multiple results
 * - Nested paths (items[].author.href) require recursion
 * - Optional properties mean we can't assume anything exists
 * - Terminal segments need special handling (extract string, not traverse further)
 *
 * The objects array + index approach allows elegant array handling by
 * transforming array traversal into multiple parallel traversals.
 *
 * @internal Exported only for unit testing the internal invariant guards.
 */
export function traverse(
    objects: Record<string, unknown>[],
    segments: string[],
    index: number,
    results: Array<{ navigable: object; key: string; href: string }>
): void {
    if (index >= segments.length) {
        // Internal invariant: traverse is only ever entered from compilePath
        // (which guards against empty segments) or from its own recursive call
        // (which only happens when !isTerminal, so the next index never
        // exceeds segments.length - 1). If this fires, something upstream
        // bypassed compilePath; fail loudly rather than silently no-op.
        throw new Error(
            `traverse invariant violation: index ${index} >= segments.length ${segments.length}. ` +
            'Caller bypassed compilePath validation.'
        );
    }

    const segment = segments[index];
    const isArray = segment.endsWith('[]');
    const prop = isArray ? segment.slice(0, -2) : segment;
    const isTerminal = index === segments.length - 1;

    if (isTerminal && isArray) {
        throw new Error(
            `Invalid path: Array segment '${segment}' cannot be terminal. ` +
            `Specify the property name to extract (e.g., '${prop}[].href').`
        );
    }

    for (const obj of objects) {
        if (obj == null || typeof obj !== 'object') continue;

        const value = obj[prop];
        if (value == null) continue;

        if (isTerminal) {
            // Extract the string value
            if (typeof value === 'string') {
                results.push({ navigable: obj, key: prop, href: value });
            }
        } else {
            // Continue traversing
            // isArray=true but value is not an array: schema validation should
            // have caught this upstream (validateResource runs before remember).
            // Skip rather than throw to stay consistent with other optional-path
            // handling (null values, non-object entries, non-string terminals
            // also skip).
            if (isArray && !Array.isArray(value)) continue;
            const next = isArray
                ? (value as Record<string, unknown>[])
                : [value as Record<string, unknown>];
            traverse(next, segments, index + 1, results);
        }
    }
}
