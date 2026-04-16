# DX Roadmap

Prioritized improvements identified through external code review and internal analysis. Items are ordered by value-to-effort ratio.

---

## 1. `debugNavigable()` Utility

**Priority**: High value, low effort

### Problem

The library's core design keeps runtime objects pure — link metadata lives in a per-client `WeakMap`, invisible to `console.log()`, browser devtools, and Redux DevTools. When navigation fails, developers can see the raw href strings but not the resolved metadata (owning client, target resource, parameter schemas, base URL).

### Why It Matters

Debugging "Link metadata not found" errors currently requires developers to mentally trace the connection between a runtime object and the `defineLinks` registry. A one-line debug call eliminates that guesswork without compromising the "pure JSON" design principle.

### Approach

Export a `debugNavigable(obj)` function that queries the global `navigableOwner` map and the owning client's `MetadataStore`, returning a structured snapshot:

```typescript
debugNavigable(shop)
// → {
//     owner: "ApiClient#1",
//     links: {
//       productsUrl: { target: "products", href: "/products", baseURL: "https://api.example.com" },
//       self: { target: "shop", href: "/shop/1", baseURL: "https://api.example.com" }
//     }
//   }
```

Implementation considerations:

- Should return `undefined` (not throw) for objects without metadata — the primary use case is "is this thing navigable?"
- Keep it tree-shakeable — developers who don't import it pay nothing
- Consider a `debugAllNavigables(resource)` variant that recursively walks an object graph and reports all navigable objects found (useful for inspecting deeply nested resources)
- No need for this to be typed with phantom types — it's a debugging escape hatch, plain `object` input is fine

---

## 2. State Management Documentation

**Priority**: High value, low effort

### Problem

The `WeakMap` metadata design interacts with frontend state management in ways that aren't immediately obvious. Shallow spreading (`{ ...resource }`) is safe because nested link objects retain their identity. Deep cloning (`structuredClone`, `lodash.cloneDeep`, aggressive Immer `produce` on link objects) severs the WeakMap connection. This distinction isn't documented, so developers hit "Link metadata not found" errors and don't understand why.

### Why It Matters

React, Vue, and Redux all encourage immutable updates. Developers will instinctively spread objects. The good news is that the common case (shallow spread of a parent resource) works fine — the library already has a passing test for this (`test/integration/client-runtime.spec.ts:615-638`). But without documentation, developers who encounter the edge cases will assume the library is fundamentally incompatible with their framework.

### Approach

Add a dedicated section to `how-it-works.md` (or a standalone `state-management.md` if the content warrants it) covering:

1. **What's safe**: Shallow spread of parent resources preserves nested link object references. Show the test case as proof.
2. **What breaks**: Deep cloning, `structuredClone()`, serialization/deserialization (`JSON.parse(JSON.stringify(...))`), and `lodash.cloneDeep` all create new object references that lose WeakMap metadata.
3. **The HATEOAS pattern**: Store URLs in persistent state (Redux, localStorage), not navigable objects. On component remount, navigate from root via `linkTo()` + `navigate()`. This is the architecturally correct approach regardless of WeakMap concerns.
4. **Why not stamp metadata onto objects**: Explain the tradeoff — polluting objects with `__metadata` properties interferes with serialization, `JSON.stringify()`, equality checks, and other libraries. The WeakMap approach keeps objects clean at the cost of reference sensitivity.

---

## 3. Targeted Type Error Improvements

**Priority**: Medium value, medium effort

### Problem

The type system uses recursive conditional types (`BuildPath`, `PathOverlay`, `MergedOverlay`) and `UnionToIntersection`. When types don't align, errors can expand to 8-10 lines exposing internal type machinery. Common errors (wrong object to `navigate()`, typo in link name) produce moderate noise; uncommon errors (deep path mismatches) produce worse output.

### Why It Matters

This is the same tradeoff every type-heavy library makes (Prisma, tRPC, Drizzle all have this). The library's IDE autocomplete prevents most errors before they happen, which significantly reduces the practical impact. But when errors do occur, friendlier messages lower the barrier for developers less experienced with advanced generics.

