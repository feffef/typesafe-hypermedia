# AGENTS.md

This file provides guidance for AI agents working with this repository.

**CRITICAL**: The source code is the SINGLE SOURCE OF TRUTH. Always verify against the actual code in `src/` and `test/`.

**CRITICAL MUST DO**: You **MUST** update `AGENTS.md`, `README.md`, and `docs/how-it-works.md` to be in sync with the code after every implementation, refactoring, or feature addition. It is NOT optional. Using the code as the source of truth does *not* mean you can leave the docs outdated.

**Public API surface** (kept deliberately minimal): `linkTo`, `navigate`, `navigateAll`, `defineLinks`, `expandUriTemplate`, plus the supporting types (`ConnectOptions`, `Resource`, `Navigable`, `LinkSpec`, `FetchFactory`, `FetchContext`, `Failure`, `ResponseInfo`, `Simplify`, `Verbosity`, `ExpandUriTemplateConfig`). Everything else in `src/` is internal. The library is pre-release/experimental — breaking the public API is acceptable when it's the right call; just update docs and examples in the same change.

## Project Structure & Active Files

The library implements a Type-Safe Hypermedia Client (`typesafe-hypermedia`).

### Core Library

*   **`src/type-system.ts`**: **TYPE SYSTEM CORE**. Defines the phantom type system (`Navigable`, `LinkSpec`, `Resource`), public API types (`ConnectOptions`, `RootNavigable`, `LinkedResource`), and helper types.
*   **`src/navigate.ts`**: **PUBLIC API**. Exports `linkTo`, `navigate`, and `navigateAll`. `navigate` supports both single-link auto-resolve mode (when the navigable has exactly one link) and named-link mode (`{ link: 'name' }`).
*   **`src/api-client.ts`**: **CLIENT RUNTIME**. Implements `ApiClient`, responsible for creating entry points, resolving links, and executing fetches. One unified fetch pipeline (`fetchResource`) feeds both safe and prone links: it returns a `{ resource, failure, baseURL }` result covering URI expansion, transport, HTTP status, parse, and validation failures. `resolve` dispatches at the boundary — prone links get a `[resource, failure]` tuple, safe links throw `failureToError(failure, verbosity)` from `error-handling.ts`. Delegates all runtime metadata bookkeeping to `runtime-metadata.ts`.
*   **`src/runtime-metadata.ts`**: **RUNTIME METADATA**. Three module-level `WeakMap`s — `apiClientByNavigable` (navigable → `ApiClient`), `linksByNavigable` (navigable → known links), and `accessorCache` (link-defs → compiled traversal functions). Free functions `rememberLinks`, `rememberEntryPoint`, `recallLink`, and `getOwningClient` operate on them. `KnownLink` is the per-link record. This is the runtime counterpart to `type-system.ts` (compile-time phantom metadata via symbols).
*   **`src/link-definition.ts`**: API Definition & Validation. Contains `defineLinks` and validation logic. Includes a `SchemaResolver` mechanism to dereference `Type.Ref(...)` nodes during link path validation — `defineLinks` accepts an optional `options` object whose `schemas` field can be provided for `$ref` resolution.
*   **`src/fetch-customization.ts`**: Fetch customization. `FetchFactory<Api>`, `FetchContext<Api>` (generic, typed navigable when parameterized), default factory, plus the type-derivation helpers used to compute `navigable`'s type from the API definition.
*   **`src/uri-templates.ts`**: Public utility (`expandUriTemplate`) and internal helper. Exposes `expandUriTemplate` (public API) for BFF servers building self-referential typed URLs, backed by `@hyperjump/uri-template`. Also exports `ExpandUriTemplateConfig<T>` so callers can name the parameter type.
*   **`src/error-handling.ts`**: Typed error handling utilities. Defines the `Failure` discriminated union, the `Failure` builders (`uriExpansionFailure`, `networkFailure`, `unmappedStatusFailure`, `invalidJsonFailure`, `invalidStructureFailure`, `responseFailure`), and `failureToError` — the boundary converter that turns an `'unexpected'` `Failure` back into a thrown JS `Error` for safe-link callers. Each builder formats its own verbosity-aware message inline.

### Tests

Test layout, mocking conventions, the integration-spec routing tree, and the test-quality rules live in the **`testing` skill** (`.claude/skills/testing/SKILL.md`). Load that skill whenever a task touches anything under `test/`. Do not duplicate testing guidance in this file.

