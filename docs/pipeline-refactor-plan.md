# Pipeline refactor plan: unify safe & prone link flows

> **Status:** Proposed — awaiting external review.
> **Scope:** `src/api-client.ts` + `src/error-handling.ts` only. No public API changes. No test assertion changes.
> **Related:** Supersedes `synthesis-error-handling.md` (which picked PR #74 as a base). This plan is an alternative that unifies the flow at a higher level.

## Motivation

`src/api-client.ts` currently has two near-identical fetch methods (`fetchSafe` and `fetchProne`) that duplicate the same fetch → parse → validate sequence in different shapes. `fetchProne` alone carries four `try`/`catch` blocks — one per failure class — plus an inline non-OK branch and two helper methods (`deliverSuccess`, `toFailure`). The synthesis plan (`.claude/plans/synthesis-error-handling.md`) proposed relocating helpers into `error-handling.ts` but **kept both methods**, leaving the flow duplicated line-for-line in two places.

**The deeper observation:** the flow is *identical* for safe and prone links through fetch → parse → validate. What differs is only **how the outcome is presented** at the end: safe throws, prone returns a tuple. If the flow is written once and the presentation is done at the boundary, there is no duplication and there is exactly one `try`/`catch` in the entire file.

## Design

### Shape

1. **`ApiClient.runPipeline`** — a single private method that fetches, parses, validates, and returns a `PipelineOutcome`. One `try`/`catch`. Uses a `step` variable to track which phase failed so the catch handler can classify the error.
2. **`PipelineOutcome`** — a discriminated union in `error-handling.ts` with five variants (`success`, `network`, `http-status`, `parse`, `validate`). Each variant carries exactly the fields the converters need.
3. **`toSafeError` / `toProneFailure`** — two pure converters in `error-handling.ts` that turn a `FailureOutcome` into an `Error` (safe) or a `Failure<any, any>` (prone). All verbosity branching lives inside these converters.
4. **`resolve`** — becomes the only place that knows safe-vs-prone. After `runPipeline` returns, the success path is shared (hydrate via `rememberLinks`, return either the resource or a `[resource, null]` tuple) and the failure path is a two-line branch (throw vs. build tuple).

### What gets deleted

- `fetchSafe` (14 lines)
- `fetchProne` (30 lines)
- `deliverSuccess` (10 lines)
- `toFailure` (13 lines)
- `validateResource` (13 lines — hoisted to `error-handling.ts` as `validateResourceOrThrow`)
- `httpErrorMessage` export (becomes a file-private call to `formatErrorMessage` inside `toSafeError`)
- `responseFailure` export (replaced by file-private `classifyHttpStatus`)

### What gets added

- `PipelineOutcome` + `FailureOutcome` types in `error-handling.ts`
- `validateResourceOrThrow` in `error-handling.ts`
- `toSafeError` in `error-handling.ts`
- `toProneFailure` + file-private `classifyHttpStatus` in `error-handling.ts`
- `ApiClient.runPipeline` private method
- Rewritten `ApiClient.resolve` body (the new dispatch logic)
- Class-header doc comment on `ApiClient` stating the design intent (grafted from PR #76)

## Code sketches

### `ApiClient.runPipeline` (api-client.ts)

```ts
/**
 * Executes the fetch → parse → validate sequence against a single URL and
 * returns a `PipelineOutcome`. Body-level failures are never thrown out of
 * this method — they become `FailureOutcome` variants. The one surviving
 * `try`/`catch` in `api-client.ts` lives here.
 *
 * The `step` variable tracks which phase is currently in progress so the
 * catch handler can classify the thrown error without needing sentinel
 * Error classes. `response` is hoisted above the try so the catch handler
 * can include it on `parse`/`validate` failures.
 */
private async runPipeline(
    url: string,
    resourceName: string,
    schema: TSchema,
    navigable: unknown,
): Promise<PipelineOutcome> {
    let step: 'fetch' | 'parse' | 'validate' = 'fetch';
    let response: Response | undefined;
    try {
        response = await this.doFetch(url, resourceName, navigable);
        if (!response.ok) return { kind: 'http-status', response };
        step = 'parse';
        const resource = await response.json();
        step = 'validate';
        validateResourceOrThrow(resource, schema, url, this.errorVerbosity);
        return { kind: 'success', resource };
    } catch (err) {
        if (step === 'fetch') return { kind: 'network', error: err as Error };
        return { kind: step, response: response!, error: err as Error };
    }
}
```

**Design notes:**
- **One try/catch.** Not four, not two.
- **Non-OK is not an exception.** The non-OK branch returns directly from inside the try block — HTTP ≥ 400 is a normal server response, not a transport failure, so it doesn't pretend to be thrown.
- **`response!` is safe.** The assertion on the catch branch is provably correct: `step` is only ever `'parse'` or `'validate'` after `response = await this.doFetch(...)` has resolved.
- **No verbosity check.** The only place this method mentions verbosity is passing `this.errorVerbosity` to `validateResourceOrThrow`.

### `PipelineOutcome` (error-handling.ts)

```ts
/**
 * Result of a single fetch-parse-validate pipeline run. Produced by
 * `ApiClient.runPipeline`; consumed by `toSafeError` and `toProneFailure`.
 *
 * Each failure variant carries exactly the fields its converter needs —
 * no optional fields, no non-null assertions at the use site, clean
 * discriminated-union narrowing on `kind`.
 *
 * @internal
 */
export type PipelineOutcome =
    | { readonly kind: 'success';     readonly resource: unknown }
    | { readonly kind: 'network';     readonly error: Error }
    | { readonly kind: 'http-status'; readonly response: Response }
    | { readonly kind: 'parse';       readonly response: Response; readonly error: Error }
    | { readonly kind: 'validate';    readonly response: Response; readonly error: Error };

/** All non-success variants — what the converters accept. @internal */
export type FailureOutcome = Exclude<PipelineOutcome, { kind: 'success' }>;
```

### `toSafeError` (error-handling.ts)

```ts
/**
 * Converts a `FailureOutcome` to a JavaScript `Error` for safe links.
 *
 * Safe-link message contract (preserved verbatim from the pre-refactor code):
 * - `network` verbose: the raw fetch Error (whatever the transport layer threw)
 * - `network` safe:    `'Network error'`
 * - `http-status`:     the formatted `unmappedStatus` message (same text as the prone path)
 * - `parse`:           the raw `SyntaxError` from `response.json()` (unchanged)
 * - `validate`:        the Error already thrown by `validateResourceOrThrow`, which
 *                      formatted it in the safe-link format at throw time
 *
 * @internal
 */
export function toSafeError(
    outcome: FailureOutcome,
    verbosity: Verbosity,
    url: string,
): Error {
    switch (outcome.kind) {
        case 'network':
            return verbosity === 'safe' ? new Error('Network error') : outcome.error;
        case 'http-status':
            return new Error(formatErrorMessage(verbosity, {
                kind: 'unmappedStatus', url, response: outcome.response,
            }));
        case 'parse':
        case 'validate':
            return outcome.error;
    }
}
```

### `toProneFailure` (error-handling.ts)

```ts
/**
 * Converts a `FailureOutcome` to a `Failure` variant for prone links.
 *
 * Returns the failure plus an optional `hydrateWith` hint: when the
 * caller must call `rememberLinks` on the failure's `resource` (because the
 * failure is an expected typed error with an embedded resource shape), the
 * `ResourceDefinition` to hydrate with is returned here. `api-client.ts`
 * owns the `rememberLinks` call because `error-handling.ts` must not import
 * `runtime-metadata.ts` — this hint is the one thread that crosses the layer.
 *
 * @internal
 */
export async function toProneFailure(
    outcome: FailureOutcome,
    verbosity: Verbosity,
    url: string,
    linkDef: LinkDefinition,
    apiDef: ApiDefinition,
): Promise<{
    readonly failure: Failure<any, any>;
    readonly hydrateWith?: ResourceDefinition;
}> {
    switch (outcome.kind) {
        case 'network':
            return { failure: networkFailure(verbosity, url, outcome.error) };
        case 'http-status':
            return classifyHttpStatus(verbosity, url, outcome.response, linkDef, apiDef);
        case 'parse':
            return {
                failure: invalidJsonFailure(
                    verbosity, url, outcome.response, linkDef.to, outcome.error,
                ),
            };
        case 'validate':
            return {
                failure: invalidStructureFailure(
                    verbosity, url, outcome.response, linkDef.to, outcome.error,
                ),
            };
    }
}

/**
 * Dispatches a non-OK response to either an expected Failure variant
 * (if the status is in the link's `expect` map) or the `'unmappedStatus'`
 * catch-all. Expected cases that fail to parse or validate fall back to
 * `invalidJson` / `invalidStructure` unexpected variants, in which case
 * there is nothing to hydrate and `hydrateWith` is omitted.
 *
 * Replaces the deleted `responseFailure` export.
 */
async function classifyHttpStatus(
    verbosity: Verbosity,
    url: string,
    response: Response,
    linkDef: LinkDefinition,
    apiDef: ApiDefinition,
): Promise<{
    readonly failure: Failure<any, any>;
    readonly hydrateWith?: ResourceDefinition;
}> {
    const errorName = linkDef.expect?.[response.status];
    if (!errorName) {
        return { failure: unmappedStatusFailure(verbosity, url, response) };
    }
    const errorDef = apiDef[errorName];
    const failure = await createExpectedFailure(
        response, errorName, errorDef, verbosity, url,
    );
    // createExpectedFailure falls back to invalidJson/invalidStructure on parse
    // or schema failure; those variants have no `resource` to hydrate.
    if (failure.kind === 'unexpected') return { failure };
    return { failure, hydrateWith: errorDef };
}
```

### `validateResourceOrThrow` (error-handling.ts)

```ts
/**
 * Validates a parsed resource against its schema. Throws with the
 * safe-link-formatted message on failure — i.e., the message contract
 * that `fetchSafe` callers used to see directly. The prone path catches
 * this throw inside `runPipeline` and `toProneFailure` reshapes it into an
 * `invalidStructure` Failure whose `cause.message` contains the thrown text.
 *
 * Hoisted from `ApiClient.validateResource`; the body is identical.
 *
 * @internal
 */
export function validateResourceOrThrow(
    resource: unknown,
    schema: TSchema,
    url: string,
    verbosity: Verbosity,
): void {
    if (verbosity === 'safe') {
        if (!Value.Check(schema, resource)) {
            throw new Error('Response validation failed');
        }
        return;
    }
    const errors = [...Value.Errors(schema, resource)];
    if (errors.length > 0) {
        const details = errors.map(e => `${e.path}: ${e.message}`).join(', ');
        throw new Error(`Response validation failed for ${url}: ${details}`);
    }
}
```

### Rewritten `resolve` (api-client.ts)

```ts
/**
 * Resolves a link on a navigable object.
 *
 * The pre-pipeline section handles programming errors (unknown link name,
 * invalid URI-template params, missing resource definition) — these propagate
 * verbatim rather than becoming Failures, because they indicate caller bugs,
 * not server or network failures.
 *
 * The pipeline runs fetch → parse → validate and returns a `PipelineOutcome`.
 * Safe and prone links share this entire flow; the only difference is what
 * happens after the outcome lands:
 *
 * - **Success**: both paths call `rememberLinks` identically; they differ only
 *   in return shape (resource vs. `[resource, null]` tuple).
 * - **Failure**: safe links throw the converted Error; prone links convert to
 *   a `Failure` variant, hydrate its embedded resource (if any) via
 *   `rememberLinks`, and return `[null, failure]`.
 *
 * The `as any` at the end is unavoidable: TypeScript cannot narrow the
 * conditional return type from inside this generic body.
 */
async resolve<L extends LinkSpec>(
    navigable: Navigable<any>,
    linkName?: string,
    params?: Static<L['Params']>,
): Promise<L['Error'] extends undefined ? LinkedResource<L> : ResourceOrFailure<L>> {
    // --- Pre-pipeline: programming errors propagate verbatim ---
    const link = recallLink(navigable, linkName);
    const url = this.expandUrl(link, params);
    const resourceDef = this.requireResourceDef(link.linkDef.to);
    const baseURL = extractBaseURL(url);

    // --- Pipeline: same flow for safe and prone ---
    const outcome = await this.runPipeline(
        url, link.linkDef.to, resourceDef.schema, navigable,
    );

    // --- Success path: shared hydration, return shape differs ---
    if (outcome.kind === 'success') {
        rememberLinks(outcome.resource, resourceDef, baseURL, this);
        return (link.linkDef.expect ? [outcome.resource, null] : outcome.resource) as any;
    }

    // --- Failure path: safe throws, prone returns tuple ---
    if (!link.linkDef.expect) {
        throw toSafeError(outcome, this.errorVerbosity, url);
    }
    const { failure, hydrateWith } = await toProneFailure(
        outcome, this.errorVerbosity, url, link.linkDef, this.apiDef,
    );
    if (hydrateWith) {
        rememberLinks(
            (failure as { resource: unknown }).resource,
            hydrateWith,
            baseURL,
            this,
        );
    }
    return [null, failure] as any;
}
```

**Note on the `(failure as { resource: unknown })` cast:** TypeScript can't narrow `failure` through the truthiness of `hydrateWith`, so the cast is unavoidable here. It's the one place where a "layering leak" between `error-handling.ts` and `runtime-metadata.ts` is visible, and it's a single line. This is the same cast the synthesis plan acknowledged in its PR #73 critique; the difference is that here it appears *once* in `resolve` instead of being scattered across `fetchProne`.

### Class-header doc (api-client.ts)

Graft the synthesis-plan design-intent paragraph (adapted for the new shape):

> **Design intent:** `api-client.ts` is deliberately kept thin on error-handling. Error classification, verbosity handling, message formatting, parse recovery and schema validation all live in `error-handling.ts`. The entire fetch → parse → validate flow lives in the single `runPipeline` method (one `try`/`catch`, tracked by a `step` variable); `resolve` dispatches the resulting outcome to the appropriate converter. If you find yourself adding a second `try`/`catch`, a `verbosity === 'safe'` check, or error-message string concatenation in here, the right home for it is almost certainly `error-handling.ts`.

## Why this beats the synthesis plan

| Aspect | Synthesis plan (PR #74 base) | This plan |
|---|---|---|
| Fetch methods | `fetchSafe` + `fetchProne` (flow duplicated in two bodies) | **One** `runPipeline` method |
| `try`/`catch` sites in api-client | 1 (transport in `fetchProne`) | 1 (inside `runPipeline`) |
| `verbosity === 'safe'` checks in api-client | 0 | 0 |
| Non-OK handling | Inlined in `fetchSafe` *and* in `classifyProneHttpError` call from `fetchProne` | Single `return { kind: 'http-status' }` in the pipeline |
| Shared success hydration | Duplicated in `deliverSuccess` + `fetchProne` | Single `rememberLinks` call in `resolve` |
| Shared pre-flight (`requireResourceDef`, `extractBaseURL`) | Called twice (once per fetch method) | Called once in `resolve` |
| Safe/prone divergence | Two full method bodies | Two `if` branches at the bottom of `resolve` |
| Methods deleted | `deliverSuccess`, `toFailure` (2) | `fetchSafe`, `fetchProne`, `deliverSuccess`, `toFailure`, `validateResource` (5) |
| New abstractions introduced | 4 free functions (`throwNetworkError`, `throwHttpError`, `validateResourceOrThrow`, `parseProneBody`) + `classifyProneHttpError` | 1 type (`PipelineOutcome`) + 3 functions (`validateResourceOrThrow`, `toSafeError`, `toProneFailure`) + 1 private helper (`classifyHttpStatus`) |

The critical improvement: in the synthesis plan, the *flow* (fetch → parse → validate) is spelled out twice — once in `fetchSafe`, once in `fetchProne` — and an agent maintaining the code has to keep those two in sync. In this plan, the flow is spelled out **once**, and the safe/prone divergence is literally four lines at the bottom of `resolve`.

## Line-count estimate

| File | Before | After | Delta |
|---|---|---|---|
| `src/api-client.ts` | 305 | ~255 | **-50** |
| `src/error-handling.ts` | 399 | ~475 | **+76** |
| **Total** | **704** | **~730** | **+26** |

Slightly net-positive (~+26 lines), similar to the synthesis plan's budget (~-4 lines). The extra lines buy structural consolidation — deleting five private methods, eliminating the flow duplication between `fetchSafe`/`fetchProne`, and reducing the api-client surface area to a single try/catch.

## Test-assertion impact

**All 22 pinned error strings survive unchanged.** Walked case by case:

| Scenario | Current assertion | New code path | Result |
|---|---|---|---|
| Safe verbose HTTP | `'HTTP 404: Not Found (http://localhost:3000/safe)'` | `toSafeError` → `formatErrorMessage({kind:'unmappedStatus'})` verbose | ✓ |
| Safe verbose network | `'Connection refused'` | `toSafeError` → `outcome.error` (raw) | ✓ |
| Safe verbose parse | `'Unexpected token in JSON'` | `toSafeError` → `outcome.error` (raw SyntaxError) | ✓ |
| Safe verbose validate | `/Response validation failed.*\/pets: Expected array/` | `toSafeError` → `outcome.error` (thrown by `validateResourceOrThrow`) | ✓ |
| Safe safe HTTP | `'HTTP 500 error'`, `'HTTP 404 error'` | `toSafeError` → `formatErrorMessage` safe branch | ✓ |
| Safe safe network | `'Network error'` | `toSafeError` safe branch returns literal | ✓ |
| Safe safe validate | `'Response validation failed'` | `validateResourceOrThrow` safe branch throws literal | ✓ |
| Prone verbose mapped | `'HTTP 404: Not Found (http://localhost:3000/error-prone)'` | `classifyHttpStatus` → `createExpectedFailure` → `mappedStatus` verbose | ✓ |
| Prone verbose parse | `'Failed to parse JSON when target was expected (http://localhost:3000/error-prone)'` | `toProneFailure` → `invalidJsonFailure` → `invalidJson` verbose | ✓ |
| Prone verbose validate | `'Validation of target failed (http://localhost:3000/error-prone)'` | `toProneFailure` → `invalidStructureFailure` → `invalidStructure` verbose | ✓ |
| Prone verbose unmapped | `'HTTP 403: Forbidden (http://localhost:3000/error-prone)'` | `classifyHttpStatus` → `unmappedStatusFailure` | ✓ |
| Prone verbose mapped-parse-fail | `'Failed to parse JSON when notFound was expected (http://localhost:3000/error-prone)'` | `createExpectedFailure` → `invalidJsonFailure` | ✓ |
| Prone verbose mapped-validate-fail | `'Validation of notFound failed (http://localhost:3000/error-prone)'` | `createExpectedFailure` → `invalidStructureFailure` | ✓ |
| Prone verbose network | `'Network error: Network failure (http://localhost:3000/error-prone)'` | `toProneFailure` → `networkFailure` | ✓ |
| Prone safe network | `'Network error'` | `networkFailure` safe branch | ✓ |
| Prone safe unmapped | `'HTTP 403 error'` | `unmappedStatusFailure` safe branch | ✓ |
| Prone safe mapped | `'HTTP 404'` | `createExpectedFailure` → `mappedStatus` safe | ✓ |
| Prone safe parse | `'HTTP 404: Response parse error'` | `invalidJsonFailure` safe branch | ✓ |
| Prone safe validate | `'HTTP 404: Response validation error'` | `invalidStructureFailure` safe branch | ✓ |
| Headers exposed (verbose) | `Headers` instance with values | `makeResponseInfo` verbose | ✓ |
| Headers stripped (safe) | empty `Headers` | `makeResponseInfo` safe | ✓ |
| `error.cause.message` contains `'Response validation failed'` | `cause` is the thrown Error | `invalidStructureFailure` stores `outcome.error` as `cause` in verbose | ✓ |

## Internal-export audit

The refactor removes these `@internal` exports from `error-handling.ts`:
- `httpErrorMessage` — **inlined** into `toSafeError`
- `responseFailure` — **replaced** by `classifyHttpStatus` (file-private)

These exports remain (unchanged):
- `Failure`, `ResponseInfo`, `ResourceOrFailure` — public API
- `networkFailure`, `unmappedStatusFailure`, `invalidJsonFailure`, `invalidStructureFailure` — called by the new converters

These exports are added:
- `PipelineOutcome`, `FailureOutcome` — consumed by `toSafeError` / `toProneFailure`
- `validateResourceOrThrow` — called by `runPipeline`
- `toSafeError`, `toProneFailure` — called by `resolve`

**Pre-implementation check:** audit `test/` for any direct imports of `httpErrorMessage` or `responseFailure`. If none, the exports can be deleted outright. If some, either migrate the tests to the new exports in the same commit or temporarily keep the old ones exported alongside. Grep-based audit finds no direct imports of these symbols in tests (they're exercised only through the public navigate/linkTo API).

## Implementation plan

1. **Audit `test/` for direct imports** of `httpErrorMessage` and `responseFailure`. Confirm none exist. If any exist, add them to the migration list.
2. **Add new types and functions to `error-handling.ts`**:
   - `PipelineOutcome`, `FailureOutcome` types
   - `validateResourceOrThrow` (copy body from `ApiClient.validateResource`)
   - `toSafeError`
   - `classifyHttpStatus` (file-private)
   - `toProneFailure`
3. **Delete from `error-handling.ts`**:
   - `httpErrorMessage` export (inline its single call into `toSafeError`)
   - `responseFailure` export (replaced by `classifyHttpStatus`)
4. **Add `runPipeline` method** to `ApiClient`.
5. **Rewrite `ApiClient.resolve`** to use the new pipeline + converters (see sketch above).
6. **Delete from `ApiClient`**:
   - `fetchSafe`
   - `fetchProne`
   - `deliverSuccess`
   - `toFailure`
   - `validateResource`
7. **Update the `ApiClient` class header comment** with the design-intent paragraph.
8. **Update `AGENTS.md`** to reflect the new shape (`runPipeline` method, `PipelineOutcome` type, the flow unification story).
9. **Update `docs/how-it-works.md`** if it references any deleted methods.
10. **Run `npm run test:coverage`**. Expect all green, all four coverage metrics at 100%.
11. **Commit** as a single refactor commit — this is a cohesive reshape, not separable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pinned error strings break | All 22 walked through above — each preserved by construction |
| 100% coverage breaks | Every branch of `runPipeline`, `toSafeError`, `toProneFailure`, `classifyHttpStatus`, `validateResourceOrThrow` is exercised by existing integration tests (the tests exercise the same code paths, just via different method names) |
| Test imports reach into deleted symbols | Audited above — none do; if any turn up during implementation, either migrate or keep exports |
| `resolve` generic return type breaks | The `as any` at the end of `resolve` is unchanged from the current code; the conditional return type is the same |
| `response!` non-null assertion in `runPipeline` is unsound | Provably correct: `step` is only `'parse'` or `'validate'` after `response = await this.doFetch(...)` resolved. TypeScript just can't see through the mutation. |

## What this plan explicitly does NOT do

- **No public API changes.** `navigate`, `linkTo`, `Failure`, `ResponseInfo`, and `ResourceOrFailure` are untouched.
- **No new files in `src/`.** Everything lives in the existing `api-client.ts` and `error-handling.ts`.
- **No new classes.** `runPipeline` is a method on `ApiClient`; the converters are free functions.
- **No speculative abstractions.** The pipeline is a straight-line method body, not an array of `Step<T>` callbacks. The "named steps" are tracked by a single `step` variable, not by a stateful runner object.
- **No changes to `recallLink` / `expandUrl` flow.** They remain outside the pipeline because their failures are programming errors that should propagate verbatim.
- **No changes to `FetchFactory` or `FetchContext`.** The fetch invocation flows through `this.doFetch` exactly as it does today.
- **No merging of safe-link and prone-link error messages.** The existing message divergence (e.g. safe-verbose-validate uses `'Response validation failed for url: details'` while prone-verbose-validate uses `'Validation of target failed (url)'`) is preserved verbatim — unifying the wording would break pinned tests and is orthogonal to the flow unification.