### Approach

TypeScript's "branded error string" trick (returning a string literal type like `"Link 'x' is not defined..."` from a conditional type) works but is brittle and adds maintenance burden to recursive types. A more practical strategy:

**Focus on entry points, not internals.** The types that produce the worst errors (`BuildPath`, `MergedOverlay`) are deep in the type system — intercepting failures mid-recursion is hard without bloating the definitions. Instead, target the public API surface where developers actually make mistakes:

1. **Wrong object type passed to `navigate()`** — most commonly, calling `navigate(obj)` (single-link mode) on a multi-link navigable. The runtime error is descriptive ("object has N links, specify which..."), but the compile-time overload mismatch can produce noisy errors.
2. **Invalid link name on `navigate(obj, { link: 'foo' })`** — already handled well at runtime ("no link named X, available links: ..."), but the compile-time error could be friendlier.
3. **Parameter type mismatches on templated links** — the `ConditionalParams` helper is relatively simple, so errors here are already manageable.

This 80/20 approach covers the most common mistakes without touching the recursive core.

---

## 4. ~~Unify `resolve` and `resolveFrom`~~ ✅ COMPLETED

`resolve` and `resolveFrom` were replaced with a single `navigate(navigable, options?)` function. The chosen design corresponds to **Option B** (options object) from the original analysis:

```typescript
navigate(shop.featuredPet)                                       // single-link auto-resolve
navigate(shop, { link: 'productsUrl' })                          // named link
navigate(shop, { link: 'searchUrl', params: { query: 'fido' } }) // named templated link
navigate(shop.featuredPet, { params: { id: 42 } })               // single templated link — `link` omitted
```

**Mental model**: a navigable is "an object containing links." When the navigable has exactly one link, `navigate(navigable)` auto-resolves it; the `link` option is only required when there are multiple links to choose from.

**Why this won out**: the positional ambiguity of Option A (params vs. link name) was real and confusing. Option C (`resolve.link(...)`) kept two concepts. Option B is verbose for the multi-link case but the type system makes the difference compile-time obvious, and the single-link case (which dominates in HAL/Siren-style APIs) needs no `link` argument at all. The unification eliminated AGENTS.md "Common Mistakes §1" as it existed.

**See**: `src/navigate.ts` for overload definitions and `test/integration/navigate.spec.ts` Section 1 for the full set of usage patterns.

---

## 5. Client-Provided Request Data (Body/Payload)

**Priority**: High value, medium effort — **functional gap**

**Status note (2026-04-11)**: `examples/hateoas-bff/bff-routes.ts` now contains a concrete motivating example. The `postToErp()` helper there bypasses `navigate()` for the checkout flow (raw `fetch` + hand-built URL + hardcoded `Content-Type`), with a JSDoc block pointing back at this roadmap item. Use it as the reference case when designing the API: any solution should let `postToErp` collapse into a single `navigate(erpRoot, { link: 'ordersUrl', data: {...} })` call.

### Problem

The library currently has no way to pass client-provided data (request bodies, form payloads, mutation inputs) through the resolution pipeline. `navigate()` accepts URI template `params` that shape the URL, but nothing that shapes the request itself. This makes the library effectively read-only — any API that requires POST/PUT/PATCH with a request body cannot be driven through `navigate()`.

### Why It Matters

This isn't an edge case. Most real-world APIs require mutations: creating orders, submitting forms, updating profiles. Today the only workaround is to have the server include body data on link objects (impractical — the client generates this data) or smuggle it through the `FetchFactory` via closures or side channels (ugly, breaks the type safety story). A hypermedia client that can't express "follow this link *with this data*" has a hard ceiling on usefulness.

### Design Constraints

The library's philosophy is that it handles URI resolution and type safety — HTTP concerns belong to `FetchFactory`. Any solution needs to respect this boundary:

- The library shouldn't assume the data is a JSON body — it could be form data, a file upload, or something domain-specific. The abstraction is "a JSON object to be transferred to the given URI."
- `FetchFactory` already receives `context.navigable` (server-provided link metadata like `method`). Client-provided data is a separate concern — it comes from the caller, not the server.
- URI template `params` serve a similar role (client-provided data shaping the request) but are scoped to URL construction. Request data is the natural complement.