### Examples
*   **`examples/petshop-fastify-server.ts`**: Example Fastify server using the public API with plain JSON responses.
*   **`examples/petshop-api.ts`**: Shared schemas and API registry (`PetshopApi`).
*   **`examples/hateoas-bff/`**: Full HATEOAS BFF (Backend-for-Frontend) example with an Alpine.js frontend. **Read `docs/hateoas-bff-example.md` before touching anything under this directory** — it documents the current architecture, view composition, action-route (POST-via-GET) convention, `postToErp` workaround for roadmap §5, and the TODO list of non-library improvements.
    *   `server.ts` — Fastify server setup, static file serving, SPA routing.
    *   `bff-routes.ts` — BFF endpoint logic, state aggregation from PIM/ERP/CRM/DAM backends, cart handling. Routes: one strict `GET /bff` entry (no params, fresh session), eight dedicated per-view routes (`/bff/home`, `/bff/category`, `/bff/product`, `/bff/search`, `/bff/cart`, `/bff/wishlist`, `/bff/orders`, `/bff/order-confirmation`), plus five POST-via-GET action routes. `buildRequestContext` and `assembleResponse` hold the shared setup/tail logic.
    *   `bff-api.ts` — TypeBox schemas for BFF state (`FrontendState`) and API definitions.
    *   `backends/` — Individual backend API definitions and route plugins (PIM, ERP, CRM, DAM).
    *   `public/index.html` — Alpine.js + DaisyUI/Tailwind frontend template. Uses `data-test` attributes for Playwright selectors and `aria-current`/`aria-pressed` for state assertions.
    *   `public/js/app.js` — Alpine.js data component (`app`), browser history management, state fetching.
*   **`test/playwright/hateoas-bff-frontend.spec.ts`**: Playwright browser tests for the BFF frontend (navigation, product details, cart, browser history). Run with `npx playwright test`.

### Documentation
*   **`docs/how-it-works.md`**: Detailed architectural documentation. Includes dedicated sections on Architecture, API Definition, Type System, and Client Runtime.
*   **`docs/dev-guide.md`**: Developer guide with FetchFactory patterns and usage examples.
*   **`docs/hateoas-bff-example.md`**: HATEOAS BFF (Backend-for-Frontend) example and patterns.
*   **`docs/roadmap.md`**: Prioritized DX improvements (debugging utilities, documentation, type safety).
*   **`docs/housekeeping.md`**: Small, non-blocking cleanups surfaced during code reviews — consistency fixes, type-level guards, minor nits to apply when touching the relevant code.

## Core Concepts

1.  **Framework Agnostic**: Core library (`src/`) must remain framework-agnostic (no Express, Fastify, etc.). Uses `fetch` only.
2.  **API Definition**: `defineLinks` validates resource names and link targets at compile-time and runtime.
3.  **Phantom Types**: Uses a **Link Spec** (`LinkSpec`) at the type level to attach metadata (target resource, params, API def) to string properties. This allows "plain JSON" objects to behave as fully typed navigable graphs.
4.  **Hidden Metadata via WeakMaps**: Runtime link data lives in three module-level `WeakMap`s in `runtime-metadata.ts` — `apiClientByNavigable` (navigable → `ApiClient`), `linksByNavigable` (navigable → `Map<string, KnownLink>`), and `accessorCache` (link-defs → compiled traversal functions). Each link gets a `KnownLink` (name, target definition, base URL, href) that the framework keeps alongside the JSON without modifying it. This is `WeakMap` used as TC39 designed it: object-identity-keyed hidden state, with weak references enabling automatic cleanup. Object identity prevents cross-client collisions even though all three maps are module-global; `accessorCache` is intentionally shared across clients of the same API definition. **Caveat**: `accessorCache` requires referentially stable link-definitions objects — top-level `const api = defineLinks(...)` is fine; spreading `{ ...base, ...extra }` inline per call thrashes the cache silently.
5.  **Two Types of Links** (both supported, both proven at scale — pick per API, not dogma):
    *   **Link properties**: String properties containing URIs (e.g., `productsUrl: "/api/products"`) — GitHub/JSON-LD style. Simpler JSON, smaller payloads, but adding metadata later requires awkward parallel properties or a breaking change.
    *   **Link objects**: Objects with an `href` property (e.g., `{ href: "/api/products", title: "Products" }`) — HAL/Siren/JSON:API style. Allows per-link metadata (title, deprecation, type) and evolves cleanly, at the cost of verbose payloads. Each link object has exactly one `href`, so `navigate(linkObj)` always works in single-link mode.
