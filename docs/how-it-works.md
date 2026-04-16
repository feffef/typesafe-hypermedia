# Implementation Design

This document provides a deep technical dive into the architecture and implementation of `typesafe-hypermedia`.

## The Problem

Navigating HATEOAS (Hypermedia) APIs in TypeScript is notoriously difficult.
*   **Loose Typing**: Links are typically just string URLs in a JSON response. TypeScript has no way of knowing what resource a URL points to.
*   **`any` Returns**: Fetching a URL usually returns `any` or requires manual casting, which is error-prone and brittle.
*   **Boilerplate**: Developers often write wrapper classes or SDKs that duplicate the API structure, drifting out of sync with the actual API.

## The Solution

`typesafe-hypermedia` provides a **Type-Safe Hypermedia Client** that solves this by separating the *data schema* from the *link relationships*.

1.  **API Definition**: You define your resources and their relationships in a validated API definition.
2.  **Phantom Types**: The library overlays this relationship data onto your standard JSON schemas using **Phantom Types** (via Symbols).
3.  **Inference**: The client uses this metadata to automatically infer the return type of `navigate` calls, ensuring that if you follow a link to a "user", you get a "User" type back.

## 1. Architecture Overview

`typesafe-hypermedia` is a type-safe, framework-agnostic client for Hypermedia APIs. It consists of these main components:

1.  **API Definition (`link-definition.ts`)**: A validation system that defines resources, schemas, and links. Contains `defineLinks` which validates and returns a typed `ApiDefinition`.
2.  **Type System (`type-system.ts`)**: The core phantom type system. Defines `LinkSpec`, `Navigable`, and `Resource`. Holds the framework's compile-time metadata via phantom symbols.
3.  **Client Runtime (`api-client.ts`)**: The runtime implementation `ApiClient`. Handles creation of entry points, link resolution, and metadata management.
4.  **Public API (`navigate.ts`)**: The user-facing functions: `linkTo`, `navigate`, `navigateAll`.
5.  **Runtime Metadata (`runtime-metadata.ts`)**: Three module-level `WeakMap`s holding the runtime data the framework needs to operate on plain JSON objects without modifying them — which `ApiClient` produced each navigable, the followable links known on each navigable, and a compiled-path-accessor cache shared across clients of the same API definition. This is the runtime counterpart to `type-system.ts` (which holds compile-time phantom-type metadata). Free functions `rememberLinks`, `rememberEntryPoint`, `recallLink`, and `getOwningClient` operate on these maps; there is no class.
6.  **Fetch Customization (`fetch-customization.ts`)**: Extension point for custom fetch behavior (HTTP methods, headers, auth). Also contains the type derivation for `FetchContext.navigable` (`TypeAtPath`, `ParentPath`, `LinkNavigable`, `AllLinkNavigables`).

## 2. API Definition & Validation

**Implementation:** [`src/link-definition.ts`](../src/link-definition.ts)

The entry point is `defineLinks(resourceNames, apiDefinition, options?)`.

### Design Goals
*   **Strict Validation**: Ensure that every link points to a resource that actually exists.
*   **Allow Circular References**: Resources often link to each other (User -> Post -> User).
*   **DRY**: Don't repeat anything defined by the schema.
*   **URI Templates**: Define schemas for parameters so clients know exactly what is required.

### Implementation
The `defineLinks` function takes two required arguments and one optional:
1.  `resourceNames`: An array of strings defining all valid resource keys.
2.  `apiDefinition`: A record mapping these names to `ResourceDefinition` objects.
3.  `options?`: Optional configuration. Currently supports `schemas?: Record<string, TSchema>` — a registry of schemas for resolving `Type.Ref(...)` nodes during link path validation. Resource schemas with `$id` are auto-discovered; use `schemas` for external schemas not in the API definition.

```typescript
const api = defineLinks(['user', 'post'], {
  user: {
    schema: UserSchema,
    links: { 'posts': { to: 'post' } }
  },
  post: {
    schema: PostSchema,
    links: { 'author': { to: 'user' } }
  }
});
```

**Runtime Validation**:
Checking consistency, schema compliance (link paths must exist in schema), and target validity.

## 3. URI Templates & Parameter Schemas