### Approaches to Explore

**Option A: Data parameter on `navigate()`**

```typescript
const order = await navigate(shop.createOrder, { productId: '123', quantity: 2 });
```

Problem: this collides with the existing options object for URI template expansion. A link could need both template params AND body data. Positional args get ambiguous.

**Option B: Options object**

```typescript
const order = await navigate(shop.createOrder, {
  params: { shopId: '42' },       // URI template expansion
  data: { productId: '123' }      // passed to FetchFactory as context.data
});
```

The `FetchFactory` receives `context.data` and decides what to do with it (JSON body, form encoding, etc.). This keeps the library agnostic about HTTP semantics while giving the factory the information it needs.

**Option C: Typed data via link definitions**

```typescript
defineLinks(['shop', 'order'], {
  shop: {
    schema: ShopSchema,
    links: {
      createOrder: {
        to: 'order',
        href: 'actions.createOrder.href',
        data: Type.Object({ productId: Type.String(), quantity: Type.Number() })
      }
    }
  }
});
```

Like `params` for URI templates, `data` would define a TypeBox schema for the expected payload. The type system enforces correct data at the call site, and the value is passed through to `FetchFactory` as typed context. The library validates the shape but is **completely agnostic about how the data is used** — the `FetchFactory` decides whether it becomes a JSON body, form data, query parameters, a file upload, or anything else. The library never calls `JSON.stringify` or sets `Content-Type`.

### Open Questions

- The `navigate` options object now has `link` and `params` slots — `data` would be a third sibling. Is the resulting `{ link, params, data }` shape still readable, or does it need restructuring?
- Should `data` be validated against its schema before being passed to the factory, the same way `params` are validated before template expansion?

### Pre-implementation: Overload Scalability

The current `navigate` implementation uses 6 overloads covering the 2×3 matrix (single-link vs. named-link × safe-concrete / safe-templated / prone). Adding `data` naively adds up to 4 more overloads (single × safe/prone × with-data), pushing the total to 10+.

Before starting §5 work, evaluate whether a **conditional return type** approach can collapse the overloads into fewer signatures. The type safety goal is unchanged — the question is whether the compiler can infer the right return type from a single generic signature rather than requiring exhaustive overloads. If a clean conditional type solution exists, implement it first; if not, document why and accept the overload count.

### Status

Identified as a functional gap. The §4 API unification is now complete, so a `data` field could slot into the existing `navigate` options object naturally.

---

## 6. Codegen Companion Tool

**Priority**: Future epic, out of scope for the core library

### Problem

For large APIs (50+ resource types), manually writing TypeBox schemas and `defineLinks` mappings is labor-intensive. In an ecosystem with GraphQL introspection and OpenAPI codegen, manual schema maintenance creates adoption friction.

### Why It Matters

This is a tooling gap, not a library flaw. The library defines *resource types* (not endpoints), so a typical 100-endpoint API maps to 15-25 resource definitions at ~5-10 lines each — manageable, but tedious at scale. Teams with existing TypeBox schemas only need the link mapping, which is lighter.

### Approach

A separate package (e.g., `typesafe-hypermedia-openapi`) that reads an OpenAPI 3.x spec and generates:

- TypeBox schema definitions for each response type
- `defineLinks()` call with link mappings derived from OpenAPI `links` objects or HAL extensions
- Parameter schemas from path/query parameter definitions

This is explicitly out of scope for the core library. The core should remain dependency-free and not assume any particular API description format. A codegen tool is a consumer of the library's public API, not part of it.

---

## 7. Rename `ConnectOptions` to a More Descriptive Name

**Priority**: Low — breaking change, cosmetic only

### Problem

`ConnectOptions` is a generic name that doesn't immediately suggest "configure a hypermedia client." In an ecosystem with database connections, WebSocket connections, and HTTP clients, a developer scanning an unfamiliar codebase won't know what this type configures without reading its definition.

### Why It Matters

Public API type names are part of the library's surface area. A name like `ClientConfig` or `HypermediaClientOptions` is self-documenting at the call site:

