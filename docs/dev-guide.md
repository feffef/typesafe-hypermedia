# Developer Guide: Building with `typesafe-hypermedia`

Welcome to `typesafe-hypermedia`, a framework for building type-safe Hypermedia APIs in TypeScript. This guide distills practical experience from building real-world examples (like the HATEOAS BFF) into actionable advice.

## 🚀 Quick Start in 3 Steps

### 1. Define links between resources
Think of your API as a state machine. Define resources and the links between them.
```typescript
import { defineLinks } from 'typesafe-hypermedia';
import { Type } from '@sinclair/typebox';

export const myApiDef = defineLinks(['root', 'product'], {
    root: {
        schema: Type.Object({
            welcomeMessage: Type.String(),
            productsUrl: Type.String() // <--- "Natural" String Link
        }),
        links: {
            // Map the string property to a target resource
            'productsUrl': { to: 'product' }
        }
    },
    product: {
        schema: Type.Object({ id: Type.String(), name: Type.String() }),
        links: {}
    }
});
```

### 2. Create a link to the API root
Create a navigable link to start from.
```typescript
import { linkTo } from 'typesafe-hypermedia';

const rootLink = linkTo({
    api: myApiDef,
    resource: 'root',
    url: 'http://localhost:3000/api'
});
```

### 3. Navigate the graph
Use `navigate` to follow links and `navigateAll` for parallel fetches.
```typescript
import { navigate, navigateAll } from 'typesafe-hypermedia';

// Fetch the root resource — rootLink is a single-link navigable, so navigate auto-resolves it
const root = await navigate(rootLink);

// root has multiple links (productsUrl, usersUrl, ...) — pick one by name
const products = await navigate(root, { link: 'productsUrl' });

// navigateAll resolves an array of single-link navigables in parallel
const allProducts = await navigateAll(root.productLinks);
```

**The mental model**: a *navigable* is any object that contains link properties.

- If the navigable has **exactly one link** → `navigate(navigable)` auto-resolves it.
- If the navigable has **multiple links** → `navigate(navigable, { link: 'name' })` to pick one.
- For URI templates with parameters → pass `params` (the `link` option is only required if the navigable also has multiple links).

**Why `navigateAll`?** TypeScript's overload resolution doesn't work correctly with `.map(navigate)` on arrays of Navigables. The type inference fails because the compiler can't determine which overload to use in a mapped context. Use `navigateAll(array)` or the more verbose `.map(nav => navigate(nav))` for proper type safety.

---

## Naming Your API Type with `Simplify`

When you call `defineLinks(...)`, TypeScript infers a deeply nested structural type. IDE hovers show this in full — which is useful for small APIs but unreadable for larger ones. If you want a clean, named type that collapses in tooltips, use the `Simplify` utility with the 3-line pattern:

```typescript
import { defineLinks, Simplify } from 'typesafe-hypermedia';

const apiDef = defineLinks(['root', 'product'], { /* ... */ });
export interface MyApi extends Simplify<typeof apiDef> {}
export const myApi: MyApi = apiDef;
```

`apiDef` is an internal variable whose type drives the interface. `MyApi` is the named type you use in annotations like `FetchFactory<MyApi>` or `Resource<'root', MyApi>`. `myApi` is the runtime value you pass to `linkTo()` — the `: MyApi` annotation anchors it to the named interface so all downstream inferred types (from `navigate()`, `linkTo()`, etc.) display `MyApi` in IDE tooltips instead of the full structural expansion.

### Why this works

TypeScript displays `interface` names as-is in hovers, but expands `type` aliases transparently. So `type MyApi = typeof myApi` would still show the full expansion — only `interface extends` collapses it.

The catch: `typeof` can't appear directly in an `extends` clause (`interface X extends typeof y` is a syntax error). But it *can* appear inside a generic type argument. `Simplify<T>` is `{ [K in keyof T]: T[K] }` — a mapped identity type that resolves to an object type, which interfaces *can* extend.

The `: MyApi` annotation on the exported const is essential. Without it, `typeof myApi` is the raw `defineLinks` return type, and TypeScript has no named type to reference — every tooltip expands the full API schema inline.

