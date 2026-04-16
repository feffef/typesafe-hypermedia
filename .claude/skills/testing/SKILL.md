---
name: testing
description: "How to write, run, maintain, and extend tests for typesafe-hypermedia. Covers the test layout, mocking conventions, the integration-test routing tree, and the quality rules that gate every test that lands. Load this whenever you are about to add, modify, or review a test, or when a task touches anything under `test/`."
---

# Testing Guide

This skill is the source of truth for testing in this repo. AGENTS.md only states *that* tests are mandatory and how to run them; *how* to design them lives here.

## Test layout

### Test Utilities
- **`test/mock-responses.ts`**: Centralized mock response utilities. Provides type-safe helpers (`mockResponse`, `mockResponses`, `mockNetworkError`, `mockJsonParseError`, `mockErrorResponse`). **CRITICAL**: All `*.spec.ts` files MUST use these utilities. Never create custom mock helpers and never mock `fetch` directly.
- **`test/test-schemas.ts`**: Shared TypeBox schemas, API definitions, mock data, and setup helpers reused across multiple specs. If you find yourself defining the same schema 3+ times, it belongs here.

### Unit Tests (`test/unit/`)
- **`type-system.test.ts`**: Comprehensive type-system suite — type inference, phantom types, navigable preservation through arrays/nesting, parameter validation, and error-handling types. Pure type-level assertions live here, not in integration tests.
- **`link-definition.test.ts`**: `defineLinks` validation, runtime checks, circular references, link target validation.
- **`uri-templates.test.ts`**: `expandUriTemplate` logic.
- **`runtime-metadata.test.ts`**: `rememberLinks` / `recallLink` / `rememberEntryPoint` / `getOwningClient` — direct unit coverage of the module-level `WeakMap`s in `src/runtime-metadata.ts`. See *Module-level state in `runtime-metadata`* below for the per-test fresh-objects rule that all tests touching this module must follow.

Use unit tests **only** for edge cases of complex internal building blocks. Most logic belongs in integration tests.

### Integration Tests (`test/integration/`)

The `navigate` / `navigateAll` integration suite is split into 10 focused files, one concern per file. **When adding a new test, walk the "Where does my test go?" decision tree at the top of each spec file (first match wins)** — it is the canonical routing rule. If nothing matches, the test probably duplicates existing coverage and is a deletion candidate; flag it at review rather than forcing it into a file.

| File | Scope |
|---|---|
| `navigate-entry.spec.ts` | Bootstrapping (`linkTo` → first `navigate`) and the type of what comes back. |
| `navigate-overloads.spec.ts` | Which `navigate()` overload fires for a correctly-shaped navigable (single-link auto-resolve vs. named link, zero/2+ link reject cases). |
| `link-locations.spec.ts` | Navigables located at interesting positions in the JSON graph (link objects, HAL `_links`, nested string-property links, sibling and optional links inside arrays). |
| `url-resolution.spec.ts` | Final-URL production — params plumbing, URI template expansion (path + query), params schema validation, `baseURL` and cross-host resolution. |
| `error-handling.spec.ts` | How errors *surface* — safe-link throw vs. prone-link tuple, declared/unexpected branches, edge cases, plus consumer patterns (recovery via embedded links, `switch (error.kind)` narrowing). |
| `error-verbosity.spec.ts` | `errorVerbosity: 'safe'` sanitization across every HTTP/fetch error path. |
| `fetch-customization.spec.ts` | `FetchFactory`, `FetchContext`, and the typed-navigable machinery (`AllLinkNavigables`) — runtime plumbing and type-level contracts. |
| `metadata.spec.ts` | Metadata invariants — source-of-truth, JSON serialization (no internal keys, no phantom symbol), spread-copy survival, and union/intersection link schemas. |
| `navigate-all.spec.ts` | `navigateAll()` parallel fan-out and array edge cases (empty, missing optional, partial failure, large fan-out). |
| `runtime-guards.spec.ts` | Programmer-error handling — null/undefined/primitive/plain-object inputs, unknown link or resource names, terminal resources. |

### End-to-End Tests (`test/e2e/`)
- **`petshop-fastify.spec.ts`**: Validates the example server works with `typesafe-hypermedia` against a real server.

E2E tests cover happy paths only. Keep them simple and readable without deep server-implementation knowledge. Edge cases belong in integration tests.

## How to write a new test

### Integration tests (preferred for almost everything)

These verify the library works as a whole (types + runtime + API definition) without the slowness of full E2E tests. Pattern:

1. **Mock with `mockResponse(Schema, data)`** from `test/mock-responses.ts`. Never touch `fetch` directly.
2. **`linkTo`** to create the root navigable.
3. **`navigate` / `navigateAll`** to follow links.
4. **Assert on returned data AND types**. For type assertions, assign to a typed variable (`const r: Resource<'pet', Api> = ...`) — if it compiles, the type is right. Use `expectType` helpers if available.
5. **Reuse fixtures**: pull repeated schemas/setup from `test/test-schemas.ts`. If you're inventing a new shared shape, add it there.