```typescript
// Before — what kind of connection?
const options: ConnectOptions<MyApi, 'shop'> = { ... };

// After — immediately clear
const options: ClientConfig<MyApi, 'shop'> = { ... };
```

### Approach

Rename `ConnectOptions` in `src/type-system.ts` and update all references. This is a breaking change for any consumer who has typed the options object explicitly — a deprecated re-export alias (`ConnectOptions = ClientConfig`) could ease migration in a future minor version before the alias is removed in the next major.

### Constraint

This should be batched with any other public type renames to minimise the number of breaking releases.

---

## 8. Standardized Error Class Hierarchy

**Priority**: Medium value, medium effort — breaking change

### Problem

Errors thrown by the library are plain `Error` and `TypeError` instances with descriptive messages but no class-based discrimination. Consumers cannot use `instanceof` to distinguish a navigation error (e.g. unknown link name) from a validation error (response failed schema check) from a configuration error (bad `defineLinks` input). Catch blocks must inspect message strings, which is brittle.

The `errorVerbosity` system standardizes the *messages* across error paths, and `error-handling.ts` centralizes prone-link error *responses*, but there's no class hierarchy for *thrown* errors.

### Why It Matters

For library consumers writing higher-level wrappers (BFFs, SDK layers, retry logic), being able to discriminate error types programmatically is the difference between a clean `catch (e) { if (e instanceof NavigationError) ... }` and string-matching error messages. The latter breaks any time the library tweaks its messages, including the `verbose`/`safe` toggle.

### Approach

Introduce a small hierarchy in `src/error-handling.ts`:

- `HypermediaError` — base class extending `Error`
- `NavigationError` — bad link name, navigable without metadata, missing client
- `ValidationError` — schema check failed on response or params
- `ConfigurationError` — `defineLinks` validation failures, bad URI templates

Update all `throw` sites in `api-client.ts`, `navigate.ts`, `link-definition.ts`, `uri-templates.ts`, and `link-extraction.ts` to throw the appropriate subclass. Preserve the existing message strings (and their `verbose`/`safe` variants) so this is purely additive at the message level.

This is a breaking change for any consumer that catches `TypeError` specifically — the `navigate` "no link named X" path currently throws `TypeError`, and would become `NavigationError extends Error`. Document in the release notes.

### Constraint

Batch with other breaking changes (e.g. §7 `ConnectOptions` rename) to minimize the number of major releases.

---

## 9. Reduce Schema Introspection in `link-definition.ts`

**Priority**: Medium value, medium effort — risk to existing validation behavior

### Problem

`validateApiDefinition` walks each link path through the resource schema using a hand-written traversal (`resolveSchemaAtPath`, `collectProperties`, `collectArrayItems`) that mirrors a subset of TypeBox constructs: `IsObject`, `IsArray`, `IsIntersect`, `IsUnion`, `IsRef`. The `SchemaResolver` mechanism handles `Type.Ref(...)` with cycle detection, and `Optional` is transparent in TypeBox 0.34+, so the most common cases work — but any new TypeBox construct (e.g. `Type.Mapped`, `Type.Transform`, `Type.Conditional`, recursive types via `Type.Recursive`) will silently fall through and report "Property does not exist in schema" even when it does.

### Why It Matters

This is fragile by construction: the library reimplements a subset of TypeBox's own schema traversal. Every TypeBox release is a potential silent break. Today this is "works for the constructs people actually use," but the failure mode (cryptic validation error pointing at a perfectly valid path) is nasty.

### Approach

Two viable strategies:

**Option A — Lean on TypeBox's own machinery.** Use `Value.Pointer` or `TypeBox.Walk` (whichever is exposed in the current version) to navigate the schema tree, instead of hand-rolled `collectProperties`. Trade-off: couples validation more tightly to TypeBox internals, but eliminates the reimplementation drift.

**Option B — Drop deep path validation entirely.** Keep the cheap checks (target resource exists, names match between `resourceNames` and `apiDefinition`, error map is well-formed) and let invalid link paths surface at fetch time as "link path X resolved to undefined." Trade-off: loses compile-time `defineLinks()` validation for typo'd paths, but removes the maintenance burden completely.