A fundamental design principle is the combination of **URI Templates** with **Parameter Schemas**.

We extend the `LinkDefinition` with an `params` property containing a TypeBox schema. The client validates provided parameters against this schema *before* expanding the URI template.

**Benefits**:
1.  **Complete Contract**: Clients know exactly which parameters are required and their types.
2.  **Client Stability**: Server can change URL structure (path vs query) without breaking client code, as long as the parameter schema matches.

## 4. The Type System (Compile-Time Phantom Metadata)

**Implementation:** [`src/type-system.ts`](../src/type-system.ts)

The core innovation is overlaying link metadata onto standard JSON schemas without polluting runtime objects.

### 4.1 Phantom Metadata: `LinkSpec`
We define a compile-time metadata structure called `LinkSpec`:
```typescript
export interface LinkSpec<Target, Params, Api, Error> {
    Target: Target; // Name of the resource this link points to
    Params: Params; // Schema for parameters (or never)
    Api: Api;       // The full API definition
    Error: Error;   // Expected errors map
}
```

### 4.2 The `Navigable` Interface
We attach this metadata to objects using a unique symbol `[$links]`:
```typescript
export const $links = Symbol('links');

export interface Navigable<L extends Record<string, LinkSpec>> {
    [$links]: L;
}
```
At runtime, this symbol property **does not exist**. It is a "Phantom Type" used solely by TypeScript to track the links available on an object.

### 4.3 The `Resource` Type
The final type returned to the user is a merge of the data schema and the navigable overlay:
```typescript
export type Resource<N, A> = Merge<Static<A[N]['schema']>, MergedOverlay<A, N>>;
```
The recursive `MergeInner` type handles three cases:
- **Arrays**: Uses `O[number]` (not `infer`) to extract overlay element types — TypeScript's `infer` from an intersection of arrays (e.g. `A[] & B[]`) only captures the last constituent, while `O[number]` correctly yields `A & B`.
- **Objects**: Maps over the schema's keys, recursively merging where the overlay overlaps. If the overlay carries phantom link metadata (`Navigable`), it's re-attached via `& Navigable<L>`. Non-navigable overlays (intermediate path segments) add `& unknown`, which TypeScript simplifies away — preventing the property duplication that a blanket `& O` would cause in IDE tooltips.
- **Primitives**: Simple intersection `S & O`.

The `LinkOverlay` type contributes only the phantom `Navigable<{ prop: LinkSpec }>` — the schema already declares the link property as a string, so the overlay doesn't duplicate it.

### 4.4 FetchContext Type Derivation

**Implementation:** [`src/fetch-customization.ts`](../src/fetch-customization.ts)

The library derives the type of `FetchContext.navigable` from the API definition using path-based type resolution:

```typescript
// Resolves a dot-notation path to the type at that location
type TypeAtPath<T, Path> = /* recursive conditional type */

// Strips the last segment: 'actions.createPet.href' → 'actions.createPet'
type ParentPath<P> = /* recursive template literal type */

// Combines them: the parent object type for a link path.
// NonNullable strips undefined from optional schema properties — the navigable
// is always defined at the point the fetch factory is called.
type LinkNavigable<Schema, LinkPath> = NonNullable<TypeAtPath<Static<Schema>, ParentPath<LinkPath>>>

// Unions all link navigable types across all resources
type AllLinkNavigables<Api> = /* mapped type distributing over resources and links */
```

When `FetchContext` or `FetchFactory` is parameterized with a specific API definition:
- `navigable` is typed as the union of all link object shapes (e.g., `{ href: string, method?: string }`)
- `targetResourceName` is narrowed to valid resource names

When unparameterized, both fall back to `any`/`string` for backwards compatibility. `FetchContext` is a `type` alias (not an `interface`) gated with a single top-level `[ApiDefinition] extends [Api]` conditional, so all properties consistently use the same guard — no per-property drift is possible when adding future fields.

## 5. Client Runtime (`ApiClient`)

**Implementation:** [`src/api-client.ts`](../src/api-client.ts)

