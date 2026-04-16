import { ApiDefinition, ErrorResourceMap, LinkDefinition, ResourceDefinition } from './link-definition';
import { Value } from '@sinclair/typebox/value';
import { Resource, LinkSpec, LinkedResource, Verbosity } from './type-system';

// ============================================================================
// Failure — the one public discriminated-union type for prone-link failures
// ============================================================================

/**
 * HTTP response metadata attached to failure variants.
 *
 * Headers come straight from the underlying `fetch` `Response.headers` so
 * callers can read e.g. `response.headers.get('retry-after')` for rate-limit
 * recovery. In `errorVerbosity: 'safe'` mode the builders substitute an empty
 * `Headers()` to avoid leaking server-controlled fields like `Server`,
 * `X-Powered-By`, request IDs, etc.
 *
 * `body` is the raw parsed response body — whatever the server sent. For
 * expected failure variants it has been validated against the declared error
 * schema; for unexpected variants it is absent (`undefined`).
 */
export type ResponseInfo = {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly body?: unknown;
};

/**
 * Discriminated union of every failure a prone link can surface.
 *
 * There are N+1 cases:
 * - N user-declared expected cases (one per error resource name in the
 *   link's `expect` map). Each carries the parsed typed resource, a message,
 *   and a `response: ResponseInfo` (always required — we have a Response).
 * - 1 library-defined catch-all `'unexpected'` case used for everything we
 *   couldn't classify into a declared variant. The `unexpected` case is
 *   sub-discriminated by `reason`, telling the caller exactly which step of
 *   the request pipeline failed:
 *
 *   - `'uriExpansion'` — URI template expansion failed before the request
 *     was sent (bad params, malformed template). `response` is **absent**.
 *   - `'network'` — no Response received (DNS, connect refused, TLS, abort).
 *     `response` is **absent** on this branch.
 *   - `'unmappedStatus'` — Response received with a non-2xx status that was
 *     not in the link's `expect` map.
 *   - `'invalidJson'` — Response received but the body wasn't parseable JSON.
 *   - `'invalidStructure'` — Response received, JSON parsed, but the body
 *     didn't match the declared schema.
 *
 * Check `failure.kind` first; for the `'unexpected'` branch check
 * `failure.reason` to find out which step failed and whether `response` is
 * available. TypeScript narrows `failure.resource` and `failure.response` in
 * each branch.
 *
 * @example
 * ```typescript
 * const [pet, failure] = await navigate(proneLink);
 * if (failure) {
 *     switch (failure.kind) {
 *         case 'notFound':        return navigate(failure.resource, { link: 'search' });
 *         case 'validationError': return showErrors(failure.resource.errors);
 *         case 'unexpected':
 *             if (failure.reason === 'network') return offlineFallback();
 *             // failure.response is now in scope (status / headers / body)
 *             const retryAfter = failure.response.headers.get('retry-after');
 *             return scheduleRetry(retryAfter);
 *     }
 * }
 * pet.name;
 * ```
 */
export type Failure<ApiDef extends ApiDefinition, ErrorMap extends ErrorResourceMap> =
    // User-declared cases: one per error resource name in the expect map.
    | {
          [K in ErrorMap[keyof ErrorMap] & keyof ApiDef & string]: {
              readonly kind: K;
              readonly resource: Resource<K, ApiDef>;
              readonly message: string;
              readonly response: ResponseInfo;
          };
      }[ErrorMap[keyof ErrorMap] & keyof ApiDef & string]
    // Library-defined catch-all — pre-request branches (no Response).
    | {
          readonly kind: 'unexpected';
          readonly reason: 'uriExpansion';
          readonly resource: undefined;
          readonly message: string;
          readonly cause?: Error;
      }
    | {
          readonly kind: 'unexpected';
          readonly reason: 'network';
          readonly resource: undefined;
          readonly message: string;
          readonly cause?: Error;
      }
    // Library-defined catch-all — HTTP-flavored branches (Response present).
    | {
          readonly kind: 'unexpected';
          readonly reason: 'unmappedStatus' | 'invalidJson' | 'invalidStructure';
          readonly resource: undefined;
          readonly message: string;
          readonly cause?: Error;
          readonly response: ResponseInfo;
      };

/**
 * A tuple representing either a successful resource or a typed failure.
 *
 * Destructure and check the failure side, then use `switch (failure.kind)`
 * for type-safe handling with native TypeScript narrowing.
 */