### When you need it

- **Exporting an API for consumers** — use `Simplify` so downstream code sees `PetshopApi` rather than a 50-line structural type.
- **`FetchFactory<MyApi>`** — the named type reads better in signatures.
- **Cross-file type references** — named interfaces are easier to import and reason about.

### When you don't

- **Tests and local definitions** — if the API definition is local to a file and nobody hovers over it, the raw `defineLinks` return is fine.
- **Simple APIs with 1-2 resources** — the inferred type is already readable.

---

## 🎨 Choosing Your Link Style

`typesafe-hypermedia` supports two link representations that reflect real-world hypermedia API design patterns. Both work at massive scale in production.

### Link Objects (HAL, JSON:API, Siren style)

**Example:**
```json
{
  "name": "Pet Store",
  "products": { "href": "/api/products" },
  "search": { "href": "/api/search{?q}", "title": "Search Products" }
}
```

**Client code:**
```typescript
// shop.products is a link object with a single href — auto-resolves
const products = await navigate(shop.products);
```

**Used by:** 7 out of 9 major hypermedia specifications (HAL, Siren, JSON:API, Collection+JSON, UBER, Mason, JSON Home)

**Tradeoffs:**
- ✅ Can include metadata (title, type, deprecation, description)
- ✅ Add metadata later without breaking changes
- ✅ Clear distinction when grouped (`_links`, `actions`)
- ✅ Single-link auto-resolve — no need to name the link
- ❌ More verbose JSON (nested objects)
- ❌ Extra payload bytes per link

### String Properties (GitHub, JSON-LD style)

**Example:**
```json
{
  "name": "Pet Store",
  "productsUrl": "/api/products",
  "searchUrl": "/api/search{?q}"
}
```

**Client code:**
```typescript
// shop has multiple link properties — name the link explicitly
const products = await navigate(shop, { link: 'productsUrl' });
```