The `ApiClient` is responsible for:
1.  **Creating Entry Points**: `createEntryPoint` returns the root and registers it with `runtime-metadata` so subsequent `navigate()` calls can find it.
2.  **Resolving Links**: `resolve` looks up the requested link via `recallLink`, expands templates, fetches, and files the result via `rememberLinks`. The public `navigate` function delegates to this.
3.  **Remembering fetched resources**: passing each result through `rememberLinks` so its links become followable on the next `navigate()` call.

### 5.1 Hidden Metadata via WeakMaps (Out-of-Band State)

The framework remembers runtime knowledge about plain JSON objects without
modifying them. Instead of polluting your objects with `__metadata` fields or
wrapping them in proxy classes, we use JavaScript's native mechanism for
hidden state: object-identity-keyed `WeakMap`s. This is the canonical use case
TC39 documents for `WeakMap` — keeping hidden data about an object without
modifying it and without preventing garbage collection.

Three module-level `WeakMap`s in
[`runtime-metadata.ts`](../src/runtime-metadata.ts) hold the runtime side of
the framework:

| Map | Key | Value | Purpose |
|---|---|---|---|
| `apiClientByNavigable` | navigable object | `ApiClient` | Which client produced this object — the entry point for `navigate()` to dispatch to the right client. Last-writer-wins on re-registration. |
| `linksByNavigable` | navigable object | `Map<string, KnownLink>` | The followable links on this navigable, by name. Each `KnownLink` carries the link definition, the base URL inherited from the response that produced it, the extracted href, and its own name. |
| `accessorCache` | link-definitions object (from a `ResourceDefinition`) | compiled traversal functions | One-time path compilation, reused across every fetch of a given resource type and shared across all clients of the same API definition. |

A `KnownLink` is everything the framework needs to follow one link, derived
from the JSON at fetch time:

```ts
interface KnownLink {
    name: string;          // 'next', 'self', 'href', etc.
    linkDef: LinkDefinition;
    baseURL: string;
    href: string;
}
```

When you call `navigate(somePlainObject)`, the framework does two `WeakMap.get`
calls: one against `apiClientByNavigable` to find the client, then that
client's `resolve` calls `recallLink(obj, name?)` which does another
`WeakMap.get` against `linksByNavigable` to find the link. Two reads, no
reflection, no symbols on the object, no proxy.

**Properties:**

*   **Purity**: The JSON objects remain pure. No `__metadata`, no hidden
    symbols, no decorator wrappers. They are exactly what the server returned.
*   **Identity-keyed**: Lookup is by object reference. Two distinct fetches
    produce two distinct objects, so cross-client interference is impossible
    even though all three maps are module-global.
*   **Garbage collection**: All three maps are `WeakMap`s. When a navigable
    becomes unreachable, its entries in `apiClientByNavigable` and `linksByNavigable` are
    collected automatically. `accessorCache` entries are collected when the
    underlying `ResourceDefinition` is collected.
*   **No instance state**: The maps live at module scope, not on `ApiClient`.
    Per-client scoping isn't needed because object identity already prevents
    collisions, and `accessorCache` benefits from being shared across clients
    of the same API definition.
*   **Cache caveat**: `accessorCache` is keyed by the *object reference* of
    the link-definitions map. API definitions declared once at module scope
    (the normal case) benefit from the cache. Definitions constructed inline
    per call (e.g. `{ ...base, ...extra }`) thrash the cache silently because
    each call produces a new object identity. See `dev-guide.md` for guidance.

### 5.2 Compiled Path Accessors
**Implementation:** [`src/runtime-metadata.ts`](../src/runtime-metadata.ts)

The `extractLinks` helper compiles link path definitions into optimized accessor functions and caches them per `ResourceDefinition`. On the first fetch of a resource type, path definitions (e.g., `items[].author.href`) are compiled into functions that efficiently traverse the object graph. Subsequent fetches of the same resource type reuse these compiled accessors, avoiding repeated path parsing and traversal logic.

The cache (`accessorCache`) is module-level and keyed by the link-definitions object reference, so a single compiled set of accessors is shared across all clients of the same API definition. Dynamically constructed link-definitions (e.g. `{ ...base, ...extra }` inline per call) thrash the cache silently because each call produces a new object identity; the normal case (top-level `const` API definitions) is unaffected.