export type ResourceOrFailure<L extends LinkSpec> = [
    LinkedResource<L>,
    null
] | [
    null,
    Failure<L['Api'], L['Error']>
];

// ============================================================================
// File-private helpers — Failure variant construction
// ============================================================================

/**
 * All `'unexpected'` branches of `Failure`. Used as the return type for the
 * individual failure builders and the parameter type of `failureToError`.
 *
 * `Failure<any, never>` eliminates the user-declared expected-case branch
 * (which collapses to `kind: any` under `Failure<any, any>` and would slip
 * through the Extract).
 */
export type UnexpectedFailure = Extract<Failure<any, never>, { kind: 'unexpected' }>;

/**
 * Builds a `ResponseInfo` from a `Response`, applying safe-mode redaction.
 *
 * Headers are stripped to an empty `Headers()` in safe mode because they can
 * leak server-controlled topology (`Server`, `X-Powered-By`, request IDs).
 */
function makeResponseInfo(
    verbosity: Verbosity,
    response: Response,
    body?: unknown
): ResponseInfo {
    return {
        status: response.status,
        statusText: response.statusText,
        headers: verbosity === 'safe' ? new Headers() : response.headers,
        body,
    };
}

// ============================================================================
// Failure builders — reshape raw inputs into Failure variants
// ============================================================================

/**
 * Wraps a URI template expansion failure. The error message from
 * `expandUriTemplate` already respects verbosity, so we use it directly.
 *
 * @internal
 */
export function uriExpansionFailure(
    verbosity: Verbosity,
    err: Error
): UnexpectedFailure {
    return {
        kind: 'unexpected' as const,
        reason: 'uriExpansion' as const,
        resource: undefined,
        message: err.message,
        cause: verbosity === 'safe' ? undefined : err,
    };
}

/**
 * Wraps a network (transport) failure as the `'network'` reason of the
 * `'unexpected'` Failure variant.
 *
 * In safe mode the original `err` is dropped so its text (which may include
 * host/IP/path detail) never leaves the library.
 *
 * @internal
 */
export function networkFailure(
    verbosity: Verbosity,
    url: string,
    err: Error
): UnexpectedFailure {
    return {
        kind: 'unexpected' as const,
        reason: 'network' as const,
        resource: undefined,
        message: verbosity === 'safe'
            ? 'Network error'
            : `Network error: ${err.message} (${url})`,
        cause: verbosity === 'safe' ? undefined : err,
    };
}

/**
 * Wraps an HTTP response whose status was not in the link's `expect` map as
 * the `'unmappedStatus'` reason. No `cause` is attached — there's no thrown
 * Error here, the status was simply not declared.
 *
 * @internal
 */
export function unmappedStatusFailure(
    verbosity: Verbosity,
    url: string,
    response: Response
): UnexpectedFailure {
    return {
        kind: 'unexpected' as const,
        reason: 'unmappedStatus' as const,
        resource: undefined,
        message: verbosity === 'safe'
            ? `HTTP ${response.status} error`
            : `HTTP ${response.status}: ${response.statusText} (${url})`,
        cause: undefined,
        response: makeResponseInfo(verbosity, response),
    };
}

/**
 * Wraps a JSON parse failure on a response body as the `'invalidJson'`
 * reason. The status is preserved on `response` so callers can still see
 * what the server returned; the parse error is attached as `cause` in
 * verbose mode.
 *
 * Used both for 4xx/5xx mapped-status parse failures (inside
 * `createExpectedFailure`) and for 2xx parse failures (inside
 * `ApiClient.fetchResource`). Pure `Input → Output` — never throws.
 *
 * @internal
 */
export function invalidJsonFailure(
    verbosity: Verbosity,
    url: string,
    response: Response,
    resourceName: string,
    err: Error
): UnexpectedFailure {
    return {
        kind: 'unexpected' as const,
        reason: 'invalidJson' as const,
        resource: undefined,
        message: verbosity === 'safe'
            ? `HTTP ${response.status}: Response parse error`
            : `Failed to parse JSON when ${resourceName} was expected (${url})`,
        cause: verbosity === 'safe' ? undefined : err,
        response: makeResponseInfo(verbosity, response),
    };
}

