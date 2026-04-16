# Pipeline refactor plan (alternative): single pipeline + boundary converter

> **Status:** Proposed — alternative to `pipeline-refactor-plan.md`.
> **Scope:** `src/api-client.ts` + `src/error-handling.ts` only. No public API changes. No test assertion changes.
> **Relationship to other plans:** This is a lower-ceremony alternative to `pipeline-refactor-plan.md`. Both plans target the same duplication (`fetchSafe` + `fetchProne`) and preserve the same 22 pinned error strings. The difference is how much machinery they introduce to get there.

## Motivation

Same starting observation as the other plan: `fetchSafe` and `fetchProne` duplicate the fetch → parse → validate sequence, and the only real difference is how failures are *presented* (throw vs. tuple).

**The deeper observation this plan leans on:** every piece of information a safe-link thrown `Error` needs is already carried by the `Failure` object that prone links produce. Specifically —

- **Safe verbose network** (`'Connection refused'`) = the raw fetch Error, stored as `failure.cause` in `networkFailure` verbose mode.
- **Safe verbose parse** (`'Unexpected token in JSON'`) = the raw `SyntaxError`, stored as `failure.cause` in `invalidJsonFailure` verbose mode.
- **Safe verbose validate** (`/Response validation failed.*\/pets: Expected array/`) = the Error thrown by `validateResource`, stored as `failure.cause` in `invalidStructureFailure` verbose mode. (Confirmed by `test/integration/error-handling.spec.ts:184` — the prone tests *already* assert `error!.cause!.message` contains `'Response validation failed'`.)
- **Safe verbose HTTP** (`'HTTP 404: Not Found (url)'`) = `failure.message` (same `unmappedStatus` wording the prone path produces).
- **Safe mode HTTP / network** (`'HTTP 404 error'`, `'Network error'`) = `failure.message` (prone safe-mode formatting is identical).
- **Safe mode validate** (`'Response validation failed'`) = single hardcoded literal; `cause` is dropped in safe mode, so this is the one case that needs fresh construction.

Because `Failure` already has everything we need, **there is no reason to introduce an intermediate `PipelineOutcome` type.** The prone pipeline becomes the only pipeline; safe links just convert the `Failure` back to an `Error` at the boundary.

## Design

### Shape

1. **`ApiClient.fetchResource`** — the existing `fetchProne` body, renamed, with one change: the `rememberLinks` call is hoisted out into `resolve`. Signature returns `[resource, null] | [null, Failure]` for every link.
2. **`failureToError`** — a single pure function in `error-handling.ts`. ~15 lines. Switches over `failure.reason` and returns either `failure.cause`, `new Error(failure.message)`, or a hardcoded safe-mode literal.
3. **`resolve`** — calls `fetchResource` unconditionally, hydrates links on whatever resource was returned (success body or typed error body), then dispatches: prone links return the tuple, safe links throw `failureToError(failure)` on failure or return the resource on success.

### What gets deleted