Decide based on how often link path typos occur in practice. If `defineLinks` callers rarely hit path validation errors, Option B is the cleaner long-term move; if they do, Option A is safer.

### Risk

High — both options change validation behavior. Some currently-caught misconfigurations would either move to fetch time (Option B) or change their error messages (Option A). Requires careful test updates.

---

## 10. Tighten `LinkSpec` Generic Defaults

**Priority**: Low / medium — pre-v1 type API cleanup

### Problem

`LinkSpec`'s `= any` defaults defeat the purpose of the constraint and contradict the project's "avoid `any`" philosophy. Bare `LinkSpec` (no type arguments) is a frequent pattern — it appears in upper-bound constraints (`L extends Record<string, LinkSpec>`) and in value-position assertions (`Navigable<{ href: LinkSpec }>`). The `= any` defaults exist for a real reason: without them, the bare form would break. But `any` is too loose — it silently accepts whatever the caller passes and removes the compiler's ability to flag mismatches.

### Why It Matters

The `= any` defaults are a known type-safety hole in the public API surface. `LinkSpec` is one of the library's primary exported types, listed explicitly in the public API surface in AGENTS.md. Having `any` as the default for three of its four type parameters means callers who write `LinkSpec` (bare) get zero type safety for `Params`, `Api`, and `Error`. A tighter form makes the constraint meaningful even when used bare.

### Why Deferred

The naive fix (`= TObject`, `= ApiDefinition`, `= ErrorResourceMap | undefined`) breaks assignability for value-position bare `LinkSpec` usages. Specifically, `LinkSpec<string, TObject, ...>` is not assignable to a concrete instance like `LinkSpec<'shop', never, MyApi, undefined>` because `TObject` is not assignable to `never`. Fixing this correctly requires either:

1. A dedicated `AnyLinkSpec` / `UnknownLinkSpec` alias that represents the widest assignable form, or
2. Removing defaults entirely and updating every bare-`LinkSpec` usage site — a breaking change.

Neither is a quick edit. Doing it carelessly would break existing user code in non-obvious ways.

### Approach

Introduce a dedicated alias for the widest assignable form:

```typescript
export type UnknownLinkSpec = LinkSpec<string, TObject | undefined, ApiDefinition, ErrorResourceMap | undefined>;
```

Then remove the defaults from `LinkSpec` entirely (making the type arguments required). Migrate all bare-`LinkSpec` usages in the library to `UnknownLinkSpec`. Export `UnknownLinkSpec` as part of the public type surface so library consumers can update their own code.

This is breaking: any caller who wrote `LinkSpec` (bare, no args) will get a compile error pointing them at `UnknownLinkSpec`. That is the intent — the error message is informative and the fix is mechanical.

### Sites to Migrate

Concrete inventory of bare `LinkSpec` occurrences that need updating:

- **`src/type-system.ts`**: `Navigable<L extends Record<string, LinkSpec>>`, `LinkOverlay<Prop, Info extends LinkSpec>`, `PathOverlay<Path, Info extends LinkSpec>`, `LinkedResource<L extends LinkSpec>`
- **`src/navigate.ts`**: `TheLink`, `ConditionalParams`, `SafeLinks`, `ProneLinks`, navigate overloads 5 and 6
- **`src/error-handling.ts`**: `ResourceOrFailure`
- **`src/api-client.ts`**: `resolve`
- **`test/integration/navigate-entry.spec.ts:124`**: value-position assertion

### Effort Estimate

2–4 hours (full audit + docs + examples update).

### Breaking

Yes — `LinkSpec` becomes parameterless (requires explicit type arguments). Users with `LinkSpec` (no args) get a compile error pointing at `UnknownLinkSpec`. Justified pre-v1 where API-surface churn is acceptable.

### Constraint

Batch with other pre-v1 breaking changes (§7 `ConnectOptions` rename, §8 error class hierarchy) to minimize the number of breaking releases.

---

## 11. `navigateAll` Keyed Fan-Out

