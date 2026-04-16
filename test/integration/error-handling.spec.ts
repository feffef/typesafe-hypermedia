/**
 * error-handling.spec.ts — How do errors surface from navigate()?
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling  ← THIS FILE
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { linkTo, defineLinks } from '../../src';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopSchema, PetSchema } from '../../examples/petshop-api';
import {
    mockResponse, mockNetworkError, mockJsonParseError, mockErrorResponse,
} from '../mock-responses';
import {
    setupErrorRoot, errorApi, mockErrorRoot,
    ErrorRootSchema, ErrorTargetSchema as TargetSchema,
    NotFoundErrorSchema, ValidationErrorSchema, ServerErrorSchema,
    mockPetshop, mockPet123,
} from '../test-schemas';

describe('navigate — error handling', () => {

    describe('error surfacing', () => {

        describe('safe links', () => {
            it('return a resource value directly (not a tuple)', async () => {
                const root = await setupErrorRoot();

                mockResponse(TargetSchema, 200, { id: '123', data: 'success' });
                const result = await navigate(root.actions.safeLink);

                expect(Array.isArray(result)).toBe(false);
                expect(result.id).toBe('123');
                expect(result.data).toBe('success');
            });

            it('throw on HTTP error responses', async () => {
                const root = await setupErrorRoot();

                mockResponse(Type.Object({}), 404, {});
                await expect(navigate(root.actions.safeLink)).rejects.toThrow('HTTP 404: Not Found (http://localhost:3000/safe)');
            });

            it('propagate network errors raised during the initial fetch', async () => {
                mockNetworkError(new Error('Connection refused'));
                const entry = linkTo({
                    api: errorApi,
                    resource: 'root',
                    url: 'http://localhost:3000/root',
                });

                await expect(navigate(entry)).rejects.toThrow('Connection refused');
            });

            it('propagate JSON parse errors raised during the initial fetch', async () => {
                mockJsonParseError(200, 'Unexpected token in JSON');
                const entry = linkTo({
                    api: errorApi,
                    resource: 'root',
                    url: 'http://localhost:3000/root',
                });

                await expect(navigate(entry)).rejects.toThrow('Unexpected token in JSON');
            });

            it('throw a descriptive error when the response violates the schema', async () => {
                mockResponse(PetshopSchema, mockPetshop);
                const shop = await navigate(linkTo({
                    api: petshopApi,
                    resource: 'petshop',
                    url: 'http://localhost:3000',
                }));

                // Return invalid schema data
                mockResponse(Type.Any(), { invalid: 'schema' });
                await expect(navigate(shop.actions.listPets))
                    .rejects.toThrow(/Response validation failed.*\/pets: Expected array/);
            });
        });

        describe('prone links (expected errors)', () => {
            it('return a typed error tuple for a declared status code', async () => {
                const root = await setupErrorRoot();

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Pet not found',
                    code: 'NOT_FOUND',
                    resourceType: 'pet',
                    actions: {
                        search: { href: '/search' },
                        home: { href: '/' },
                    },
                });
                const result = await navigate(root.actions.errorProneLink);

                expect(Array.isArray(result)).toBe(true);
                expect(result).toHaveLength(2);

                const [success, error] = result;
                expect(success).toBeNull();
                expect(error).toBeDefined();
                expect(error!.kind).toBe('notFound');
                expect(error!.message).toBe('HTTP 404: Not Found (http://localhost:3000/error-prone)');

                if (error!.kind === 'notFound') {
                    expect(error!.response.status).toBe(404);
                    expect(error!.response.statusText).toBe('Not Found');
                    expect(error!.response.headers).toBeInstanceOf(Headers);
                    expect(error!.resource.message).toBe('Pet not found');
                    expect(error!.resource.code).toBe('NOT_FOUND');
                    expect(error!.resource.actions.search.href).toBe('/search');
                }
            });

            it('return a success tuple when a prone link succeeds', async () => {
                const root = await setupErrorRoot();

                mockResponse(TargetSchema, { id: '123', data: 'success' });
                const result = await navigate(root.actions.errorProneLink);

                expect(Array.isArray(result)).toBe(true);
                const [success, error] = result;
                expect(success).toBeDefined();
                expect(success!.id).toBe('123');
                expect(error).toBeNull();
            });

            // JSON parse failures on a 2xx body are recoverable from the
            // caller's perspective — the server sent something we couldn't
            // decode, but the caller of a prone link already has a branch
            // for unexpected failures. So fetchProne catches the SyntaxError
            // that `response.json()` raises per the Fetch spec and returns
            // an `unexpected` Failure carrying the parse error as `cause`.
            it('return an unexpected Failure when a 2xx body is malformed JSON', async () => {
                const root = await setupErrorRoot();

                mockJsonParseError(200, 'Unexpected token in JSON');
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Failed to parse JSON when target was expected (http://localhost:3000/error-prone)'
                );
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('invalidJson');
                    expect(error!.cause).toBeDefined();
                    expect(error!.cause!.message).toBe('Unexpected token in JSON');
                    expect(error!.response.status).toBe(200);
                }
            });

            // Schema validation failures on a 2xx body, like parse failures
            // above, are returned as `unexpected` Failures rather than
            // thrown. Prone links never throw for body-level problems — the
            // contract is that callers can rely on the tuple for every
            // fetch-level outcome. Safe links still throw on validation
            // (see the `safe links` describe).
            it('return an unexpected Failure when a 2xx body fails schema validation', async () => {
                const root = await setupErrorRoot();

                // 2xx with a body that does not match TargetSchema
                mockResponse(Type.Any(), 200, { not: 'a target' });
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Validation of target failed (http://localhost:3000/error-prone)'
                );
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('invalidStructure');
                    expect(error!.cause).toBeDefined();
                    expect(error!.cause!.message).toContain('Response validation failed');
                    expect(error!.response.status).toBe(200);
                }
            });

            // URI template expansion can fail at runtime (server changes its
            // template, client sends stale params). Prone links surface this as
            // a Failure with reason: 'uriExpansion' — no request is ever sent.
            it('return an unexpected Failure when URI template expansion fails', async () => {
                const RootSchema = Type.Object({
                    proneLink: Type.Object({ href: Type.String() }),
                });
                const api = defineLinks(['root', 'target'], {
                    root: {
                        schema: RootSchema,
                        links: {
                            'proneLink.href': {
                                to: 'target',
                                params: { id: Type.String() },
                                expect: { 404: 'target' },
                            },
                        },
                    },
                    target: { schema: Type.Any(), links: {} },
                });

                mockResponse(RootSchema, 200, { proneLink: { href: '/items/{id}' } });
                const root = await navigate(linkTo({ api, resource: 'root', url: 'http://localhost:3000/' }));

                // @ts-expect-error — intentionally omitting required param
                const [success, error] = await navigate(root.proneLink, { params: {} });

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.reason).toBe('uriExpansion');
                expect(error!.message).toMatch(/Values do not match schema/);
                expect(error!.cause).toBeDefined();
                expect(error!.cause!.message).toMatch(/Values do not match schema/);
            });

            it('dispatch to the correct typed error for each declared status', async () => {
                const root = await setupErrorRoot();

                // 404
                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Not found',
                    code: 'NOT_FOUND',
                    resourceType: 'pet',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                });
                const [, error404] = await navigate(root.actions.multiErrorLink);
                expect(error404!.kind).toBe('notFound');

                // 400
                mockResponse(ValidationErrorSchema, 400, {
                    message: 'Validation failed',
                    code: 'VALIDATION_ERROR',
                    errors: [
                        { field: 'name', error: 'Required' },
                        { field: 'age', error: 'Must be positive' },
                    ],
                });
                const [, error400] = await navigate(root.actions.multiErrorLink);
                expect(error400!.kind).toBe('validationError');
                if (error400!.kind === 'validationError') {
                    expect(error400!.resource.errors).toHaveLength(2);
                }

                // 500 — need fresh root since links are consumed once
                mockResponse(ErrorRootSchema, 200, mockErrorRoot);
                const root500 = await navigate(linkTo({
                    api: errorApi,
                    resource: 'root',
                    url: 'http://localhost:3000/root',
                }));

                mockResponse(ServerErrorSchema, 500, {
                    message: 'Server error',
                    code: 'SERVER_ERROR',
                    requestId: 'req-123',
                    actions: { retry: { href: '/retry' }, support: { href: '/support' } },
                });
                const [, error500] = await navigate(root500.actions.multiErrorLink);
                expect(error500!.kind).toBe('serverError');
                if (error500!.kind === 'serverError') {
                    expect(error500!.resource.requestId).toBe('req-123');
                }
            });

            // Real-API-shape smoke test against the petshop example fixture.
            // The synthetic errorApi above already covers the prone-link contract
            // in detail; this one extra test guards against drift between the
            // example API definition and the prone-link runtime path.
            // (Consolidation: dropped the petshop 404 duplicate at old line 1195
            // — it was redundant with the 404 test above.)
            it('succeed against a real-API-shaped prone link', async () => {
                mockResponse(PetshopSchema, mockPetshop);
                const shop = await navigate(linkTo({
                    api: petshopApi,
                    resource: 'petshop',
                    url: 'http://localhost:3000',
                }));

                mockResponse(PetSchema, mockPet123);
                const [pet, error] = await navigate(shop.actions.getPet, {
                    params: { id: '123' },
                });
                expect(pet).toBeDefined();
                expect(pet!.name).toBe('Buddy');
                expect(error).toBeNull();
            });
        });

        describe('prone links (unexpected errors)', () => {
            it('return the unexpected kind for unmapped status codes', async () => {
                const root = await setupErrorRoot();

                mockResponse(Type.Object({ message: Type.String() }), 403, { message: 'Denied' });
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe('HTTP 403: Forbidden (http://localhost:3000/error-prone)');
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('unmappedStatus');
                    expect(error!.response.status).toBe(403);
                    expect(error!.response.statusText).toBe('Forbidden');
                    // unmappedStatus has no thrown Error to attach as cause
                    expect(error!.cause).toBeUndefined();
                }
            });

            it('classify a JSON parse error on a declared status as unexpected', async () => {
                const root = await setupErrorRoot();

                mockJsonParseError(404);
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Failed to parse JSON when notFound was expected (http://localhost:3000/error-prone)'
                );
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('invalidJson');
                    expect(error!.response.status).toBe(404);
                    expect(error!.cause).toBeDefined();
                    expect(error!.cause!.message).toBe('Unexpected token in JSON');
                }
            });

            it('classify a schema mismatch on a declared status as unexpected', async () => {
                const root = await setupErrorRoot();

                // @ts-expect-error intentionally missing fields
                mockResponse(NotFoundErrorSchema, 404, { message: 'Not found' });
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Validation of notFound failed (http://localhost:3000/error-prone)'
                );
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('invalidStructure');
                    expect(error!.response.status).toBe(404);
                    // invalidStructure on a mapped 4xx body has no thrown Error
                    // (Value.Check is a boolean) — `cause` is omitted on this path.
                    expect(error!.cause).toBeUndefined();
                }
            });

            it('classify transport-level failures as unexpected', async () => {
                const root = await setupErrorRoot();

                mockNetworkError(new Error('Network failure'));
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Network error: Network failure (http://localhost:3000/error-prone)'
                );
                if (error!.kind === 'unexpected' && error!.reason === 'network') {
                    expect(error!.cause!.message).toBe('Network failure');
                    // The 'network' branch has no `response` field at all —
                    // narrowing on reason removes it from the type entirely.
                    expect('response' in error!).toBe(false);
                }
            });
        });

        describe('edge cases', () => {
            it('tolerate an empty error response body', async () => {
                const root = await setupErrorRoot();

                mockErrorResponse(404);
                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error).toBeDefined();
                expect(error!.kind).toBe('unexpected');
            });

            it('ignore fields the error schema does not declare', async () => {
                const root = await setupErrorRoot();

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Not found',
                    code: 'NOT_FOUND',
                    resourceType: 'product',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                    // @ts-expect-error extra fields
                    extraField: 'should be ignored by validation',
                    anotherExtra: 123,
                });
                const [, error] = await navigate(root.actions.errorProneLink);

                expect(error!.kind).toBe('notFound');
                if (error!.kind === 'notFound') {
                    expect(error!.resource.code).toBe('NOT_FOUND');
                    expect((error!.resource as any).extraField).toBe('should be ignored by validation');
                }
            });

            // Headers flow through verbatim from the underlying Response so
            // callers can read e.g. Retry-After / RateLimit-Remaining for
            // recovery decisions. The mock-responses helpers default to an
            // empty Headers; this test populates them inline.
            it('expose response headers for retry/quota decisions', async () => {
                const root = await setupErrorRoot();

                (global.fetch as jest.Mock).mockResolvedValueOnce({
                    ok: false,
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: new Headers({
                        'retry-after': '120',
                        'x-ratelimit-remaining': '0',
                    }),
                    json: async () => ({ error: 'Rate limited' }),
                });
                const [, error] = await navigate(root.actions.errorProneLink);

                expect(error!.kind).toBe('unexpected');
                if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                    expect(error!.reason).toBe('unmappedStatus');
                    expect(error!.response.headers.get('retry-after')).toBe('120');
                    expect(error!.response.headers.get('x-ratelimit-remaining')).toBe('0');
                }
            });

            it('expose the raw response body on the error for diagnostics', async () => {
                const root = await setupErrorRoot();

                const errorBody = {
                    message: 'Not found',
                    code: 'NOT_FOUND',
                    resourceType: 'item',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                    debugInfo: 'Extra debug information',
                    timestamp: Date.now(),
                };
                // @ts-expect-error additional field not expected by schema
                mockResponse(NotFoundErrorSchema, 404, errorBody);
                const [, error] = await navigate(root.actions.errorProneLink);

                expect(error!.kind).toBe('notFound');
                if (error!.kind === 'notFound') {
                    expect(error!.response.body).toEqual(errorBody);
                }
            });

            it('classify a null JSON body as a schema mismatch, not a parse error', async () => {
                // Regression guard: distinct from the "schema mismatch on declared status"
                // case above. The not.toContain('not valid JSON') assertion prevents
                // null bodies from being misrouted through the parse-error branch of
                // createExpectedFailure.
                const root = await setupErrorRoot();

                (global.fetch as jest.Mock).mockResolvedValueOnce({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    headers: new Headers(),
                    json: async () => null,
                });

                const [success, error] = await navigate(root.actions.errorProneLink);

                expect(success).toBeNull();
                expect(error!.kind).toBe('unexpected');
                expect(error!.message).toBe(
                    'Validation of notFound failed (http://localhost:3000/error-prone)'
                );
                // Distinct from the parse-error branch: a null body is valid
                // JSON, so the parse step succeeds and validation rejects it.
                expect(error!.message).not.toContain('parse JSON');
            });

            // Regression guard: an earlier version risked sharing the in-flight
            // error-classification state between parallel navigations on the same
            // root. This test fans out three prone navigations at once and asserts
            // each tuple carries its own typed result, proving there is no
            // cross-talk between concurrent prone requests.
            it('resolve concurrent prone requests independently', async () => {
                const root = await setupErrorRoot();

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Not found #1',
                    code: 'NOT_FOUND',
                    resourceType: 'pet',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                });
                mockResponse(TargetSchema, { id: 'success', data: 'data' });
                mockResponse(ValidationErrorSchema, 400, {
                    message: 'Validation failed',
                    code: 'VALIDATION_ERROR',
                    errors: [{ field: 'id', error: 'Invalid' }],
                });

                const [result1, result2, result3] = await Promise.all([
                    navigate(root.actions.errorProneLink),
                    navigate(root.actions.errorProneLink),
                    navigate(root.actions.multiErrorLink),
                ]);

                const [success1, error1] = result1;
                expect(success1).toBeNull();
                expect(error1!.kind).toBe('notFound');

                const [success2, error2] = result2;
                expect(success2?.id).toBe('success');
                expect(error2).toBeNull();

                const [success3, error3] = result3;
                expect(success3).toBeNull();
                expect(error3!.kind).toBe('validationError');
            });
        });
    });

    describe('consumer patterns', () => {

        describe('recovery flows', () => {
            it('hydrate error resources so callers can navigate embedded links', async () => {
                const root = await setupErrorRoot();

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Resource not found',
                    code: 'NOT_FOUND',
                    resourceType: 'pet',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                });
                const [, error] = await navigate(root.actions.errorProneLink);
                expect(error!.kind).toBe('notFound');

                // Follow recovery link from error resource using navigate
                if (error!.kind !== 'notFound') throw new Error('Expected notFound');
                mockResponse(ErrorRootSchema, 200, {
                    id: 'search',
                    name: 'Search Page',
                    actions: {
                        safeLink: { href: '/safe2' },
                        errorProneLink: { href: '/error-prone2' },
                        multiErrorLink: { href: '/multi-error2' },
                    },
                });
                const searchPage = await navigate(error!.resource.actions.search);
                expect(searchPage.id).toBe('search');
                expect(searchPage.name).toBe('Search Page');
            });

            it('support chains of recovery across multiple error types', async () => {
                const root = await setupErrorRoot();

                mockResponse(ServerErrorSchema, 500, {
                    message: 'Server error',
                    code: 'SERVER_ERROR',
                    requestId: 'req-456',
                    actions: { retry: { href: '/retry' }, support: { href: '/support' } },
                });
                const [, error] = await navigate(root.actions.multiErrorLink);

                expect(error!.kind).toBe('serverError');
                if (error!.kind !== 'serverError') throw new Error('Expected serverError');

                mockResponse(TargetSchema, 200, { id: 'retry-success', data: 'Retry succeeded' });
                const retryResult = await navigate(error!.resource.actions.retry);
                expect(retryResult.id).toBe('retry-success');
            });
        });

        describe('narrowing', () => {
            it('discriminates a typed error by switching on kind', async () => {
                const root = await setupErrorRoot();

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Not found',
                    code: 'NOT_FOUND',
                    resourceType: 'pet',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                });
                const [, error] = await navigate(root.actions.errorProneLink);

                expect(error).toBeDefined();
                switch (error!.kind) {
                    case 'notFound':
                        expect(error!.resource.code).toBe('NOT_FOUND');
                        expect(error!.resource.resourceType).toBe('pet');
                        expect(error!.response.status).toBe(404);
                        break;
                    case 'unexpected':
                        fail('Expected notFound, not unexpected');
                        break;
                }
            });

            it('yields a distinct shape per error branch', async () => {
                const root = await setupErrorRoot();

                mockResponse(ValidationErrorSchema, 400, {
                    message: 'Validation failed',
                    code: 'VALIDATION_ERROR',
                    errors: [
                        { field: 'name', error: 'Required' },
                        { field: 'email', error: 'Invalid format' },
                    ],
                });
                const [, error400] = await navigate(root.actions.multiErrorLink);

                mockResponse(NotFoundErrorSchema, 404, {
                    message: 'Not found',
                    code: 'NOT_FOUND',
                    resourceType: 'order',
                    actions: { search: { href: '/search' }, home: { href: '/' } },
                });
                const [, error404] = await navigate(root.actions.multiErrorLink);

                function handleResult(error: NonNullable<typeof error400>): string {
                    switch (error.kind) {
                        case 'notFound': return `not-found: ${error.resource.resourceType}`;
                        case 'validationError': return `validation: ${error.resource.errors.length} errors`;
                        case 'serverError': return `server: ${error.resource.requestId}`;
                        default: return `unexpected: ${error.message}`;
                    }
                }

                expect(handleResult(error400!)).toBe('validation: 2 errors');
                expect(handleResult(error404!)).toBe('not-found: order');
            });

            it('exposes a cause on unexpected errors for diagnostics', async () => {
                const root = await setupErrorRoot();

                mockNetworkError(new Error('Network failure'));
                const [, error] = await navigate(root.actions.errorProneLink);

                expect(error!.kind).toBe('unexpected');
                if (error!.kind === 'unexpected' && error!.reason === 'network') {
                    expect(error!.cause?.message).toBe('Network failure');
                    expect('response' in error!).toBe(false);
                }
            });
        });
    });

});