- `fetchSafe` (14 lines)
- `deliverSuccess` (10 lines)
- `toFailure` (13 lines) — its one responsibility (hydrating the mapped error resource's links) moves into `resolve` as two lines of direct access to `failure.resource` / `failure.kind`.
- `httpErrorMessage` export (no remaining caller — safe-link HTTP errors now flow through `failure.message`)

### What gets renamed / kept

- `fetchProne` → `fetchResource`. Body unchanged *except* the trailing `rememberLinks(resource, resourceDef, extractBaseURL(url), this)` is deleted and the `resourceDef` parameter is no longer needed here (resolved in `resolve`).
- `validateResource` stays as a private method on `ApiClient`. No reason to hoist it.
- `responseFailure` stays as an exported function in `error-handling.ts`. No rename, no wrapper type.
- All four `Failure` builders (`networkFailure`, `unmappedStatusFailure`, `invalidJsonFailure`, `invalidStructureFailure`) stay unchanged.

### What gets added

- `failureToError` in `error-handling.ts` (~15 lines including doc comment).
- Rewritten `resolve` body (~20 lines).
- Class-header doc update on `ApiClient` capturing the new design intent.

That is the entire surface of the refactor: **one new function, one rewritten method, four deletions.**

## Code sketches

### `failureToError` (error-handling.ts)

```ts
/**
 * Converts a `Failure` back to a JavaScript `Error` for safe links.
 *
 * Safe links run through the same prone-flavored pipeline as prone links; when
 * the pipeline produces a `Failure` instead of a resource, `resolve` calls this
 * to reshape it into the thrown `Error` that safe-link callers expect.
 *
 * Every case except safe-mode validate is recoverable directly from the
 * `Failure` object:
 *   - verbose network / parse / validate → `failure.cause` is the original
 *     thrown Error (captured at the failure site and preserved in verbose mode)
 *   - safe-mode network / parse / HTTP / unmappedStatus → `failure.message`
 *     already carries the safe-flavored wording the prone pipeline produced
 *   - safe-mode validate → cause is dropped in safe mode, so we reconstruct
 *     the pinned literal `'Response validation failed'` directly
 *
 * Safe links never have a declared `expect`, so only the `'unexpected'` branch
 * of `Failure` can reach here; the opening guard is defensive only.
 *
 * @internal
 */
export function failureToError(
    failure: Failure<any, any>,
    verbosity: Verbosity,
): Error {
    if (failure.kind !== 'unexpected') return new Error(failure.message);
    switch (failure.reason) {
        case 'network':
            return verbosity === 'safe' ? new Error('Network error') : failure.cause!;
        case 'unmappedStatus':
            return new Error(failure.message);
        case 'invalidJson':
            return verbosity === 'safe' ? new Error(failure.message) : failure.cause!;
        case 'invalidStructure':
            return verbosity === 'safe'
                ? new Error('Response validation failed')
                : failure.cause!;
    }
}
```

### `ApiClient.fetchResource` (api-client.ts)

Identical to the current `fetchProne` **except** the trailing `rememberLinks` call is removed (hoisted into `resolve`). The three local `try`/`catch` sites remain as-is — they're the clearest expression of "catch errors at the step where they happen and turn them into Failures."

```ts
/**
 * Unified fetch pipeline for every link. Body-level failures never throw —
 * transport errors, non-OK responses, malformed JSON, and schema mismatches
 * all become `Failure` variants in the returned tuple. Safe links convert
 * the returned Failure back to a thrown Error in `resolve`; prone links
 * return it unchanged.
 *
 * Three local try/catch sites, each handling one specific class of failure:
 *
 * - transport errors from `doFetch` → `networkFailure` (`reason: 'network'`)
 * - non-OK responses → `responseFailure` (expected case or `'unmappedStatus'`)
 * - `response.json()` throws on a 2xx body → `invalidJsonFailure`
 * - schema validation of a 2xx body fails → `invalidStructureFailure`
 *
 * `rememberLinks` is NOT called here — the caller (`resolve`) handles
 * hydration because it has the single decision point for whether to hydrate
 * the success body or a typed-error body.
 */
private async fetchResource(
    url: string,
    linkDef: LinkDefinition,
    navigable: unknown,
): Promise<[unknown, null] | [null, Failure<any, any>]> {
    const resourceDef = this.requireResourceDef(linkDef.to);

    let response: Response;
    try {
        response = await this.doFetch(url, linkDef.to, navigable);
    } catch (err) {
        return [null, networkFailure(this.errorVerbosity, url, err as Error)];
    }

    if (!response.ok) {
        return [null, await responseFailure(
            this.errorVerbosity, url, response, linkDef, this.apiDef,
        )];
    }

    let resource: unknown;
    try {
        resource = await response.json();
    } catch (err) {
        return [null, invalidJsonFailure(
            this.errorVerbosity, url, response, linkDef.to, err as Error,
        )];
    }
    try {
        this.validateResource(resource, resourceDef, url);
    } catch (err) {
        return [null, invalidStructureFailure(
            this.errorVerbosity, url, response, linkDef.to, err as Error,
        )];
    }
    return [resource, null];
}
```

### Rewritten `resolve` (api-client.ts)

```ts
/**
 * Resolves a link on a navigable object.
 *
 * Runs the unified fetch pipeline (`fetchResource`), hydrates links on
 * whatever resource was returned (success body *or* typed error body, since
 * both carry followable links), then dispatches based on the link shape:
 *
 * - **Prone links** (with `expect`): return the `[resource, failure]` tuple
 *   directly. The typed error body's links are already hydrated above.
 * - **Safe links** (no `expect`): return the resource on success, or throw
 *   `failureToError(failure, verbosity)` on failure. The converter maps each
 *   `Failure` reason back to the thrown-Error shape safe links advertise.
 *
 * Pre-pipeline programming errors (unknown link name, missing resource
 * definition, invalid URI-template params) still propagate verbatim — they
 * indicate caller bugs, not server or network failures.
 *
 * The `as any` at the end is unavoidable: TypeScript cannot narrow the
 * conditional return type from inside this generic body.
 */
async resolve<L extends LinkSpec>(
    navigable: Navigable<any>,
    linkName?: string,
    params?: Static<L['Params']>,
): Promise<L['Error'] extends undefined ? LinkedResource<L> : ResourceOrFailure<L>> {
    const link = recallLink(navigable, linkName);
    const url = this.expandUrl(link, params);
    const linkDef = link.linkDef;
    const resourceDef = this.requireResourceDef(linkDef.to);
    const baseURL = extractBaseURL(url);

    const [resource, failure] = await this.fetchResource(url, linkDef, navigable);

    // Hydrate links on whatever resource we received — success body OR
    // typed-error body. Unexpected failures have no resource to hydrate.
    if (resource !== null) {
        rememberLinks(resource, resourceDef, baseURL, this);
    } else if (failure!.kind !== 'unexpected') {
        rememberLinks(failure!.resource, this.apiDef[failure!.kind], baseURL, this);
    }

    // Dispatch by link shape.
    if (linkDef.expect) {
        return [resource, failure] as any; // prone: tuple
    }
    if (failure) {
        throw failureToError(failure, this.errorVerbosity); // safe: throw
    }
    return resource as any; // safe: resource
}
```

### Class-header doc (api-client.ts)

```
Design intent: api-client.ts is deliberately thin on error handling. Error
classification, verbosity, message formatting, parse recovery, and schema
validation all live in error-handling.ts. The fetch → parse → validate flow
lives in the single `fetchResource` method, which always returns a
`[resource, Failure]` tuple. `resolve` runs that pipeline once per navigation,
hydrates links on whatever resource came back, and dispatches to the link
shape — returning the tuple for prone links, throwing `failureToError(...)`
for safe-link failures. If you find yourself adding a second fetch method, a
`verbosity === 'safe'` check, or error-message concatenation in here, the
right home is almost certainly `error-handling.ts`.
```

## Why this beats the other plan

| Aspect | `pipeline-refactor-plan.md` | This plan |
|---|---|---|
| New types introduced | `PipelineOutcome`, `FailureOutcome` | **none** |
| New functions introduced | `runPipeline`, `toSafeError`, `toProneFailure`, `classifyHttpStatus`, `validateResourceOrThrow` | **`failureToError`** (1) |
| Fetch methods | `runPipeline` (new) | `fetchResource` (renamed `fetchProne`) |
| Mutable `step` variable + `response!` non-null assertion | yes | no |
| `hydrateWith` layering dance between `error-handling.ts` and `api-client.ts` | yes | no — `resolve` reads `failure.resource` / `failure.kind` directly |
| Switch statements projecting failure info | 2 (`toSafeError` + `toProneFailure`) | 1 (`failureToError`) |
| Methods deleted from `ApiClient` | 5 (`fetchSafe`, `fetchProne`, `deliverSuccess`, `toFailure`, `validateResource`) | 3 (`fetchSafe`, `deliverSuccess`, `toFailure`) |
| Exports added/removed in `error-handling.ts` | +4 / −2 | +1 / −1 |
| Pipeline shape | one big try/catch + mutable `step` | three local try/catches (clearer: each handler sits next to its step) |

The critical structural difference: `pipeline-refactor-plan.md` introduces a 5-variant intermediate type (`PipelineOutcome`) so that *both* safe and prone can project from a common representation. This plan observes that `Failure` is already that common representation — safe links don't need a separate intermediate, they just need a converter to turn `Failure` back into a thrown Error.

## Line-count estimate

| File | Before | After | Delta |
|---|---|---|---|
| `src/api-client.ts` | 305 | ~260 | **−45** |
| `src/error-handling.ts` | 399 | ~395 | **−4** |
| **Total** | **704** | **~655** | **−49** |

Net negative ~50 lines (vs. the other plan's net +26). The difference comes from not introducing `PipelineOutcome`, `FailureOutcome`, `runPipeline`, `toSafeError`, `toProneFailure`, `classifyHttpStatus`, or `validateResourceOrThrow`.

## Test-assertion impact

**All 22 pinned error strings preserved.** Walked case-by-case against `test/integration/error-handling.spec.ts` and `test/integration/error-verbosity.spec.ts`:

| Scenario | Assertion | New path | Result |
|---|---|---|---|
| Safe verbose HTTP | `'HTTP 404: Not Found (url)'` | `failure.message` from `unmappedStatusFailure` verbose | ✓ |
| Safe verbose network | `'Connection refused'` | `failure.cause` from `networkFailure` verbose | ✓ |
| Safe verbose parse | `'Unexpected token in JSON'` | `failure.cause` from `invalidJsonFailure` verbose | ✓ |
| Safe verbose validate | `/Response validation failed.*\/pets: Expected array/` | `failure.cause` from `invalidStructureFailure` verbose (thrown by `validateResource`) | ✓ |
| Safe safe HTTP 500 | `'HTTP 500 error'` | `failure.message` from `unmappedStatusFailure` safe | ✓ |
| Safe safe HTTP 404 | `'HTTP 404 error'` | `failure.message` from `unmappedStatusFailure` safe | ✓ |
| Safe safe network | `'Network error'` | literal in `failureToError` safe branch | ✓ |
| Safe safe validate | `'Response validation failed'` | literal in `failureToError` safe branch | ✓ |
| Prone verbose mapped | `'HTTP 404: Not Found (url)'` | unchanged — `createExpectedFailure` → `mappedStatus` | ✓ |
| Prone verbose parse | `'Failed to parse JSON when target was expected (url)'` | unchanged — `invalidJsonFailure` verbose | ✓ |
| Prone verbose validate | `'Validation of target failed (url)'` | unchanged — `invalidStructureFailure` verbose | ✓ |
| Prone verbose unmapped | `'HTTP 403: Forbidden (url)'` | unchanged — `unmappedStatusFailure` | ✓ |
| Prone verbose mapped-parse-fail | `'Failed to parse JSON when notFound was expected (url)'` | unchanged — `createExpectedFailure` → `invalidJsonFailure` | ✓ |
| Prone verbose mapped-validate-fail | `'Validation of notFound failed (url)'` | unchanged — `createExpectedFailure` → `invalidStructureFailure` | ✓ |
| Prone verbose network | `'Network error: Network failure (url)'` | unchanged — `networkFailure` | ✓ |
| Prone safe network | `'Network error'` | unchanged — `networkFailure` safe | ✓ |
| Prone safe unmapped | `'HTTP 403 error'` | unchanged — `unmappedStatusFailure` safe | ✓ |
| Prone safe mapped | `'HTTP 404'` | unchanged — `createExpectedFailure` → `mappedStatus` safe | ✓ |
| Prone safe parse | `'HTTP 404: Response parse error'` | unchanged — `invalidJsonFailure` safe | ✓ |
| Prone safe validate | `'HTTP 404: Response validation error'` | unchanged — `invalidStructureFailure` safe | ✓ |
| Headers exposed (verbose) | `Headers` instance with values | unchanged — `makeResponseInfo` verbose | ✓ |
| Headers stripped (safe) | empty `Headers` | unchanged — `makeResponseInfo` safe | ✓ |
| `error.cause.message` contains `'Response validation failed'` (prone) | `cause` is thrown Error | unchanged — `invalidStructureFailure` stores `err` as `cause` in verbose | ✓ |

### One behavior change in untested territory

**Safe-mode safe-link parse errors** are the sole case with a visible behavior change, and there is **no pinned test** for this scenario.

- **Before:** `fetchSafe` → `deliverSuccess` → raw `response.json()` — the underlying `SyntaxError` propagates unmasked (leaking something like `'Unexpected token < in JSON'`).
- **After:** `failureToError` safe-mode `invalidJson` returns `new Error(failure.message)` = `'HTTP 200: Response parse error'` (the prone safe-mode wording).

This is arguably an *improvement*: safe mode's stated purpose is to mask internal details, and leaking a raw `SyntaxError` contradicts that. No tests break because no test pins this path. **Flag it in the PR description** so reviewers can confirm they're happy with it before landing.

## Internal-export audit

**Removed** from `error-handling.ts`:
- `httpErrorMessage` — no remaining caller (safe-link HTTP errors now flow through `failure.message`).

**Added** to `error-handling.ts`:
- `failureToError` — called by `ApiClient.resolve`.

**Unchanged** exports: `Failure`, `ResponseInfo`, `ResourceOrFailure`, `networkFailure`, `unmappedStatusFailure`, `invalidJsonFailure`, `invalidStructureFailure`, `responseFailure`.

**Pre-implementation check:** grep `test/` for direct imports of `httpErrorMessage`. The `pipeline-refactor-plan.md` audit confirmed none exist; re-verify before deleting the export.

## Implementation plan

1. **Audit** `test/` for direct imports of `httpErrorMessage`. Confirm none. (Also confirm no test imports `fetchSafe` / `fetchProne` / `deliverSuccess` / `toFailure` / `validateResource` — they're private methods, so imports are unlikely, but the audit costs nothing.)
2. **Add** `failureToError` to `error-handling.ts`.
3. **Delete** `httpErrorMessage` export from `error-handling.ts`.
4. **Rename** `ApiClient.fetchProne` → `ApiClient.fetchResource`. Delete its trailing `rememberLinks` call. Update its doc comment to reflect that it's now the single unified pipeline.
5. **Rewrite** `ApiClient.resolve` per the sketch above.
6. **Delete** from `ApiClient`: `fetchSafe`, `deliverSuccess`, `toFailure`.
7. **Update** the `ApiClient` class-header comment with the new design-intent paragraph.
8. **Update** `AGENTS.md` to reflect the new shape — single `fetchResource` method, `failureToError` converter, the "one pipeline, dispatch at the boundary" story.
9. **Update** `docs/how-it-works.md` if it references any deleted methods.
10. **Run** `npm run test:coverage`. Expect all green, all four coverage metrics at 100%.
11. **Commit** as a single refactor commit — this is a cohesive reshape, not separable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pinned error strings break | All 22 walked through above — each preserved by construction. |
| 100% coverage breaks | Every branch of `failureToError` is exercised by existing integration tests (each `reason` value is hit by at least one safe-link error test). |
| Safe-mode safe-link parse behavior change | Untested by pinned strings; called out explicitly in the PR description. Safe-mode masking arguably *should* apply here, so the change is an improvement. |
| Test imports reach into deleted symbols | Audit step #1 confirms this before deletion. |
| `resolve` generic return type breaks | The `as any` at the end of `resolve` is unchanged in shape; the conditional return type is identical. |
| Concurrent prone requests test breaks (cross-talk regression guard) | The unified pipeline has no shared mutable state — each call gets its own local `response` and destructured tuple. |

## What this plan explicitly does NOT do

- **No public API changes.** `navigate`, `linkTo`, `Failure`, `ResponseInfo`, and `ResourceOrFailure` are untouched.
- **No new files in `src/`.** Everything lives in the existing `api-client.ts` and `error-handling.ts`.
- **No new classes or types.** One new free function.
- **No message-wording unification** between safe-link and prone-link paths. (See the follow-up note below — this is a tempting further simplification but is explicitly out of scope for *this* refactor.)
- **No changes to `recallLink` / `expandUrl` flow.** They remain outside the pipeline because their failures are programming errors that propagate verbatim.
- **No changes to `FetchFactory` / `FetchContext`.** The fetch invocation flows through `this.doFetch` exactly as today.
- **No hoist of `validateResource` out of `ApiClient`.** It stays as a private method — one caller, no reason to move.

## Possible follow-up (not part of this refactor)

If there's appetite for touching a small number of pinned strings in a *separate* PR, the safe-link verbose wording (`'Response validation failed for url: ...'`) could be unified with prone wording (`'Validation of target failed (url)'`). That would collapse `failureToError` to:

```ts
export function failureToError(failure: Failure<any, any>): Error {
    return failure.kind === 'unexpected' && failure.cause
        ? failure.cause
        : new Error(failure.message);
}
```

~4 lines. The cost is updating ~4 test assertions (safe-verbose validate, safe-verbose network, safe-verbose parse, safe-mode validate). The benefit is consistent wording across the whole library and a simpler converter. **Not in scope for this plan** — proposed as a follow-up once this refactor lands.
