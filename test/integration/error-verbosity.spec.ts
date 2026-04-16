/**
 * error-verbosity.spec.ts — errorVerbosity: 'safe' sanitization
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity  ← THIS FILE
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations
 * 10. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { linkTo, defineLinks } from '../../src';
import { navigate } from '../../src/navigate';
import {
    mockResponse, mockNetworkError, mockJsonParseError, mockErrorResponse,
} from '../mock-responses';
import { setupErrorRoot, NotFoundErrorSchema } from '../test-schemas';

describe('navigate — error verbosity (safe mode)', () => {

    describe('safe mode — thrown errors', () => {
        it('strips the URL from HTTP error messages on safe links', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockErrorResponse(500);
            await expect(navigate(root.actions.safeLink)).rejects.toThrow('HTTP 500 error');
        });

        it('strips both URL and HTTP statusText from safe-link errors', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockErrorResponse(404);
            try {
                await navigate(root.actions.safeLink);
                fail('Expected an error to be thrown');
            } catch (e: any) {
                expect(e.message).toBe('HTTP 404 error');
                expect(e.message).not.toContain('localhost');
                expect(e.message).not.toContain('Not Found');
            }
        });

        it('strips host/IP details from transport failures on safe links', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockNetworkError(new Error('connect ECONNREFUSED 10.0.0.1:3000'));
            try {
                await navigate(root.actions.safeLink);
                fail('Expected an error to be thrown');
            } catch (e: any) {
                expect(e.message).toBe('Network error');
                expect(e.message).not.toContain('10.0.0.1');
            }
        });

        it('strips verbose details from URI expansion failures on safe links', async () => {
            const RootSchema = Type.Object({ link: Type.Object({ href: Type.String() }) });
            const api = defineLinks(['root', 'target'], {
                root: {
                    schema: RootSchema,
                    links: { 'link.href': { to: 'target', params: { id: Type.String() } } },
                },
                target: { schema: Type.Any(), links: {} },
            });

            mockResponse(RootSchema, 200, { link: { href: '/items/{id}' } });
            const root = await navigate(linkTo({ api, resource: 'root', url: '/', errorVerbosity: 'safe' }));

            // @ts-expect-error — intentionally omitting required param
            await expect(navigate(root.link, { params: {} }))
                .rejects.toThrow('Invalid request parameters');
        });

        it('strips the URL from schema validation failures on safe links', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockResponse(Type.Any(), { invalid: 'schema' });
            await expect(navigate(root.actions.safeLink)).rejects.toThrow(
                'Response validation failed'
            );

            mockResponse(Type.Any(), { invalid: 'schema' });
            const error = await navigate(root.actions.safeLink).catch(e => e);
            expect(error.message).toBe('Response validation failed');
            expect(error.message).not.toContain('localhost');
        });
    });

    describe('safe mode — returned errors', () => {
        it('strips verbose details from URI expansion failures on prone links', async () => {
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
            const root = await navigate(linkTo({
                api, resource: 'root', url: 'http://localhost:3000/', errorVerbosity: 'safe',
            }));

            // @ts-expect-error — intentionally omitting required param
            const [success, error] = await navigate(root.proneLink, { params: {} });

            expect(success).toBeNull();
            expect(error!.kind).toBe('unexpected');
            expect(error!.message).toBe('Invalid request parameters');
            expect(error!.message).not.toContain('template');
            if (error!.kind === 'unexpected') {
                expect(error!.reason).toBe('uriExpansion');
                expect(error!.cause).toBeUndefined();
            }
        });

        it('strips the URL from transport failures on prone links', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockNetworkError(new Error('Connection refused'));
            const [success, error] = await navigate(root.actions.errorProneLink);

            expect(success).toBeNull();
            expect(error!.kind).toBe('unexpected');
            expect(error!.message).toBe('Network error');
            expect(error!.message).not.toContain('localhost');
            if (error!.kind === 'unexpected') {
                // `reason` is preserved in safe mode — it carries no
                // user-controlled or network-derived information.
                expect(error!.reason).toBe('network');
                expect(error!.cause).toBeUndefined();
            }
        });

        it('strips HTTP statusText for unmapped status codes', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockResponse(Type.Object({ message: Type.String() }), 403, { message: 'Denied' });
            const [success, error] = await navigate(root.actions.errorProneLink);

            expect(success).toBeNull();
            expect(error!.message).toBe('HTTP 403 error');
            expect(error!.message).not.toContain('Forbidden');
            if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                expect(error!.reason).toBe('unmappedStatus');
                expect(error!.response.status).toBe(403);
            }
        });

        it('preserves the typed error resource while stripping statusText', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockResponse(NotFoundErrorSchema, 404, {
                message: 'Pet not found',
                code: 'NOT_FOUND',
                resourceType: 'pet',
                actions: { search: { href: '/search' }, home: { href: '/' } },
            });
            const [success, error] = await navigate(root.actions.errorProneLink);

            expect(success).toBeNull();
            expect(error!.message).toBe('HTTP 404');
            expect(error!.message).not.toContain('Not Found');
            expect(error!.kind).toBe('notFound');
            if (error!.kind === 'notFound') {
                expect(error!.resource.code).toBe('NOT_FOUND');
                // status survives safe mode (it's a non-sensitive HTTP fact)
                expect(error!.response.status).toBe(404);
                // headers are stripped to an empty Headers in safe mode
                expect(error!.response.headers).toBeInstanceOf(Headers);
                expect([...error!.response.headers.entries()]).toHaveLength(0);
            }
        });

        it('strips the error resource name from parse-failure messages', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            mockJsonParseError(404);
            const [success, error] = await navigate(root.actions.errorProneLink);

            expect(success).toBeNull();
            expect(error!.kind).toBe('unexpected');
            expect(error!.message).toBe('HTTP 404: Response parse error');
            expect(error!.message).not.toContain('notFound');
            if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                expect(error!.reason).toBe('invalidJson');
                expect(error!.response.status).toBe(404);
                expect(error!.cause).toBeUndefined();
            }
        });

        it('strips the error resource name from validation-failure messages', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            // @ts-expect-error intentionally missing fields
            mockResponse(NotFoundErrorSchema, 404, { message: 'Not found' });
            const [success, error] = await navigate(root.actions.errorProneLink);

            expect(success).toBeNull();
            expect(error!.kind).toBe('unexpected');
            expect(error!.message).toBe('Response validation failed');
            expect(error!.message).not.toContain('notFound');
            if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                expect(error!.reason).toBe('invalidStructure');
                expect(error!.response.status).toBe(404);
            }
        });

        // Headers are server-controlled and notorious for leaking topology
        // (Server, X-Powered-By, request IDs). Safe mode replaces them with
        // an empty Headers() across every reason that carries a response.
        it('strips response headers from prone-link unexpected variants', async () => {
            const root = await setupErrorRoot({ errorVerbosity: 'safe' });

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({
                    'server': 'nginx/1.18.0',
                    'x-powered-by': 'Express',
                    'x-request-id': 'abc-123',
                    'retry-after': '60',
                }),
                json: async () => ({ error: 'Down' }),
            });
            const [, error] = await navigate(root.actions.errorProneLink);

            expect(error!.kind).toBe('unexpected');
            if (error!.kind === 'unexpected' && error!.reason !== 'network' && error!.reason !== 'uriExpansion') {
                expect(error!.reason).toBe('unmappedStatus');
                // Status survives, headers do not.
                expect(error!.response.status).toBe(503);
                expect([...error!.response.headers.entries()]).toHaveLength(0);
                expect(error!.response.headers.get('server')).toBeNull();
                expect(error!.response.headers.get('retry-after')).toBeNull();
            }
        });
    });

});