### 5.3 Base URL Resolution
The client automatically resolves absolute paths (e.g., `/api/users`) to fully qualified URLs by extracting and storing the base URL (protocol + host + port) from the resource that contained the link. This is expected behavior for a context-aware hypermedia client: when you fetch `https://api.example.com/shop` and it returns a link `/api/products`, the client knows to resolve it as `https://api.example.com/api/products`. This works across different hosts and handles port numbers transparently.

## 6. Public API (`navigate`, `linkTo`)

**Implementation:** [`src/navigate.ts`](../src/navigate.ts)

### 6.1 `linkTo`
Initializes the client and creates a link to the root.
```typescript
const rootLink = linkTo({ api, resource, url });
```

`ConnectOptions` also accepts an optional `errorVerbosity` setting:
- `'verbose'` (default): Error messages include full URLs, resource names, schema paths, and URI template details. Best for client-side debugging.
- `'safe'`: Error messages omit URLs, internal identifiers, URI template structures, and parameter values. Use this in BFF/API gateway contexts to prevent leaking internal API topology to end users. Covers all error paths including URI template expansion and validation errors.

```typescript
const rootLink = linkTo({ api, resource, url, errorVerbosity: 'safe' });
```

### 6.2 `navigate(navigable)` — single-link auto-resolve
When a navigable has exactly one link defined, `navigate` resolves it automatically — no need to specify which.
```typescript
const product = await navigate(root.products[0]);
```
This is the common case for link objects (`{ href: '...' }`) and root navigables.
*   **Two-step `WeakMap` lookup**: `navigate` calls `getOwningClient(obj)` to find the client (one `WeakMap.get` against `apiClientByNavigable`), then dispatches to that client's `resolve()`, which calls `recallLink(obj)` to find the followable link (a second `WeakMap.get` against `linksByNavigable`). Both lookups are O(1) and identity-keyed. If the object was never produced by any client, `getOwningClient` returns `undefined` and `navigate` throws a diagnostic error pointing the developer at the most likely cause (the object wasn't created by `typesafe-hypermedia`).
*   **Delegation**: It calls `client.resolve()` on the single available link.

### 6.3 `navigate(navigable, { link, params? })` — named link mode
For navigables with multiple links (or when you need to pass URI template parameters), specify the link by name.
```typescript
const user = await navigate(root, { link: 'currentUser' });
const product = await navigate(shop, { link: 'getProduct', params: { id: '123' } });
```

If a non-existent link name is provided, `navigate` throws a `TypeError` listing the requested name and available links. This error is always verbose regardless of `errorVerbosity` — link names are compile-time constants from the API definition, not sensitive runtime data.

### 6.4 `navigateAll(links)`
Convenience helper that resolves an array of single-link navigables in parallel.
```typescript
const orders = await navigateAll(user.orders);
```


## 7. Error Handling (Optional)

**Implementation:** [`src/error-handling.ts`](../src/error-handling.ts)

Links can declare `expect`ed errors (e.g. 404).

*   **Safe Links**: Return `Promise<Resource>`. Every failure (network, HTTP, parse, schema) throws a JS `Error`.
*   **Prone Links**: Return `Promise<[Resource, null] | [null, Failure]>`. **Pipeline failures never throw** — URI expansion errors, transport errors, non-OK responses, JSON parse failures, and schema mismatches are all returned as `Failure` variants in the tuple. Callers of prone links never need a `try`/`catch`.

### The `Failure` shape

`Failure` is a discriminated union with N+1 cases:

- **N user-declared cases** — one per error resource named in the link's `expect` map. Each carries `kind` (the resource name), the parsed typed `resource`, a `message`, and a required `response: ResponseInfo`.
- **1 library catch-all** — `kind: 'unexpected'`, sub-discriminated by `reason`:
    - `'uriExpansion'` — URI template expansion failed before the request was sent (bad params, malformed template). **No `response` field** on this branch.
    - `'network'` — no Response received (DNS, connect refused, TLS, abort). **No `response` field** on this branch.
    - `'unmappedStatus'` — Response received with a non-2xx status that wasn't in the `expect` map.
    - `'invalidJson'` — Response received but the body wasn't parseable JSON.
    - `'invalidStructure'` — Response received, JSON parsed, but the body didn't match the declared schema.