6.  **What is a Navigable** (CRITICAL — get this right or everything else breaks):
    *   **`Navigable<L>`** is any JavaScript object that holds one or more **string properties whose values are URLs** (concrete or URI templates). That single rule is the whole definition. There is no separate "link object kind" — the `{ href: "/pets/1" }` pattern is just the degenerate case where the only URL property is conventionally named `href`. `navigate()` treats it identically to any other navigable; the only difference is that it has exactly one URL property, so single-link auto-resolve always applies.
    *   A Navigable can appear anywhere in the JSON tree: as the root link returned by `linkTo()` (`{ href: "..." }`), as a top-level object returned by `navigate()`, as a nested object (e.g. `shop.actions` with `listPets`/`searchPets` URL properties), as an array element (e.g. `categories[0]` with a `productsUrl` property), or as an embedded "link object" sitting inside a parent (e.g. `shop.products` = `{ href: "/api/products" }`). Same shape, same rules, same `navigate()` call.
    *   **`Resource<N, A>`** is specifically the top-level object returned by `navigate()`. A Resource always *contains* Navigables somewhere in its tree, but is only itself a Navigable if it happens to have URL string properties at its own top level. A Resource whose links live only on nested children (e.g. `resource.actions.listPets`) is not itself navigable — you call `navigate()` on the nested object that holds the links.
    *   **Key design choice**: URL properties can live anywhere in your JSON, not just at the root. This is what makes the library format-agnostic across HAL, JSON:API, GitHub-style, and bespoke shapes.
7.  **Navigation**:
    *   **`navigate(navigable)`** (single-link mode): When the navigable has exactly one link defined, it is resolved automatically. Common with link objects (`{ href: '...' }`) and root navigables.
    *   **`navigate(navigable, { link: 'name' })`** (named link mode): Resolves a named link property. Required when the navigable has multiple links. Use `params` for URI template expansion: `navigate(shop, { link: 'getProduct', params: { id: '123' } })`.
    *   **`navigateAll(links)`**: Convenience helper that resolves an array of single-link navigables in parallel.
    *   All forms work on ANY Navigable — top-level Resources, nested objects, array elements, or embedded link objects.
8.  **Error Handling (Optional)**:
    *   **Safe Links**: Return `Promise<Resource>`. All failures (network, HTTP, parse, schema) throw a JS `Error`.
    *   **Prone Links**: Links with `expect` return `Promise<[Resource, null] | [null, Failure]>`. Pipeline failures never throw — URI expansion errors, transport errors, non-OK responses, JSON parse failures, and schema mismatches are all returned as a `Failure` variant in the tuple. `Failure` is a discriminated union: each declared error resource produces its own `kind` (carrying the parsed typed `resource` and a required `response: ResponseInfo`); the catch-all `kind: 'unexpected'` is sub-discriminated by `reason` into `'uriExpansion' | 'network' | 'unmappedStatus' | 'invalidJson' | 'invalidStructure'`. The `'uriExpansion'` and `'network'` reasons have no `response` field; the other three always do. `ResponseInfo` is `{ status, statusText, headers, body? }` — `headers` is the live `Headers` object so callers can read e.g. `Retry-After`. `'unexpected'` is reserved as a resource name; `defineLinks` rejects it (compile-time and runtime).
9.  **Fetch Factory**: Customizes HTTP behavior (auth, methods, etc.) based on the link context. `FetchFactory<Api>` and `FetchContext<Api>` are generic — when parameterized with a specific API definition, `navigable` is typed as the union of all link object shapes and `targetResourceName` is narrowed to valid resource names. When unparameterized, both fall back to `any`/`string`. **`context.navigable` contains whatever the server returned — there are NO standard properties.** Always use optional chaining (`context.navigable?.method`), even when `FetchFactory<MyApi>` narrows the type, because individual fields are typically optional in the union.
10. **Error Verbosity**: `ConnectOptions.errorVerbosity` controls error message detail. `'verbose'` (default) includes URLs, resource names, and the raw `cause` Error. `'safe'` strips URLs from messages, drops `cause`, and replaces `response.headers` with an empty `Headers()` so server-controlled topology (`Server`, `X-Powered-By`, request IDs) can't leak. `status`, `statusText`, `body`, `kind`, and `reason` always survive — they're either user-declared schema or non-sensitive HTTP facts. Programming errors (e.g. calling `navigate` with an unknown link name) are always verbose — they represent calling-code bugs, not information disclosed to end users.


