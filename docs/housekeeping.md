# Housekeeping

Small, non-blocking improvements surfaced during code reviews. These are not bugs or features — they are consistency fixes, type-level guards, and minor cleanups that should be applied when the relevant code is next touched, or as a batch cleanup.

---

## 1. Type-level test for `ConnectOptions` rejecting incompatible `FetchFactory`

**Source**: PR #41 (FINDING-03) reviewer suggestion
**Location**: `test/unit/type-system.test.ts`
**Effort**: ~5 min

Add a `@ts-expect-error` test verifying that `ConnectOptions<MyApi>` rejects a `FetchFactory` typed for a different API definition. This is the main user-facing improvement from the `FetchFactory<ApiDef>` change and deserves a compile-time regression guard.

---

## 2. Schema tightening in petshop example 404 response

**Source**: PR #43 (FINDING-09) reviewer observation
**Location**: `examples/petshop-fastify-server.ts` (POST `/pets/:id/buy` 404 schema)
**Effort**: ~2 min

Switching from plain JSON schema to `Type.Object({ error: Type.String() })` added `required: ['error']` where the old schema had none. No practical impact (the handler always sends `{ error: 'Not Found' }`), but worth noting if strict schema equivalence is desired.

---

## 3. Consolidate error message formats across error paths — DONE

**Status**: Completed. The `api-client.ts` / `error-handling.ts` refactor split the
fetch pipeline into `fetchSafe` and `fetchProne` and routed every message through
the file-private `formatErrorMessage` table so both paths share one canonical
format per (verbosity × category). Failure construction lives in two free
functions (`networkFailure`, `responseFailure`) that `fetchProne` calls inline.
Verbose-mode HTTP failure messages always carry the failing URL; safe mode
strips it.

---

## 5. Split `navigate.spec.ts` into multiple files — DONE

**Status**: Completed. `test/integration/navigate.spec.ts` was split into 10
focused spec files following `docs/integration-test-split.md`. Shared fixtures
live in `test/test-schemas.ts`.

---

## 4. Unwrap `Type.Object` from `params` in link definitions — DONE

**Status**: Resolved (FINDING-07). `LinkDefinition.params` is now typed as
`TProperties` (a bare property bag); `defineLinks` accepts
`params: { id: Type.Number() }` directly. The framework wraps with
`Type.Object(...)` internally inside `ApiClient.resolveUrl` before calling
`expandUriTemplate`. All tests, examples, and documentation were updated to
drop the wrapper. The public `expandUriTemplate` API still takes a `TObject`
schema directly.

---

## 6. Normalize error message for primitive inputs to `navigate()` — DONE

**Status**: Resolved. Guard moved into `getOwningClient` in `src/runtime-metadata.ts`
(widened from `object` to `unknown`, with a null/non-object early-return of
`undefined`). The existing `!client` check in `navigate()` handles it
transparently — `navigate.ts` is unchanged. The deferred regex alternation
`/Link metadata not found|Cannot read/` in
`test/integration/runtime-guards.spec.ts` is now tightened to
`/Link metadata not found/`. All callers of `getOwningClient` are automatically
protected at the WeakMap boundary.

---

## 7. Petshop-fixture prone-link smoke test (post-split note)

**Source**: `docs/integration-test-split.md` consolidation review
**Location**: `test/integration/error-handling.spec.ts` (`prone links (expected errors)` describe)
**Status**: Resolved during the integration test split.

The plan flagged the petshop-fixture rows 1177/1195 as consolidation candidates
(redundant with the synthetic `errorApi` rows 1084/1115). The split kept **one**
of them — the success case — as a single "real-API-shape" smoke test against
the example `petshopApi`. The 404 duplicate (old line 1195) was dropped
outright. Rationale: the synthetic API already proves the prone-link contract
in detail, and the smoke test is enough to guard against drift between the
example API definition and the prone-link runtime path.

---