### Type-system tests

Pure compile-time correctness lives in `test/unit/type-system.test.ts`. Use `@ts-expect-error` extensively to verify type-system constraints. Don't verify type behavior with runtime fetches in integration tests when a static assignment would do.

### Mocking & integrity

- **Schema validation**: tests should verify the library throws correct errors when the server response violates the schema.
- **Runtime integrity**: verify that manual tampering (e.g. `as any`) is caught by runtime checks where appropriate to prevent crashes.

## Module-level state in `runtime-metadata`

`src/runtime-metadata.ts` holds three module-level `WeakMap`s (`apiClientByNavigable`, `linksByNavigable`, `accessorCache`) that store all of the framework's runtime metadata. Tests that exercise `navigate`, `recallLink`, `rememberLinks`, `rememberEntryPoint`, or any path through `runtime-metadata.ts` must follow these rules:

- **Per-test fresh objects.** Each test that puts a navigable through `rememberLinks` / `rememberEntryPoint` should construct a new object literal (or call a factory) within the test body. Do not share navigable objects between cases.
- **No shared module-level fixtures.** A constant like `const FIXTURE_NAV = { href: '/x' }` exported from `test/test-schemas.ts` is dangerous: Test 1's `rememberLinks` call leaves entries in the module-level `WeakMap`s that Test 2 will see. If a fixture is needed, expose it as a *factory function* that returns a fresh object on each call (`makeFixtureNav()`).
- **No `clearForTesting()` is provided.** `WeakMap` has no `clear()` method by design, and the discipline above is sufficient to prevent pollution. Adding a hidden test-only escape hatch would be an anti-pattern dressed up as a fix.
- **`accessorCache`** is keyed by link-definition object references, not navigables, so it's polluted only by tests that share those objects across cases — same rule applies, just at a different key type. Top-level `const api = defineLinks(...)` is fine; building merged definitions inline per test case is not.

## Test quality rules (enforce strictly)

1. **One test per branch** — Don't write multiple tests for the same code path. Testing string/number/array/union schemas separately is redundant. Pick one representative case.
2. **No redundant success tests** — If 40+ tests already call a function successfully, don't add another "verify it works" test. It adds zero value.
3. **Question hard-to-test code** — If code is nearly impossible to test without mocking internals, that's a smell:
   - Remove defensive code (prefer failing loudly over silent handling)
   - Simplify it (e.g., `String(error)` vs. ternary for error type checking)
   - Or accept it won't be tested and document why
4. **Type constraints over runtime checks** — Use TypeScript constraints (`T extends TObject`) to prevent misuse at compile time, not runtime validation with tests for unreachable branches.
5. **Value over volume** — 100 meaningful tests > 200 tests with 50% redundancy. High coverage with fewer tests is better.
6. **Don't codify bad behavior** — If you encounter questionable/confusing behavior while writing tests, DON'T add a test to verify "this is how it currently works". Raise it as an issue and fix it. Nothing is released yet — the campground rule applies to ALL code and APIs. Leave it better than you found it.
7. **Reuse test schemas and setup** — Extract repetitive schemas, API definitions, and setup code to `test/test-schemas.ts` (or create new shared files). Makes the actual test logic obvious and reduces noise.
8. **Group related tests with shared setup** — Use `describe` blocks to group related tests and share declarations/setup within the block. The concatenation of `describe + it` should read as clear documentation: "defineLinks validation should throw for invalid link paths". Avoid generic names like "should work correctly" — be specific.
9. **Right assertions over coverage** — Coverage is not the most important thing — the right assertions are. When you see uncovered lines, think hard about which behavior they control and how to test it meaningfully. A test that increases coverage from 85% to 90% but only checks `.toThrow()` without verifying error details is worthless. Verify the actual behavior: check error messages contain all expected details, verify state changes, assert return values match expectations. Better to have 85% coverage with strong assertions than 95% coverage with weak ones.

## Maintaining and extending the integration split

- **Adding a test**: walk the routing tree at the top of the relevant spec file. First match wins. If nothing matches, the test is probably redundant.
- **Adding a fixture used by 2+ files**: put it in `test/test-schemas.ts`. Nothing else crosses file boundaries.
- **Renaming or relocating tests**: keep the `describe + it` concatenation reading as prose — it is the documentation.
- **Inline comments**: when a test guards a regression, a subtle branch, or a non-obvious design decision, add a 1–3 line comment above the `it(...)` capturing the *why*. Skip comments when the test name says everything.
- **The routing tree must travel with the code** — if you create a new integration spec file, copy the decision tree into its header comment so the rules don't drift.

## Running tests

- `npm test` — full suite
- `npm run test:coverage` — full suite with coverage
- `npm run test:coverage:unit` — unit only
- `npm run test:coverage:integration` — integration only
- `npm run test:coverage:e2e` — e2e only
- `npx jest <path-or-pattern>` — run a single file or filter by name

Tests must pass before every commit. There is no CI shortcut around this.