**Priority**: Medium value, low effort — **ergonomics**

### Problem

`navigateAll()` returns `Promise<T[]>` in the same order as the input links. Callers that need a keyed result (e.g. `Map<sku, price>`) must write a manual `Promise.all(skus.map(...))` fan-out and populate a map by hand. This pattern showed up three times in the `feat/bff-showcase` work as the `fetchQuotes` / `fetchPrices` helper:

```ts
async function fetchQuotes(erpRoot: ErpRoot, skus: string[]): Promise<Map<string, number>> {
    const quotes = new Map<string, number>();
    await Promise.all(skus.map(async sku => {
        try {
            const quote = await navigate(erpRoot, { link: 'quoteUrl', params: { sku } });
            quotes.set(sku, quote.price);
        } catch { /* leave out */ }
    }));
    return quotes;
}
```

### Direction

Consider a `navigateAllKeyed(resource, link, keys, mapFn?)` overload, or accept a key extractor on `navigateAll` so callers can get `Map<K, T>` (or `Record<K, T>`) with built-in `allSettled` semantics and per-item failure tolerance. The core library already handles the parallel fan-out — formalizing the "keyed" shape would remove the repeated boilerplate and make per-item failure handling declarative.

---

## 12. Link Graph Visualization

**Priority**: Low value, low effort — **developer tooling**

### Problem

When a project defines multiple interconnected resources via `defineLinks`, understanding the overall resource graph requires reading each definition in turn. There is no way to get a bird's-eye view of which resources link to which, and under what conditions.

### Why It Matters

For API designers onboarding to an existing codebase, or reviewing a `defineLinks` call with many resources, a visual state-machine diagram is more scannable than TypeScript source. The HATEOAS BFF example has eight views and twenty-plus link definitions — contributors routinely have to trace the graph manually to understand reachability.

### Direction

A CLI tool (or `debugNavigable`-adjacent utility) that reads a `defineLinks` call and outputs a Mermaid state-machine diagram. Each resource is a node; each link is a directed edge labeled with the link name. This is explicitly a developer-tooling feature — it has no runtime impact and is out of scope for the core library. Could be bundled with the future codegen companion (§6) or shipped as a standalone `typesafe-hypermedia-viz` package.

---

## 13. Unknown-Key Warning for `expandUriTemplate` in Dev Mode

**Priority**: Low value, low effort — **dev-time safety**

### Problem

`expandUriTemplate({ template, schema, values })` silently drops keys in `values` that are not declared in the template. This is RFC 6570-compliant behaviour, but it enables a footgun when a caller spreads a source object of a different schema shape into `values` — the mismatched keys are dropped without any diagnostic. The `feat/bff-showcase` BFF encountered this exact issue when an action-route query was spread into a main-view URL, losing cart and wishlist state silently.

### Direction

In development builds (e.g. when `NODE_ENV !== 'production'`), emit a `console.warn` if `values` contains keys that are not present in the template's variable list after expansion. This gives the developer an immediate signal that they may be spreading the wrong schema, without changing runtime behaviour in production.

---

## 14. Nameable Navigation Return Types

**Priority**: Medium value, medium effort — **type-system DX**

### Problem

`navigate()` returns intersection types built from phantom brands (`Navigable<...>`, `Resource<...>`, `ResolvedLink<...>`) that are not directly nameable in user code. This makes it structurally hard to refactor BFF route handlers into testable helper functions:

```ts
// Author wants to extract this:
async function loadProductDetails(query: QueryState, pimRoot: ???) {
    const category = await navigate(pimRoot, { link: 'categoryUrl', params: { id: query.categoryId } });
    const product = await navigate(category, { link: 'productUrl', params: { sku: query.sku } });
    //       ^^ what type is this? can't name it in the helper signature
    return product;
}
```

Workarounds today:
- `typeof pimRootLocalVariable` — works within one module, breaks across modules.
- Hand-written `type PimRoot = Resource<'root', PimApi>` aliases, repeated per backend — but this only names the *root*, not intermediate navigate results.
- Inline everything in the route handler — what agents actually ended up doing in the `feat/bff-showcase` build. Session logs captured the verbatim giving-up: *"phantom types make extracted function signatures unreadable — keeping the logic inline lets TypeScript infer everything naturally."*