## 8. `readonly` arrays not handled in type-system path traversal — RESOLVED

**Source**: Critical review (Type System concern #4)
**Location**: `src/type-system.ts` (`MergeInner`), `src/fetch-customization.ts` (`TypeAtPath`)
**Resolution**: `MergeInner` and `TypeAtPath` array matches were widened from
`Array<infer Item>` to `readonly (infer Item)[]`, so hand-typed `readonly T[]`
element types (e.g. `as const` assertions, hand-written TypeScript `readonly`
annotations, or future TypeBox versions that produce readonly arrays) traverse
correctly. Type-level regression tests live in `test/unit/type-system.test.ts`
(MergeInner) and `test/unit/fetch-customization.test.ts` (TypeAtPath).

**Scope caveat**: Current TypeBox 0.34+ does **not** produce `readonly T[]`
through `Type.Array` or `Type.Readonly`. `Type.Readonly(Type.Array(X))` only
attaches a `ReadonlyKind` symbol that affects a containing `TObject`'s property
modifier; `TArray.static` is hardcoded to mutable `Ensure<Static<T,P>[]>`.
The fix therefore benefits hand-typed `readonly T[]` carriers today (such as
types declared with `as const` or explicit `readonly` annotations), and will
automatically cover TypeBox-generated arrays if/when TypeBox changes this
behaviour.

---

## 10. `defineLinks` should reject terminal-array link paths up front — DONE

**Status**: Resolved (FINDING-02). `defineLinks` now rejects link paths whose
terminal segment is a bare array marker with the same suggested-fix message
the runtime guard uses. The runtime guard inside `traverse`
(`src/runtime-metadata.ts`) remains as defense-in-depth for direct callers
that bypass `defineLinks`. A unit test in `test/unit/link-definition.test.ts`
pins the up-front rejection; the integration test in
`test/integration/runtime-guards.spec.ts` exercises it through the public API.

Original notes follow for historical context.



**Source**: Review of `src/runtime-metadata.ts` defensive guards
**Location**: `src/link-definition.ts` (`validatePath` / link-path validation)
**Effort**: ~15 min plus a defineLinks unit test

`defineLinks` currently accepts a link path whose final segment is a bare
array marker, e.g.:

```typescript
defineLinks(['t'], {
    t: {
        schema: Type.Object({ tags: Type.Optional(Type.Array(Type.String())) }),
        links: { 'tags[]': { to: 't' } }   // accepted today
    }
});
```

The path `tags[]` is meaningless: an array marker says "iterate", but at the
terminal we need a property name to extract a string href from. The runtime
catches this lazily inside `traverse` (the "Array segment 'tags[]' cannot be
terminal" error in `src/runtime-metadata.ts`), but only when the resource is
actually fetched — so a typo in `defineLinks` ships in a release and only
blows up at the first real navigation.

`defineLinks` already runs schema-aware path validation (`validatePath` in
`link-definition.ts`); add a check that the final path segment does not end
with `[]`, with the same suggested-fix message the runtime guard uses
("Specify the property name to extract, e.g. 'tags[].href'"). Then the
runtime guard becomes a true defense-in-depth safety net for direct callers
of `traverse`, instead of the only place this error can ever surface.

A test in `test/unit/runtime-metadata.test.ts` already covers the runtime
guard behaviour and is annotated as deferred user-input validation pending
this fix; once `defineLinks` rejects the path, the runtime test stays as a
defense-in-depth check and a new `link-definition.test.ts` test pins the
compile-time rejection.

---

## 11. Restructure `FetchContext` so `doFetch` doesn't need a cast

**Source**: PR #71 review (comment on `api-client.ts:239-248`)
**Location**: `src/fetch-customization.ts` (`FetchContext`), `src/api-client.ts` (`ApiClient.doFetch`)
**Effort**: ~30 min plus a type-level regression test

`ApiClient.doFetch` currently builds its `FetchContext` via
`as FetchContext<ApiDef>` because `FetchContext` is a conditional type on
`ApiDef` (distributing between the unconstrained `ApiDefinition` base case
and the narrowed form). Inside the generic class body TypeScript cannot
resolve which branch applies, so a plain `const ctx: FetchContext<ApiDef>`
fails with **TS2322**, not TS2589 as an earlier comment claimed. The PR #71
review corrected the comment; the cast itself is still in place.

Ways to drop the cast entirely:

1. Refactor `FetchContext<Api>` to a non-conditional generic (a single
   object shape parameterised by `Api` directly), paying the cost of less
   precise typing in the unparameterised case.
2. Introduce a small internal helper (`buildFetchContext<Api>`) in
   `fetch-customization.ts` that centralises the cast behind a single named
   site, so consumers see an honest-typed API.
3. Split `doFetch` into two overloads and push the conditional branching
   out to the caller level.

Pick based on how much public-API cost option 1 imposes; option 2 is the
lowest-risk cleanup if the cast is kept at one central helper.

---

## 13. CI does not run `tsconfig.typecheck.json` (covers `test/`, `examples/`)

**Source**: PR #80 round-3 peer review observation
**Location**: `.github/workflows/ci.yml`, `tsconfig.typecheck.json`
**Effort**: ~5 min

The CI workflow runs `tsc --project tsconfig.json` (which `excludes` `test/` and
`examples/`) plus `npx jest`. The separate `tsconfig.typecheck.json` that covers
test and example files is only invoked manually via `npm run typecheck`. This
means type errors in test or example code — including narrowing regressions
like the one fixed in PR #80 — are not caught by CI unless a runtime test fails.
Add a `npm run typecheck` step to the build-and-test job.

---

## 14. Missing trailing newline on `examples/petshop-api.ts`

**Source**: PR #80 peer review observation
**Location**: `examples/petshop-api.ts` (EOF)
**Effort**: <1 min

The file is missing a trailing newline. Apply when next touched.

---

## 9. `Merge` type uses broad `S extends object` check — RESOLVED

**Source**: Critical review (Type System concern #3)
**Location**: `src/type-system.ts` (`MergeInner`)
**Resolution**: `MergeInner` object branch was tightened from `S extends object`
to `S extends Record<string, unknown>`. This prevents Date, Function, RegExp,
and other non-plain-object types from being recursively merged. A type-level
regression test in `test/unit/type-system.test.ts` verifies that a Date field
passes through `MergeInner` without losing its instance methods.

---

## 15. `tsc --noEmit` silently skips `examples/` and `test/`

**Source**: `feat/bff-showcase` session friction log F-5
**Location**: `tsconfig.json`, `tsconfig.typecheck.json`, `AGENTS.md`
**Effort**: ~5 min

The default `tsconfig.json` excludes `examples/` and `test/`, so `npx tsc --noEmit` passes even when those trees have real type errors. The correct invocation is `npx tsc --noEmit -p tsconfig.typecheck.json`. Add a one-liner to AGENTS.md under "Running checks" so contributors don't have to discover this the hard way.

---

## 12. Expand `ProblemSchema` to fully represent RFC 7807

**Source**: Code review quick-fixes (inline TODO removed)
**Location**: `examples/petshop-api.ts` (`ProblemSchema`)
**Effort**: ~5 min

Expand `ProblemSchema` to fully represent RFC 7807 (title, type, status, detail, instance) — currently minimal stub. The schema only defines `title: Type.String()` today. All RFC 7807 fields should be added (with optional where appropriate) so the example accurately models a real problem detail response.

```typescript
export const ProblemSchema = Type.Object({
    title: Type.String(),
    type: Type.Optional(Type.String()),
    status: Type.Optional(Type.Number()),
    detail: Type.Optional(Type.String()),
    instance: Type.Optional(Type.String()),
});
```