**Used by:** GitHub API (one of the world's most-used APIs serving millions of developers), JSON-LD/Hydra

**Tradeoffs:**
- ✅ Simpler, lighter JSON (direct strings)
- ✅ Smaller payloads
- ✅ Familiar pattern (URL fields are common in non-hypermedia APIs)
- ❌ Can't add metadata without awkward parallel properties or breaking changes
- ❌ Requires explicit `{ link: 'name' }` when the navigable has multiple links
- ❌ Less standard in formal hypermedia specs

### Decision Guide

**Choose Link Objects when:**
- You might need metadata on links (titles, deprecation notices, type hints)
- You want room to evolve without breaking changes
- You're following hypermedia specifications (HAL, JSON:API, etc.)
- Payload size isn't critical

**Choose String Properties when:**
- You're certain links won't need metadata
- Payload size is critical (mobile, IoT, high-volume APIs)
- You're integrating with existing patterns that use URL fields
- You prefer minimal JSON structure

**Real-world insight:** Both patterns prove successful at scale. HAL powers numerous production APIs with link objects. GitHub serves millions with string properties. JSON:API explicitly supports both. Choose based on your requirements, not ideology.

---

## 💡 Key Concepts & Best Practices

### Understanding "Navigable" Objects

A **Navigable** is any object that contains one or more link properties. That's the entire mental model.

**CRITICAL: Navigable ≠ Resource**
- **`Navigable`**: ANY object with link properties — can be nested anywhere in the JSON (top-level, nested objects, array elements, link objects)
- **`Resource`**: Specifically what `navigate()` returns when you fetch a top-level resource — always a Navigable, but not all Navigables are Resources

**Key design choice:** Link properties can live ANYWHERE in your JSON structure, not just at the root. This is what makes `typesafe-hypermedia` flexible.

**Two link styles:**
- **Link objects**: Objects with a single `href` property (e.g., `{ href: "/api/products", title: "Products" }`) — the link object *itself* is the navigable
- **Link properties on a parent**: String properties containing URIs (e.g., `{ productsUrl: "/api/products", usersUrl: "/api/users" }`) — the parent object is the navigable

**One function, two modes:**
- **Single-link auto-resolve**: when the navigable has exactly one link → `navigate(navigable)`
- **Named link mode**: when the navigable has multiple links → `navigate(navigable, { link: 'name' })`

You only need to specify `{ link: 'name' }` when the navigable has more than one link to choose from. URI template parameters are passed via `params` (and `link` is only required if the navigable also has multiple links).

In practice, a Navigable can take three different forms:

#### 1. Root Navigable
The object returned by `linkTo()` — a single-link navigable pointing at the API root:
```typescript
const rootLink = linkTo({ api: myApiDef, resource: 'root', url: 'http://api.example.com' });
// rootLink = { href: "http://api.example.com" }  // single link → auto-resolves

const root = await navigate(rootLink);
```

#### 2. Link Objects (Embedded Links)
Objects with a single `href` property embedded within resources, typically in arrays:
```typescript
const catalog = await navigate(root, { link: 'productsUrl' });
// catalog.products = [
//   { href: "/products/1", title: "Widget" },
//   { href: "/products/2", title: "Gadget" }
// ]

// Each element is a single-link navigable — auto-resolves
const product = await navigate(catalog.products[0]);
```

#### 3. Objects with Multiple Link Properties
**Key insight:** Any object with link properties is Navigable — can be top-level Resources, nested objects, or array elements!

```typescript
const shop = await navigate(apiRoot);
// shop = {
//   id: "shop-1",
//   name: "Pet Store",
//   actions: {                           // ← Navigable nested object with two links
//     listPets: "/api/pets",
//     searchPets: "/api/search{?q}"
//   },
//   categories: [                        // ← Array of single-link navigables
//     { name: "Dogs", productsUrl: "/api/categories/dogs" },
//     { name: "Cats", productsUrl: "/api/categories/cats" }
//   ]
// }

// shop.actions has two links — name the one you want
const pets = await navigate(shop.actions, { link: 'listPets' });
const matches = await navigate(shop.actions, { link: 'searchPets', params: { q: 'corgi' } });

// Each category has only one link — auto-resolves
const dogProducts = await navigate(shop.categories[0]);
```

**The Link Object Model**

If you use **link objects with `href` everywhere**, every navigable has exactly one link, and you never need to use `{ link: 'name' }`:

```typescript
// Link object approach (like the petshop example)
const root = await navigate(apiRoot);
// root.actions = {
//   listPets: { href: "/pets" },
//   searchPets: { href: "/pets{?q}" }
// }
//
// root.actions.listPets is a link object with a single href — auto-resolves
const catalog = await navigate(root.actions.listPets);

// catalog.pets = [
//   { href: "/pets/1", title: "Fido" },
//   { href: "/pets/2", title: "Whiskers" }
// ]
//
// Each pet is also a single-link navigable:
const pet = await navigate(catalog.pets[0]);
```

This trades payload size for a uniform navigation pattern. See "Choosing Your Link Style" above for the full tradeoff analysis.

### Flexibility: Links Can Live Anywhere

**`typesafe-hypermedia` is format-agnostic** - it gives you the flexibility to follow any link in any location of a JSON document, regardless of media type conventions.

**HAL-style (links in `_links`):**
```json
{
  "name": "Widget",
  "_links": {
    "self": { "href": "/products/1" },
    "reviews": { "href": "/products/1/reviews" }
  }
}
```

**Links as direct properties:**
```json
{
  "name": "Widget",
  "self": { "href": "/products/1" },
  "reviews": { "href": "/products/1/reviews" }
}
```

**Links as simple strings:**
```json
{
  "name": "Widget",
  "selfUrl": "/products/1",
  "reviewsUrl": "/products/1/reviews"
}
```

All of these work with `typesafe-hypermedia`. You define where links live in your API definition, and the library handles the rest.

**Pro tip:** Using link objects with an `href` property (second example) keeps your code simpler — every navigable has exactly one link, so single-link auto-resolve always works and you never need `{ link: 'name' }`. See "Understanding Navigable Objects" above.

---

## ⚠️ Pitfalls & Gotchas

### 1. Strict Validation
`typesafe-hypermedia` validates responses against your TypeBox schemas at runtime.
*   **Gotcha:** If your backend returns extra fields or missing fields, the client will **throw an error**.
*   **Fix:** Ensure your schemas exactly match your payload. Use `Type.Optional()` liberally if data is sporadic.

### 2. API Definitions Should Be Referentially Stable

The framework caches compiled link-path traversal functions in a `WeakMap` keyed by the link-definitions object on each `ResourceDefinition`. Definitions declared once at module scope (the normal case — `const api = defineLinks(...)`) benefit from this cache: each link-path is compiled once and reused on every fetch of that resource type.

Definitions constructed dynamically per call — e.g. spreading partial definitions together inline like `{ ...baseLinks, ...extraLinks }` — produce a new object reference each time and thrash the cache silently. There is no warning; just slower first traversals. If you need conditional or merged link sets, build the merged definition once and reuse the reference.

### 3. `expandUriTemplate` Silently Drops Unknown Values

`expandUriTemplate({ template, schema, values })` is intentionally tolerant: it expands whatever variables the template declares and ignores any extra keys in `values`. This is RFC 6570 compliance (unknown variables are simply not emitted), but it enables a subtle footgun when you use the spread operator to build `values`:

```typescript
// QuerySchema has { view, category, sku, ... } — no qty field
const url = expandUriTemplate({
    template: '/bff{?view,category,sku}',
    schema: QuerySchema,
    values: { ...req.query, view: 'cart' }  // ← req.query is a *different* schema
});
```

If `req.query` comes from a different schema (e.g., an action route with `{ sku, qty, cart }`), the extra keys are silently dropped. The URL is "correct" in the sense that it matches the template — but it silently loses state you thought you were carrying through. FINDING-06 in the `hateoas-bff` round-2 review was exactly this: an `add-to-cart` handler was spreading an action-route query into a main-view URL, and nothing flagged the mismatch until someone audited the redirect chain.

**Fix:** Prefer explicit field picks over spreads when building values for `expandUriTemplate`. If you know the template wants `{ cart, sku, title, message }`, write those four fields out by name. The spread pattern is fine when the source *is* the same schema (e.g., `updatedStateUrl(query, { sort: 'price' })` where `query` is already `QueryState`), but mixing schemas through `{ ...otherSchema, ...overrides }` is where the silent drop bites.

A future library feature may warn on unknown keys in development builds — see if that would have caught your bug before adopting spreads.

### 4. Type Inference Limits
If you have a massive Union type (like a "God Object" with 20 possible views), TypeScript's inference for `navigate` might bail out or return `any`.
*   **Workaround:** Explicitly type your variables if needed, or cast when you are certain of the flow.
```typescript
const cartPage = await navigate(productPage, { link: 'addToCartUrl' }) as CartView;
```

---

## 🚨 Error Handling

### When to Add `expect` to a Link Definition

Add `expect` when the server returns **structured, typed JSON error responses** that your client code should handle — not just HTTP status codes, but actual error resources with fields, messages, and ideally recovery links.

**Use `expect` when ALL of these are true:**
1. The server returns **controlled JSON output** for certain error status codes (not generic 500s)
2. That JSON is **worth handling** — it contains actionable information (validation details, business reasons, alternatives)
3. Ideally, the error response contains **links for follow-up actions** (retry, search alternatives, go back)

**Good candidates for `expect`:**
- **Business operation failures**: "Out of stock" with a link to similar products, "Insufficient funds" with a link to top-up
- **Validation errors**: Server returns structured field-level errors the UI can render
- **Not-found with alternatives**: "Product not found" with a link to search results or suggestions
- **Conflict resolution**: "Version conflict" with a link to the latest version

**Don't use `expect` for:**
- **Server-controlled links**: Links embedded in successful responses (e.g., `catalog.pets[]`) — the server gave you these links, they work
- **Generic server errors**: If the server just returns `500 Internal Server Error` with no useful body, there's nothing to type
- **Network failures**: These are truly exceptional — `try/catch` is the right tool

### Adding `expect` Intentionally Breaks Client Code

This is a feature, not a bug. When you add `expect` to a link definition, the return type of `navigate()` changes:

```typescript
// Before: safe link — returns the resource directly
const order = await navigate(product.order);
//    ^? Resource<"order">

// After adding expect: { 409: 'outOfStock' }
// This line now has a type error — navigate() returns a tuple
const order = await navigate(product.order);
//    ^? [Resource<"order">, null] | [null, Failure]
// TS Error: Property 'orderId' does not exist on type '[Resource<"order">, null] | [null, Failure]'
```

You are **forced** to refactor the call site to destructure the tuple and handle the error:

```typescript
const [order, error] = await navigate(product.order);

if (!order) {
    switch (error.kind) {
        case 'outOfStock':
            return navigate(error.resource.alternativesLink);
        default:
            console.error(error.message);
            return null;
    }
}

// Now 'order' is narrowed to Resource<"order">
console.log(order.orderId);
```

This means you can **safely evolve your API definition** by adding `expect` to links that previously didn't have it. The TypeScript compiler will flag every call site that needs updating — no error path goes silently unhandled.

### Tip: Declare `expect: {}` Eagerly for Links You Expect Will Grow

The "adding `expect` breaks callers" behavior is intentional, but the cost is paid at the worst moment — right when you've discovered a new failure case and need to ship a handler. You can frontload that cost at API design time by adding an **empty** `expect: {}` to any link you think might grow failure cases later, even before you know what they are:

```typescript
defineLinks(['root', 'order'], {
    root: {
        schema: Type.Object({ createOrderUrl: Type.String() }),
        links: {
            createOrderUrl: {
                to: 'order',
                params: { sku: Type.String() },
                expect: {}  // No declared failures yet, but forces tuple shape
            }
        }
    },
    // ...
});
```

An empty `expect: {}` still flips the return type of `navigate()` to a tuple, so every call site destructures `[order, failure]` from day one:

```typescript
const [order, failure] = await navigate(root, {
    link: 'createOrderUrl',
    params: { sku: 'PROD-001' }
});

if (failure) {
    // failure.kind is 'unexpected' — the library-defined catch-all
    // (network / uriExpansion / unmappedStatus / invalidJson / invalidStructure)
    console.error(failure.message);
    return;
}

console.log(order.orderId);
```

Later, when you discover the server returns a structured `409 Conflict` for duplicate orders, adding `expect: { 409: 'duplicateOrder' }` is a **purely additive** change at call sites: the tuple shape is already there, the `if (failure)` guard is already there, you just add a `case 'duplicateOrder':` branch to the switch (or keep the generic `failure.message` handler if that's still enough).

**When to use this pattern:**
- Links on POST/PUT/PATCH actions — server-side validation, conflict, and business-rule failures are common and tend to be discovered incrementally
- Links where the server is still evolving — you suspect failure responses will grow
- Links whose consumers are numerous or spread across modules — the cascade cost scales with consumer count

**When not to use it:**
- Links where a failure is truly exceptional (internal root discovery, self-links) — adding `expect: {}` just forces ceremonial destructuring on call sites that have nothing useful to do on failure
- Small codebases where rewriting a handful of call sites is cheap — the eager pattern has a cost of its own (every caller writes `if (failure) ...`), and for 3-4 call sites it may not pay for itself

This is a design-time decision, not a library feature — the library behavior is exactly the same as declaring any other `expect` map. The pattern is just recognising that **empty-but-present** is a useful middle ground between "safe link, throws on anything" and "prone link, declare every failure upfront."

### Type-Safe Error Handling with Discriminated Unions

When a link has `expect`, it returns a tuple: `[Resource, null] | [null, Failure]`. `Failure` is a discriminated union — `switch` on its `kind` field for type-safe narrowing:

```typescript
import { navigate } from 'typesafe-hypermedia';

// Link definition with expect:
// links: {
//   'searchUrl': {
//     to: 'searchResults',
//     params: SearchParamsSchema,
//     expect: { 404: 'notFound', 400: 'validationError' }
//   }
// }

// root has multiple links — name the templated one and pass params
const [results, error] = await navigate(root, {
    link: 'searchUrl',
    params: { query: userInput }
});

if (!results) {
    switch (error.kind) {
        case 'notFound':
            console.log(error.resource.message); // Typed as NotFoundResource
            // Error resources can have recovery links!
            return navigate(error.resource.suggestionsLink);

        case 'validationError':
            error.resource.errors.forEach(e => showFieldError(e.field, e.message));
            return null;

        case 'unexpected':
            // Sub-discriminate by `reason` to find out which step failed.
            // The 'network' branch has no `response`; the others always do.
            if (error.reason === 'network') {
                console.error('Offline:', error.message);
            } else {
                // error.response: { status, statusText, headers, body? }
                const retryAfter = error.response.headers.get('retry-after');
                console.error(`HTTP ${error.response.status} (${error.reason}):`, error.message, { retryAfter });
            }
            return null;
    }
}

// Happy path - results is typed correctly
console.log(results.items);
```

### Error Resource Recovery Links

Error resources are just regular resources - they can have links too! This enables "recovery patterns":

```typescript
const ErrorResourceSchema = Type.Object({
    message: Type.String(),
    suggestionsLink: Type.String(),      // Link to alternative results
    homeLink: Type.String()              // Link back to home
});

// In your API definition:
{
    notFound: {
        schema: ErrorResourceSchema,
        links: {
            'suggestionsLink': { to: 'searchResults' },
            'homeLink': { to: 'home' }
        }
    }
}
```

Error resources get their links hydrated automatically, allowing users to navigate out of error states seamlessly.

### Concise Error Handling

You don't have to handle each error kind separately. Every variant — expected and unexpected — has a `message` field, so the simplest valid error handling is:

```typescript
const [results, error] = await navigate(root, {
    link: 'searchUrl',
    params: { query: userInput }
});

if (!results) {
    console.error(error.message);
    return null;
}
```

You can add a `switch` on the `kind` field later as your error handling matures — the compiler won't force you to handle each kind individually, only to acknowledge the tuple.

---

## 🔧 Custom HTTP Behavior with FetchFactory

### Motivation: Why FetchFactory?

`typesafe-hypermedia` focuses on three core concerns:
- **Type safety** - ensuring resources match their schemas
- **URI template expansion** - resolving templated links with parameters
- **Link/resource resolution** - navigating the hypermedia graph

The library intentionally does NOT guess what's required at the HTTP level to make successful requests. It doesn't know whether a link needs POST vs GET, what authentication headers are required, or what request body to send.

**By design, the library only expands and follows URIs** - it doesn't set a single option on `fetch()` calls. Everything else is delegated to your `FetchFactory`, keeping the library focused on hypermedia concerns rather than HTTP concerns.

The default fetch factory only supports GET requests. For custom HTTP methods, authentication, headers, or request bodies, provide a custom `FetchFactory` to `linkTo()`.

**FetchFactory is YOUR code** - implement whatever logic makes sense for your API. You can:
- Read HTTP metadata from server responses (if your API provides it)
- Decide HTTP method based on URL patterns or target resource type
- Add authentication based on server name, resource type, or endpoint path
- Implement any custom logic you need

The approach you choose depends on what level of hypermedia information your server provides.

### Approach 1: Client-Side Logic Based on Context

Implement HTTP behavior based on the context information (URL, resource type, etc.):

```typescript
import { linkTo, FetchFactory } from 'typesafe-hypermedia';
import { MyApi } from './my-api'; // your exported API type

const contextBasedFactory: FetchFactory<MyApi> = (context) => {
    return async (url: string) => {
        // Decide method based on URL pattern
        const method = url.includes('/search') ? 'GET' :
                      url.includes('/delete') ? 'DELETE' :
                      url.includes('/create') ? 'POST' : 'GET';

        // Add auth based on target resource type
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (context.targetResourceName === 'admin') {
            headers['Authorization'] = `Bearer ${getAdminToken()}`;
        } else if (context.targetResourceName === 'user') {
            headers['Authorization'] = `Bearer ${getUserToken()}`;
        }

        return fetch(url, { method, headers });
    };
};

const rootLink = linkTo({
    api: myApiDef,
    resource: 'root',
    url: 'https://api.example.com',
    fetchFactory: contextBasedFactory
});
```

### Approach 2: Server-Driven HTTP Metadata

If your API includes HTTP metadata in responses, you can read it from `context.navigable`:

```typescript
import { FetchFactory } from 'typesafe-hypermedia';
import { MyApi } from './my-api'; // your exported API type

// Server returns links with HTTP metadata:
{
  "name": "Pet Store",
  "actions": {
    "createPet": {
      "href": "/pets",
      "method": "POST",        // ← Server specifies the method
      "template": {            // ← Server provides body template
        "name": "",
        "species": ""
      }
    }
  }
}

// FetchFactory reads server-provided metadata:
const serverDrivenFactory: FetchFactory<MyApi> = (context) => {
    return async (url: string) => {
        // Read from server response (with defaults if not provided)
        const method = context.navigable?.method || 'GET';
        const bodyTemplate = context.navigable?.template;

        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            }
        };

        if (bodyTemplate && method !== 'GET') {
            options.body = JSON.stringify(bodyTemplate);
        }

        return fetch(url, options);
    };
};
```

**Note:** If you include properties like `method` or `template` in your server responses, you MUST define them in your TypeBox schemas so they're validated and type-checked.

### Approach 3: Hybrid - Combine Both

Mix server-driven and client-side logic where it makes sense:

```typescript
import { FetchFactory } from 'typesafe-hypermedia';
import { MyApi } from './my-api'; // your exported API type

const hybridFactory: FetchFactory<MyApi> = (context) => {
    return async (url: string) => {
        // Use server-provided method if available, otherwise infer from URL
        const method = context.navigable?.method ||
                      (url.includes('/create') ? 'POST' : 'GET');

        // Client decides auth strategy based on resource type
        const token = context.targetResourceName === 'admin'
            ? getAdminToken()
            : getPublicToken();

        // Server can provide custom confirmation requirements
        if (context.navigable?.requiresConfirmation) {
            const message = context.navigable?.confirmationMessage || 'Are you sure?';
            if (!confirm(message)) {
                throw new Error('Operation cancelled by user');
            }
        }

        return fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
    };
};
```

### Key Principles

1. **You control the logic** - FetchFactory is your code; implement whatever makes sense for your use case
2. **`context.navigable` contains the current link object** - it has whatever properties your server included (or none)
3. **`context.targetResourceName` tells you the resource type** - useful for resource-based decisions
4. **Always use optional chaining** - `context.navigable?.property` since properties only exist if the server included them
5. **Choose your hypermedia level** - fully client-driven, fully server-driven, or hybrid

**See:** `test/integration/navigate.spec.ts` Section 5 for comprehensive examples of custom fetch patterns.

---

## 🛠 Areas for Improvement (DX Feedback)

Based on developer experience, here are areas where `typesafe-hypermedia` could evolve:

1.  **"Loose Mode" Validation**: Currently, validation failures are fatal. A "warn-only" mode would be helpful for production resilience or rapid prototyping.
2.  **Schema Generation**: Writing TypeBox schemas manually is tedious. Tooling to generate them from existing JSON responses or OpenAPI specs would be a huge win.
3.  **Link Visualization**: A CLI tool that reads `defineLinks` and outputs a Mermaid diagram of the state machine would help visualize complex flows.
4.  **Mutations Require Bypassing `navigate()`**: Any POST/PUT/PATCH with a request body today falls out of the typesafe-hypermedia pipeline — you end up writing `fetch(url, { method: 'POST', body: JSON.stringify(...) })` by hand, losing URL resolution, body schema validation, and response typing in one shot. The `feat/bff-showcase` example had to introduce a `postToErp()` helper for exactly this reason. Tracked as roadmap §5 "Client-Provided Request Data".
5.  **Return Types of `navigate()` Cannot Be Named**: `navigate()` return types are unnamed intersection types over `Navigable<...>` / `Resource<...>` phantom brands. Extracting route logic into a module-level helper forces you to either (a) accept `typeof someLocalVariable` parameters (which doesn't cross module boundaries), or (b) re-declare `Resource<'root', MyApi>` aliases at every call site — and even then, intermediate `navigate()` results have no expressible signature. This blocks normal refactoring hygiene in BFF code. Tracked as roadmap §13 "Nameable Navigation Return Types".

---

*Happy Hacking with Hypermedia!*