### Why It Matters

BFF code is exactly where route handlers grow beyond one screenful and want to be broken up. If the library's type surface makes extraction impossible, users choose between untyped helpers (`fetch`/`any`), inlined handlers (monolithic), or turning off the types. All three are losses.

### Direction

Explore one or more of:
- **`ResolveResource<typeof root, 'linkName'>`** — a public utility that, given a typed root and a link name, produces the nameable return type of a `navigate()` call. Enables helper signatures like `(product: ResolveResource<PimRoot, 'productUrl'>) => ...`.
- **Exported named return aliases** — generate `PimApi.ProductResource`, `PimApi.CategoryResource`, etc. from `defineLinks` so users can `import { ProductResource } from './pim-api'` and use it directly.
- **Resource-level phantom collapse** — investigate whether the intersection types can be flattened at `defineLinks` time so `navigate()` returns a single nominal type instead of an intersection. May conflict with structural link composition.

The goal: any `navigate()` result should be nameable in a helper parameter with a one-line `import`.

---

## 14. Per-Call `expect` Override — UNDECIDED

**Priority**: Undecided — the current cascade behavior is intentional, this item exists to capture the tradeoff

### Context

Adding an `expect` case to an existing link definition is a **breaking change to every consumer** of that link. The return type flips from `T` to `[T, undefined] | [undefined, Failure]`, and every `navigate()` call site reading fields on the result must be rewritten to destructure the tuple. This is documented in `dev-guide.md` → "Adding `expect` Intentionally Breaks Client Code" and is the chosen design: the type system forces every caller to acknowledge the new failure mode before the code can compile.

The `feat/bff-showcase` round-2 review surfaced a concrete instance: promoting `quoteUrl` to a prone link with `expect: { 404: 'quoteNotFound' }` required simultaneously rewriting `fetchQuotes`, `productDetailView`, and four other call sites in the same commit. The peer reviewer caught a PR where the link was changed but call sites were not — the author had no way to make the change incrementally.

### The Alternative Being Considered

Allow a per-call `expect` at the `navigate()` call site, so prone behavior is opt-in per consumer:

```typescript
// Today: prone-ness is defined once on the link, cascades to all callers
navigate(erpRoot, { link: 'quoteUrl', params: { sku } })
// → [Quote, undefined] | [undefined, { kind: 'quoteNotFound', ... }]

// Proposed: prone-ness opt-in at the call site
const [quote, failure] = await navigate(erpRoot, {
    link: 'quoteUrl',
    params: { sku },
    expect: { 404: 'quoteNotFound' }
});

// Other call sites keep the throwing form
const quote = await navigate(erpRoot, { link: 'quoteUrl', params: { sku } });
```

### Pros

- **Incremental adoption.** A large codebase can add `expect` to one call site at a time. No flag day where every consumer of a link must be rewritten together.
- **Localized error handling.** Some call sites genuinely want to handle the 404 (listing views — drop the unknown SKU and render everything else); others want it to crash loud (admin tools — an unknown SKU is a data integrity bug). Per-call `expect` lets each site express its own semantics without forcing the loudest handler on everyone.
- **Lower cost of "what if this could fail?".** Today, turning a link prone to handle one edge case means auditing every consumer. That friction actively discourages adding `expect` in practice, leading to either swallowed `try/catch` blocks or unchecked failures.
- **Matches how backends evolve.** A 404 case often exists for a long time before any client cares about it. Per-call `expect` lets clients adopt handling as they discover they need it, rather than requiring a coordinated rewrite the moment the server documents the response.

### Cons