## Development Philosophy

*   **Test-Driven Development (TDD) is mandatory**: Tests are first-class citizens and primary documentation. Write them first; keep them clean. **All testing details — layout, mocking, the integration-spec routing tree, quality rules — live in the `testing` skill (`.claude/skills/testing/SKILL.md`). Load it before touching anything under `test/`.**
*   **Tests must pass before every commit**: run `npm run typecheck` (uses `tsconfig.typecheck.json`, covers `src/`, `test/`, and `examples/`) and `npm run test:coverage` before creating a commit. There is no shortcut and no `--no-verify`. If your change touches anything under `src/` or `examples/` (library code, routes, schemas, frontend HTML/JS), also run `npm run test:playwright` to catch frontend regressions that Jest cannot see.
*   **100% code coverage is enforced**: All four metrics (statements, branches, functions, lines) must stay at 100%. CI and Jest thresholds both enforce this. When writing new code, design it to be testable — prefer direct calls to `@internal` exports over mocking, avoid untestable dead-code defaults, and keep defensive guards reachable via the test surface.
*   **Type Safety First**: Avoid `as any`. Use type constraints.
*   **Minimal Exports**: Minimize `src/index.ts` exports. Use `@internal` for core classes requiring unit tests.
*   **Dependencies**: Minimal dependencies; NO transitive dependencies.
*   **Keep PR descriptions current**: When pushing to a feature branch that has an open PR, always update the PR title and description to reflect the full scope of changes — not just the latest commit.

## Library Boundaries

The library's job is exactly three things: **type safety**, **URI template expansion**, and **link/resource resolution**. It only resolves URIs — it doesn't set a single option on `fetch()` calls. All HTTP concerns (methods, auth, headers, bodies) are delegated to `FetchFactory`. See Core Concept #9 for the `FetchContext` contract and `docs/dev-guide.md` for patterns.

## Changelog Maintenance

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/). **Every user-visible change to the public API surface, published artifact, or documented behavior MUST land in `CHANGELOG.md` in the same PR as the change** — no separate "changelog PRs".

*   **Where to write**: under the `## [Unreleased]` heading, in the appropriate subsection (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`). Create the subsection if it doesn't exist.
*   **What counts as user-visible**: anything reachable from `src/index.ts`, any behavior change a consumer could observe (error shapes, verbosity defaults, failure `kind`s, link resolution), changes to `package.json` fields that affect consumption (engines, exports, dependencies), or breaking changes to documented types. Internal refactors, test changes, example-only edits, and doc fixes do NOT need an entry.
*   **Breaking changes**: prefix the bullet with `**BREAKING**:` and explain the migration in one sentence. Pre-1.0 breakage is allowed (see public-API note at the top of this file), but it must still be logged.
*   **Style**: one bullet per change, imperative mood, mention the public-API symbol in backticks. Link to the PR via `#123` when useful.

## Release Process

Releases are cut from `main` and publish to npm via `.github/workflows/publish.yml` (triggered by GitHub Release creation, uses `--provenance --access public`).

1.  **Pick the version** per SemVer based on what's in `## [Unreleased]`:
    *   Any `**BREAKING**` bullet → MAJOR (pre-1.0: MINOR is acceptable, but prefer MAJOR once at 1.0).
    *   New `Added` bullets without breakage → MINOR.
    *   Only `Fixed` / `Security` → PATCH.
2.  **Promote the changelog**: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above it, and update the comparison links at the bottom (`[Unreleased]` → `compare/vX.Y.Z...HEAD`, add `[X.Y.Z]` → `releases/tag/vX.Y.Z`).
3.  **Bump the version**: `npm version X.Y.Z` (creates the commit + `vX.Y.Z` tag). Do this in a PR, not directly on `main`.
4.  **Merge the release PR** into `main`.
5.  **Push the tag**: `git push origin vX.Y.Z` (only after the PR merges — the tag must point at the merged commit).
6.  **Cut the GitHub Release** against `vX.Y.Z`. Paste the promoted changelog section as the release notes. Publishing the Release triggers `publish.yml`, which runs typecheck + build + tests, then `npm publish --provenance --access public`.
7.  **Verify**: check npm page for the new version and `npm install typesafe-hypermedia@X.Y.Z` in a scratch project.

**Never publish manually** from a laptop when the workflow is available — provenance attestations only work through the GitHub Actions path. If the workflow is broken, fix the workflow rather than bypassing it.
