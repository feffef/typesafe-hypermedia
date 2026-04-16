import { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { expect } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { FetchFactory, ApiDefinition } from '../../src';

/**
 * Asserts that `value` matches `schema`.
 * Uses a single Value.Errors traversal — collects errors once, prints them
 * before the assertion fires so output appears in test log regardless of reporter.
 */
export function assertMatchesSchema(schema: TSchema, value: unknown): void {
    const errors = [...Value.Errors(schema, value)];
    if (errors.length > 0) {
        console.error('Validation Errors:', errors);
    }
    expect(errors).toHaveLength(0);
}

/**
 * Creates a FetchFactory that routes requests through Fastify's inject()
 * instead of real HTTP. This allows tests to use linkTo + navigate against
 * a server that is not listening on a port.
 *
 * The factory extracts the pathname + search from the URL constructed by
 * the library and passes it to inject, then wraps the inject response in
 * a standard Response object so the navigate pipeline can process it.
 */
// GET-only — suitable for read-only navigation tests (all current examples).
export function createInjectFetchFactory<Api extends ApiDefinition>(server: FastifyInstance): FetchFactory<Api> {
    return (_context) => async (url: string) => {
        const { pathname, search } = new URL(url);
        const res = await server.inject({ method: 'GET', url: pathname + search });
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
                headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
            }
        }
        return new Response(res.body, { status: res.statusCode, headers });
    };
}