/**
 * Wraps a schema-validation failure on a response body as the
 * `'invalidStructure'` reason. Used in two places:
 *
 * - `createExpectedFailure`, for a 4xx/5xx body that parsed fine but did not
 *   match the declared error schema. No `Error` instance exists at that
 *   point (validation is a boolean `Value.Check`), so `err` is omitted.
 * - `ApiClient.fetchResource`, for a 2xx body that failed schema validation.
 *   The thrown `Error` from `validateResource` is passed through as `cause`
 *   in verbose mode.
 *
 * Pure `Input → Output` — never throws.
 *
 * @internal
 */
export function invalidStructureFailure(
    verbosity: Verbosity,
    url: string,
    response: Response,
    resourceName: string,
    err?: Error
): UnexpectedFailure {
    return {
        kind: 'unexpected' as const,
        reason: 'invalidStructure' as const,
        resource: undefined,
        message: verbosity === 'safe'
            ? 'Response validation failed'
            : `Validation of ${resourceName} failed (${url})`,
        cause: verbosity === 'safe' ? undefined : err,
        response: makeResponseInfo(verbosity, response),
    };
}

/**
 * Parses a non-2xx response whose status IS mapped in `expect` and builds
 * the matching expected Failure variant. Falls back to the `'invalidJson'`
 * or `'invalidStructure'` unexpected reasons if parsing or schema validation
 * fails.
 *
 * Both `errorResourceName` and `errorDef` are looked up by the caller
 * (`responseFailure`) — no duplicated lookup here.
 */
async function createExpectedFailure(
    response: Response,
    errorResourceName: string,
    errorDef: ResourceDefinition,
    verbosity: Verbosity,
    url: string
): Promise<Failure<any, any>> {
    let parsedBody: unknown;
    try {
        parsedBody = await response.json();
    } catch (e) {
        return invalidJsonFailure(verbosity, url, response, errorResourceName, e as Error);
    }

    if (Value.Check(errorDef.schema, parsedBody)) {
        return {
            kind: errorResourceName,
            resource: parsedBody,
            message: verbosity === 'safe'
                ? `HTTP ${response.status}`
                : `HTTP ${response.status}: ${response.statusText} (${url})`,
            response: makeResponseInfo(verbosity, response, parsedBody),
            // Cast required: `errorResourceName` is a runtime string, so
            // TypeScript can't narrow `kind` to the literal type of an
            // expected-case variant. Correct by construction — the caller
            // looked the name up in `linkDef.expect`.
        } as Failure<any, any>;
    }

    return invalidStructureFailure(verbosity, url, response, errorResourceName);
}

/**
 * Builds the Failure variant matching a non-2xx response. Mapped status codes
 * produce an expected variant (parsed + validated); unmapped status codes
 * produce the `'unmappedStatus'` reason on the `'unexpected'` variant.
 *
 * Consumed only by `ApiClient.fetchResource`. Pure `Input → Output` — never throws.
 *
 * @internal
 */
export async function responseFailure(
    verbosity: Verbosity,
    url: string,
    response: Response,
    linkDef: LinkDefinition,
    apiDef: ApiDefinition
): Promise<Failure<any, any>> {
    const errorResourceName = linkDef.expect?.[response.status];
    if (errorResourceName) {
        return createExpectedFailure(
            response,
            errorResourceName,
            apiDef[errorResourceName],
            verbosity,
            url
        );
    }
    return unmappedStatusFailure(verbosity, url, response);
}

/**
 * Converts an `'unexpected'` `Failure` back to a JavaScript `Error` for safe
 * links.
 *
 * Safe links run through the same prone-flavored pipeline as prone links; when
 * the pipeline produces a `Failure` instead of a resource, `resolve` calls this
 * to reshape it into the thrown `Error` that safe-link callers expect.
 *
 * Two routes:
 *   - **verbose**: prefer the original thrown Error captured as `failure.cause`
 *     (uriExpansion / network / parse / validate all carry one). `unmappedStatus`
 *     has no cause, so we fall back to wrapping `failure.message`.
 *   - **safe**: each builder already formats a safe-appropriate `message`, so we
 *     use it directly.
 *
 * Safe links have no declared `expect`, so the typed-error branch of `Failure`
 * is unreachable from the safe-link path — the parameter type narrows to the
 * `'unexpected'` cases only and the converter doesn't need a defensive guard.
 *
 * @internal
 */
export function failureToError(
    failure: UnexpectedFailure,
    verbosity: Verbosity,
): Error {
    if (verbosity === 'safe') {
        return new Error(failure.message);
    }
    return failure.cause ?? new Error(failure.message);
}
