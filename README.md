# typesafe-hypermedia

[![npm version](https://img.shields.io/npm/v/typesafe-hypermedia.svg)](https://www.npmjs.com/package/typesafe-hypermedia)
[![CI](https://github.com/feffef/typesafe-hypermedia/actions/workflows/ci.yml/badge.svg)](https://github.com/feffef/typesafe-hypermedia/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> A fun TypeScript experiment exploring type-safe hypermedia navigation

**typesafe-hypermedia** is a lightweight client for HATEOAS APIs that combines the simplicity of plain JSON with TypeScript's type system. Hydra, Siren, or JSON:API are all supported, but none is *required*.
Just write JSON with links from the server, define the link graph in TypeScript, and get full type safety on the client.

## The Idea 💡

1.  **Define your API** in TypeScript (using TypeBox).
2.  **Server returns plain JSON with links.** Use any format you want — stick to a hypermedia standard or keep it simple.
3.  **Navigate with full type safety** — the type system automatically infers resource types when following links.
4.  **Errors are resources too** — typed, navigable, with recovery links.

## Annotated Example ⚡️

```typescript
import { defineLinks, linkTo, navigate } from 'typesafe-hypermedia';
import { Type } from '@sinclair/typebox';

// 1. Schemas — from an OpenAPI spec, shared package, or TypeBox
const Link       = Type.Object({ href: Type.String() });
const Shop       = Type.Object({ product: Link });
const Product    = Type.Object({
  name: Type.String(), price: Type.Number(),
  order: Type.Optional(Link),  // absent when out of stock
});
const Order      = Type.Object({
  orderId: Type.String(), status: Type.String(),
  products: Type.Array(Link),  // links back to ordered products
});
const OutOfStock = Type.Object({
  message: Type.String(), restock: Link,
});

// 2. Define the link graph between resources
const api = defineLinks(['shop', 'product', 'order', 'outOfStock'], {
  shop: { schema: Shop, links: {
    'product.href': {            
      to: 'product',
      // URI template — clients know param name and type, server controls the URI
      params: { id: Type.Number() },
    },
  }},
  product: { schema: Product, links: {
    'order.href': {
      to: 'order',
      expect: { 409: 'outOfStock' }, // expect: TypeScript enforces error handling
    },
  }},
  order: { schema: Order, links: {
    'products[].href': { to: 'product' }, // 1:n — order links back to ordered products
  }},
  outOfStock: { schema: OutOfStock, links: {
    'restock.href': { to: 'product' },    // error resources have links too
  }},
});

// 3. Navigate — fully typed, all the way down

// Entry point: the only URI your client needs to know
const shopLink = linkTo({ api, resource: 'shop', url: 'https://api.example.com' });
// Returns a plain object matching the Shop schema — no wrappers, no pollution
const shop = await navigate(shopLink);
// shop.product is a link object with a single href — params are validated, return type is inferred
const product = await navigate(shop.product, { params: { id: 42 } });
// Server omits the optional order link when out of stock, TS ensures we must check
if (!product.order) { console.log(`${product.name} is currently out of stock`); return; }

// 4. Error Handling

// The expect on order.href makes navigate return a tuple
const [order, error] = await navigate(product.order);
// TypeScript enforces checking for errors before accessing order
if (error) {
  // Switch on error.kind — error.resource narrows to the matching schema
  switch (error.kind) {
    case 'outOfStock':
      console.log(error.resource.message);
      // Follow-up links on errors can be navigated as well (with full type safety)
      const restocked = await navigate(error.resource.restock);
      console.log(`Notify user that ${restocked.name} needs to be restocked`);
      return;
    // Default branch handles unexpected errors (network, error status, parse errors)
    default:
      // No matter what went wrong, a message is guaranteed to be present
      console.error(error.message);
      return;
  }
} else {
  // Order is guaranteed to be defined now and fully typed
  console.log(order.orderId, order.status);
}
```

## Why typesafe-hypermedia?

*   **Zero Runtime Overhead**: Magic happens in the type system (Phantom Types).
*   **Plain JSON**: Your API responses remain clean and readable.
*   **Framework Agnostic**: Works with any backend (Express, Fastify, etc.).
*   **OpenAPI Compatible**: Schemas are standard TypeBox (JSON Schema).
*   **Errors as First-Class Resources**: Error responses are typed, navigable resources with recovery links — not opaque exceptions.
*   **Focused Scope**: Only handles type safety, URI templates, and link resolution. HTTP concerns are yours to control.

### You Control HTTP Behavior

`typesafe-hypermedia` focuses on hypermedia concerns (types, links, navigation) and intentionally doesn't make assumptions about HTTP. It only expands and follows URIs—it doesn't set a single `fetch()` option.

**All HTTP behavior is yours to implement** via `FetchFactory`:
- Decide HTTP methods based on server metadata, URL patterns, or resource types
- Add authentication based on target resource, server name, or endpoint path
- Include custom headers, request bodies, or any logic you need
- Choose your hypermedia level: fully server-driven, fully client-driven, or hybrid

`FetchFactory<YourApi>` gives you typed context: `navigable` is the union of all link object shapes from your API definition (instead of `any`), and `targetResourceName` is narrowed to valid resource names. Unparameterized `FetchFactory` stays fully backwards compatible.

This design keeps the library focused while giving you complete flexibility over how requests are made. See the [Developer Guide](docs/dev-guide.md) for FetchFactory examples.

### Error Message Verbosity

By default, error messages include full URLs and resource names for debugging. In BFF/API gateway contexts where errors may be forwarded to end users, use `errorVerbosity: 'safe'` to strip internal details:

```typescript
const rootLink = linkTo({
  api: myApiDef,
  resource: 'root',
  url: 'https://internal-api.example.com',
  errorVerbosity: 'safe'  // Sanitizes messages, drops `cause`, replaces `response.headers` with empty Headers; status/statusText/body/reason still flow through
});
```

## Documentation

*   **[Developer Guide](docs/dev-guide.md)**: Getting started and best practices.
*   **[How It Works](docs/how-it-works.md)**: Deep dive into the architecture and design.

## Current Status: Experimental 🧪

This is a proof-of-concept playground.
*   ✅ Full type inference for navigation
*   ✅ URI template expansion
*   ✅ Multi-hop navigation params validation
*   ✅ Typed error resources with discriminated unions

## Installation

```bash
npm install typesafe-hypermedia
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