`ResponseInfo` is `{ status, statusText, headers: Headers, body? }`. Headers come straight from the underlying `fetch` `Response.headers` so callers can read e.g. `response.headers.get('retry-after')` for rate-limit recovery. The reserved name `'unexpected'` is rejected by `defineLinks` (compile-time and runtime) so there is no collision with the catch-all variant.

In `errorVerbosity: 'safe'` mode, headers are replaced with an empty `Headers()` (they're notorious for leaking server topology), URLs are stripped from messages, and `cause` is dropped. `status`, `statusText`, `body`, `kind`, and `reason` always survive — they're either user-declared schema or non-sensitive HTTP facts.

### Benefits

1. **Type Safety**: TypeScript knows which errors to expect and enforces handling
2. **Navigable Errors**: Error responses can have links to recovery actions
3. **Opt-In**: Only affects links where you add `expect` - safe links unchanged
4. **Realistic**: Acknowledges all operations can fail, provides best-effort info
5. **Explicit**: Forces developers to think about error cases for risky operations

### Drawbacks

1. **Breaking by Design**: Adding `expect` to an existing link changes its return type from `Resource` to `[Resource, null] | [null, Failure]`. This is intentional - it forces client developers to handle errors. While the HTTP API remains backwards compatible, the TypeScript client API intentionally breaks to enforce safety.
2. **Verbosity**: Tuple destructuring and null checks add code compared to try/catch
3. **Learning Curve**: Developers must understand when to use `expect` vs safe links

### When to Use Error Handling

**Use `expect` for:**
- **Templated links with user input**: Parameters come from users, validation errors expected
- **Business actions**: Operations with business constraints (e.g., "out of stock", "conflict")
- **Optional resources**: Links that might return 404 (e.g., optional profile fields)

**Don't use `expect` for:**
- **Safe links**: Server-controlled links in successful responses (e.g., `catalog.pets[]`)
- **Internal navigation**: Links you control and know will succeed
- **One-off failures**: True exceptional cases (use try/catch for network failures)

### Key Design Principle: Safe by Default

The implementation **only activates error handling when you explicitly opt-in** by adding `expect` to a link definition. This design is intentional:

1. **Safe links return resources directly**: Following server-provided links in successful responses (e.g., `shop.actions.listPets` or `catalog.pets[]`) should rarely encounter HTTP errors. These return `Resource<N>` directly.

2. **User-input links need error handling**: Links with parameters from user input (e.g., search queries, IDs from URL params) are error-prone and should use `expect` to handle validation and not-found cases.

3. **Backwards compatible**: Existing code without `expect` continues to work unchanged. You can gradually add error handling only where needed.

4. **Type system enforces safety**: Once you add `expect`, TypeScript forces you to handle the tuple return type. You cannot accidentally ignore errors.

This "safe by default, strict when needed" approach balances convenience (most links just work) with safety (risky links require explicit error handling).

### Error Resources are Just Resources

A key insight: error resources are not special. They are regular resources that happen to be returned on error status codes. They:
- Are defined in the same flat structure as success resources
- Have schemas validated the same way
- Can have links that navigate normally
- Support all the same features (nested links, templated links, etc.)

This design keeps the API definition simple and consistent.

## 9. Design Decisions (The "Why")

### Why Support Both Link Objects and String Properties?

The library supports two link representations because both are valid patterns used successfully at scale:

**Link Objects** (e.g., `{ href: "/api/products" }`):
- Used by 7 out of 9 major hypermedia specs (HAL, Siren, JSON:API, Collection+JSON, UBER, Mason, JSON Home)
- Allows metadata (title, type, deprecation notices)
- Enables evolution without breaking changes
- Client uses single-link auto-resolve mode: `navigate(linkObject)`
- Trade-off: More verbose JSON, larger payloads

**String Properties** (e.g., `"productsUrl": "/api/products"`):
- Used by GitHub API (one of world's most-used APIs), JSON-LD/Hydra
- Simpler, lighter JSON
- Familiar pattern for developers
- Client uses named link mode: `navigate(resource, { link: 'productsUrl' })`
- Trade-off: Cannot add metadata without awkward parallel properties or breaking changes

**Design Philosophy**: Rather than mandate one approach, typesafe-hypermedia supports both because:
1. **Existing APIs vary** - Integration scenarios need flexibility
2. **Both scale** - GitHub proves string properties work at massive scale; HAL proves link objects work
3. **Different needs** - Payload-sensitive APIs (mobile, IoT) might prefer strings; evolving APIs benefit from link objects
4. **JSON:API validates both** - The 2nd most popular hypermedia format explicitly supports both patterns

The library doesn't pick winners - it provides the tools and lets developers choose based on their constraints.

### Why `@sinclair/typebox`?
*   **JSON Schema Compatibility**: TypeBox generates standard JSON Schemas, which are essential for API contracts and validation.
*   **Runtime + Compile-time**: It provides both static TypeScript types and runtime validation logic in a single definition, preventing drift.
*   **Trade-off**: This couples the library to TypeBox, making it harder for teams using Zod or other libraries to adopt it without adapters.

### Why Phantom Types (Symbol for Types + WeakMap for Runtime)?
*   **Developer Experience**: Allows users to work with their own plain data objects while still getting first-class IDE navigation.
*   **Clean Runtime**: Does not pollute the JSON payload with extra properties that might interfere with other libraries or serialization.
*   **Symbol (Type-Level Only)**: Exists in type definitions for phantom typing, enabling TypeScript to infer link targets and parameters.
*   **WeakMaps for runtime metadata (out-of-band state)**: Three module-level `WeakMap`s in `runtime-metadata.ts` hold the runtime data — `apiClientByNavigable` (navigable → `ApiClient`), `linksByNavigable` (navigable → known links), and `accessorCache` (link-defs → compiled traversals). This is `WeakMap` used as TC39 designed it: keeping hidden data about an object without modifying it and without preventing garbage collection. Object identity prevents cross-client collisions; weak references enable automatic cleanup when navigables become unreachable.
*   **Trade-off**: Metadata is ephemeral - lost during serialization. Resources must remain in memory to navigate. For state management (Redux), consider storing serialized data separately and re-navigating from root when needed.

### Why Simple Initialization?
*   **Ease of Use**: `linkTo()` provides a simple starting point - validates config and returns the root link.
*   **Type Safety**: Explicit `apiRoot` parameter ensures correct return type.
*   **Separation of Concerns**: Initialization separated from navigation (use `navigate()` to navigate).
*   **Trade-off**: Resources must stay in memory for navigation (metadata stored in module-level `WeakMap`s keyed by object identity).

### Why Opt-In Error Handling with Tuples?
*   **Safe by Default**: Most links (server-controlled) shouldn't need error handling. Only user-input links and business actions need it.
*   **Explicit Opt-In**: Adding `expect` is a conscious decision that changes the API contract. This is intentional - it forces awareness.
*   **Breaking by Design**: When you add `expect` to a link, the return type changes to a tuple. This breaks existing code, forcing developers to handle errors. While the HTTP API remains backwards compatible, the TypeScript client API intentionally breaks to enforce safety.
*   **Tuple Over Discriminated Union**: Tuples force immediate awareness (you see both result and error), allow natural naming, and provide simple happy-path checks (`if (result)`).
*   **Type Safety**: TypeScript enforces handling through the tuple pattern. You cannot accidentally ignore errors once `expect` is declared.
*   **Trade-off**: More verbose than try/catch, but explicit and type-safe. Forces thinking about error cases upfront.

## 10. Known Gaps & Roadmap

**Phase 1: Core Completeness**

*   No known gaps at this time.

**Phase 2: Robustness**
*   ✅ **Performance (RESOLVED)**: Link extraction uses compiled path accessors cached per ResourceDefinition. First fetch compiles optimized traversal functions, subsequent fetches reuse them. No repeated traversals for similar paths (e.g., `items[].author` and `items[].category` share traversal). Performance optimized for production use.
*   **Reattachment after serialization**: Need a utility to reattach runtime metadata to objects that have been serialized/deserialized (Note: This is generally an anti-pattern in HATEOAS - see Section 7.3 for best practices).

## 11. Lessons Learned

*   *Placeholder: Document failed refactoring attempts here to avoid repeating mistakes.*