- **Erodes the "define once" guarantee.** Today, `defineLinks` is the single source of truth for what a link can fail with. Per-call `expect` scatters that knowledge — a reader has to grep every call site to know the full failure surface of a link.
- **Silent divergence.** Two call sites can disagree on whether the same 404 is expected. One handles it gracefully, the other crashes. Neither is wrong — but the inconsistency is invisible until it bites.
- **Missed failure modes.** The current design's biggest win is that you *cannot forget* to handle a new failure case — the compiler flags every site. Per-call `expect` turns that into opt-in; sites that don't specify `expect` continue throwing, even if the author would have preferred a tuple had they known the case existed.
- **Type-level complexity.** The `navigate()` overload set is already large (§5 Pre-implementation note). Adding an optional `expect` field that *changes the return type shape* from `T` to a tuple would duplicate every overload. May interact poorly with the §5 `data` parameter work if both land.
- **Undermines schema discovery.** Today, hovering over a link in the IDE tells you every failure the server documents. Per-call `expect` means the link definition no longer reflects the full contract; you'd need separate tooling to discover what failure kinds are available to opt into.

### Open Questions

- Could a hybrid exist where `defineLinks` declares the *available* `expect` cases, and `navigate()` opts into a subset? This gets the schema-discovery win back, at the cost of letting one call site ignore failures another handles.
- Does the cascade-cost ever actually outweigh the safety benefit? The motivating example in `feat/bff-showcase` had 6 call sites and was rewritten in one commit — painful but tractable. A 60-call-site codebase might tell a different story. No data yet.
- If we add this, how do we prevent the "silent divergence" con from becoming a lint-level nightmare? A lint rule that flags "this call site ignores an `expect` case another site handles" would help, but requires cross-file analysis.

### Partial Mitigation — Declare `expect: {}` Eagerly

A practical workaround reduces the cascade cost without changing the library: **add an empty `expect: {}` to any link you anticipate might grow failure cases later, even if you don't yet know what they are.** An empty map still flips the return type to the tuple shape, so every call site is forced to destructure `[resource, failure]` from day one. Later, when a concrete failure case is added (`expect: { 404: 'notFound' }`), the mechanical rewrite from `T` to `[T, Failure]` has already happened — the only change at call sites is an added `case 'notFound':` in an already-existing `switch`.

Verified: `expect: {}` typechecks and produces `[Resource, null] | [null, Failure<..., {}>]`, where `failure.kind` narrows to `'unexpected'` (the library-defined reasons: `network`, `uriExpansion`, `unmappedStatus`, `invalidJson`, `invalidStructure`). Adding a declared variant later extends the discriminated union additively.

This doesn't eliminate the pro/con tradeoff above — it shifts it to API design time. You still have to decide *upfront* which links deserve the tuple shape. But it converts "cascading retrofit" into "additive evolution," which is usually the more painful half of the cost.

### Decision

**Undecided.** The current cascade behavior is intentional and has a clear philosophical justification (compile-time exhaustiveness over caller convenience). The eager-`expect: {}` pattern above mitigates most of the practical pain without needing a library change. Revisit the per-call `expect` override if real-world usage surfaces a case where even the eager pattern is insufficient — for example, a large codebase where a link was declared safe early and now needs to grow failure cases across hundreds of consumers.

---

## Non-Goals

These suggestions from external review were evaluated and rejected:

- **Unified `navigate(client, resource, pathOrLink)` function (as proposed in external review)**: The specific proposal — passing a client instance and using runtime type-checking to pick a strategy — was rejected because it exposes the client instance to user code. The underlying concern (the `resolve`/`resolveFrom` split is confusing) was solved differently: a single `navigate(navigable, options?)` function that uses TypeScript overloads (not runtime type-checking) to discriminate single-link auto-resolve from named link mode. See §4 above for the design.
- **Replacing tuple error handling with exceptions**: The tuple pattern for expected errors is intentional — it forces compile-time handling, keeps expected errors as values (not control flow), and maintains type safety that `catch` clauses cannot provide. See `how-it-works.md` §7 for full rationale.
- **"Loose mode" schema validation**: Needs investigation into whether the premise is even valid (TypeBox `Value.Check` does not reject additional properties by default). If validation is already permissive, this is a non-issue.
- **Rehydration utility**: The URL-only state pattern (store URLs, re-fetch on mount) is the correct HATEOAS approach. A `rehydrate()` function would require carrying `originalUrl` and `resourceName` through serialization, at which point re-fetching is simpler and more correct.
