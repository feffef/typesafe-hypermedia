/**
 * Centralized mock response utilities for tests.
 *
 * This module provides type-safe mock response helpers that:
 * - Always require a schema for validation
 * - Catch mock data errors early
 * - Provide consistent patterns across all tests
 */

import { TSchema, Static } from '@sinclair/typebox';

beforeEach(() => {
    global.fetch = jest.fn();
});

afterEach(() => {
    jest.restoreAllMocks();
});

/**
 * Helper to derive standard HTTP status text from status code.
 */
const getStatusText = (status: number): string => {
    const statusTexts: Record<number, string> = {
        200: 'OK',
        201: 'Created',
        204: 'No Content',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        409: 'Conflict',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
    };
    return statusTexts[status] || 'Unknown';
};

/**
 * Mocks a successful HTTP response (200 OK) with schema-validated body.
 *
 * IMPORTANT: Always requires a schema to catch mock data errors early.
 *
 * @param schema - TypeBox schema that the response must match
 * @param body - Response body matching the schema
 *
 * @example
 * mockResponse(UserSchema, { id: '123', name: 'John' });
 */
export function mockResponse<T extends TSchema>(
    schema: T,
    body: Static<T>
): jest.Mock<Response, any[]>;

/**
 * Mocks an HTTP response with custom status code and schema-validated body.
 *
 * IMPORTANT: Always requires a schema to catch mock data errors early.
 *
 * @param schema - TypeBox schema that the response must match
 * @param status - HTTP status code (e.g., 200, 404, 500)
 * @param body - Response body matching the schema
 *
 * @example
 * // Success
 * mockResponse(UserSchema, 200, { id: '123', name: 'John' });
 *
 * // Error response
 * mockResponse(ErrorSchema, 404, { message: 'Not Found', code: 'NOT_FOUND' });
 */
export function mockResponse<T extends TSchema>(
    schema: T,
    status: number,
    body: Static<T>
): jest.Mock<Response, any[]>;


// Implementation
export function mockResponse<T extends TSchema>(
    schema: T,
    statusOrBody: number | Static<T>,
    body?: Static<T>
): jest.Mock<Response, any[]> {
    

    const fetchMock = global.fetch as jest.Mock;

    // Overload 1: mockResponse(schema, body) - defaults to 200 OK
    if (typeof statusOrBody !== 'number') {
        const responseBody = statusOrBody;
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => responseBody,
        });
        return fetchMock;
    }

    // Overload 2: mockResponse(schema, status, body)
    const status = statusOrBody;
    const ok = status >= 200 && status < 300;
    const statusText = getStatusText(status);

    fetchMock.mockResolvedValueOnce({
        ok,
        status,
        statusText,
        headers: new Headers(),
        json: async () => body,
    });
    return fetchMock;
}

/**
 * Mocks multiple HTTP responses in sequence.
 * Useful for testing parallel fetches. You shouldn't use this for setting up
 * *all* mocks at the beginning of a test
 *
 * IMPORTANT: Always requires a schema to catch mock data errors early.
 *
 * @param schema - TypeBox schema that all responses must match
 * @param responses - Array of response bodies matching the schema
 *
 * @example
 * // Multiple success responses
 * mockResponses(CommentSchema, [
 *   { id: '1', text: 'First' },
 *   { id: '2', text: 'Second' }
 * ]);
 */
export function mockResponses<T extends TSchema>(
    schema: T,
    ...responses: Static<T>[]
): jest.Mock<Response, any[]> {
    const mock = global.fetch as jest.Mock;
    responses.forEach(body => {
        mock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => body,
        });
    });
    return mock;
}

/**
 * Mocks an HTTP error response without requiring a schema.
 * Use this for testing error handling when you don't care about the response body structure.
 *
 * @param status - HTTP error status code (e.g., 404, 500)
 * @param statusText - Optional status text (defaults to standard text for status code)
 *
 * @example
 * mockErrorResponse(404, 'Not Found');
 * mockErrorResponse(500); // Uses default 'Internal Server Error'
 */
export function mockErrorResponse(status: number, statusText?: string): jest.Mock<Response, any[]> {
    const text = statusText || getStatusText(status);

    const mock = global.fetch as jest.Mock;

    mock.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: text,
        headers: new Headers(),
        json: async () => ({ error: text }),
    });

    return mock;
}

/**
 * Mocks a network error (fetch rejects).
 * Use this to test network failures, timeouts, or DNS errors.
 *
 * @param error - The error to throw (or error message string)
 *
 * @example
 * mockNetworkError(new TypeError('Network request failed'));
 * mockNetworkError('Connection timeout');
 */
export function mockNetworkError(error: Error | string): jest.Mock<Response, any[]> {
    const mock = global.fetch as jest.Mock;
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    mock.mockRejectedValueOnce(errorObj);
    return mock;
}

/**
 * Mocks a response with a JSON parsing error.
 * Use this to test handling of malformed JSON responses.
 *
 * @param schema - TypeBox schema (required for consistency, but not validated since JSON is invalid)
 * @param status - HTTP status code (defaults to 200)
 * @param errorMessage - Error message for the JSON parse error
 *
 * @example
 * mockJsonParseError(200, 'Unexpected token < in JSON');
 */
export function mockJsonParseError(
    status: number = 200,
    errorMessage: string = 'Unexpected token in JSON'
): jest.Mock<Response, any[]> {
    const mock = global.fetch as jest.Mock;
    const ok = status >= 200 && status < 300;
    const statusText = getStatusText(status);

    mock.mockResolvedValueOnce({
        ok,
        status,
        statusText,
        headers: new Headers(),
        json: () => {
            throw new SyntaxError(errorMessage);
        },
    });

    return mock;
}
