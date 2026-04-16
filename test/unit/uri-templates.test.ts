import { Type } from '@sinclair/typebox';
import { expandUriTemplate } from '../../src/uri-templates';

describe('expandUriTemplate', () => {
    it('should expand a valid simple template', () => {
        const config = {
            template: '/pets/{id}',
            schema: Type.Object({ id: Type.String() }),
            values: { id: '123' }
        };

        const result = expandUriTemplate(config);
        expect(result).toBe('/pets/123');
    });

    it('should expand a template with multiple variables', () => {
        const config = {
            template: '/pets/{id}/owners/{ownerId}',
            schema: Type.Object({
                id: Type.String(),
                ownerId: Type.String()
            }),
            values: { id: '123', ownerId: '456' }
        };

        const result = expandUriTemplate(config);
        expect(result).toBe('/pets/123/owners/456');
    });

    it('should expand query parameters', () => {
        const config = {
            template: '/pets{?sort,limit}',
            schema: Type.Object({
                sort: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number())
            }),
            values: { sort: 'asc', limit: 10 }
        };

        const result = expandUriTemplate(config);
        expect(result).toBe('/pets?sort=asc&limit=10');
    });

    it('should not compile if type of values do not match schema', () => {
        const config = {
            template: '/pets/{id}',
            schema: Type.Object({ id: Type.String() }),
            values: { id: 123 } // Number instead of string
        };

        // @ts-expect-error Testing runtime validation with wrong type
        expect(() => expandUriTemplate(config)).toThrow(/Values do not match schema/);
    });

    it('should not compile if values are missing a required property from schema', () => {
        const config = {
            template: '/pets/{id}',
            schema: Type.Object({ id: Type.String() }),
            values: {}
        };

        // @ts-expect-error Testing runtime validation with missing property
        expect(() => expandUriTemplate(config)).toThrow(/Values do not match schema/);
    });

    it('should throw if schema contains a property not present in template variables', () => {
        const config = {
            template: '/pets/{id}',
            schema: Type.Object({
                id: Type.String(),
                extra: Type.String() // Not in template
            }),
            values: { id: '123', extra: 'ignored' }
        };

        expect(() => expandUriTemplate(config)).toThrow(/Schema defines more properties than there are variables in the template \/pets\/\{id\}: extra/);
    });

    it('should ignore extra values not defined in schema during expansion', () => {
        // TypeBox validation allows extra properties by default.
        // The expansion uses only the template variables, so extra values are ignored.
        const config = {
            template: '/pets/{id}',
            schema: Type.Object({ id: Type.String() }),
            values: { id: '123', foo: 'bar' }
        };

        const result = expandUriTemplate(config);
        expect(result).toBe('/pets/123');
    });

    it('should handle complex type validation', () => {
        const config = {
            template: '/search{?ids}',
            schema: Type.Object({ ids: Type.Array(Type.String()) }),
            values: { ids: ['a', 'b'] }
        };
        // By default URI template expansion for list is specific.
        // {?ids} with ['a','b'] -> ?ids=a,b (or ids=a&ids=b depending on explode modifier)
        // @hyperjump/uri-template behavior:
        // Default (no modifier): comma separated

        const result = expandUriTemplate(config);
        expect(result).toBe('/search?ids=a,b');
    });

    it('should handle explode modifier', () => {
        const config = {
            template: '/search{?ids*}',
            schema: Type.Object({ ids: Type.Array(Type.String()) }),
            values: { ids: ['a', 'b'] }
        };

        const result = expandUriTemplate(config);
        expect(result).toBe('/search?ids=a&ids=b');
    });

    describe('Complex Edge Cases: Exploding Arrays', () => {
        it('should handle simple array without explode (comma-separated)', () => {
            const config = {
                template: '/search{?ids}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: ['a', 'b', 'c'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?ids=a,b,c');
        });

        it('should handle exploded array in query parameters (repeated params)', () => {
            const config = {
                template: '/search{?ids*}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: ['a', 'b', 'c'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?ids=a&ids=b&ids=c');
        });

        it('should handle simple array in path segments', () => {
            const config = {
                template: '/items{/ids}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: ['x', 'y', 'z'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/items/x,y,z');
        });

        it('should handle exploded array in path segments (separate segments)', () => {
            const config = {
                template: '/items{/ids*}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: ['x', 'y', 'z'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/items/x/y/z');
        });

        it('should handle array with numeric values', () => {
            const config = {
                template: '/filter{?years*}',
                schema: Type.Object({ years: Type.Array(Type.Number()) }),
                values: { years: [2020, 2021, 2022] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/filter?years=2020&years=2021&years=2022');
        });

        it('should handle empty array (produces empty result)', () => {
            const config = {
                template: '/search{?ids*}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: [] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search');
        });

        it('should handle single-element array', () => {
            const config = {
                template: '/search{?tags*}',
                schema: Type.Object({ tags: Type.Array(Type.String()) }),
                values: { tags: ['javascript'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?tags=javascript');
        });

        it('should handle mixed parameters with exploded array', () => {
            const config = {
                template: '/search{?q,tags*,limit}',
                schema: Type.Object({
                    q: Type.String(),
                    tags: Type.Array(Type.String()),
                    limit: Type.Number()
                }),
                values: { q: 'test', tags: ['js', 'ts'], limit: 10 }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?q=test&tags=js&tags=ts&limit=10');
        });
    });

    describe('Complex Edge Cases: Exploding Objects', () => {
        it('should handle simple object without explode (key-value pairs)', () => {
            const config = {
                template: '/api{?params}',
                schema: Type.Object({
                    params: Type.Object({
                        x: Type.String(),
                        y: Type.String()
                    })
                }),
                values: { params: { x: '1', y: '2' } }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?params=x,1,y,2');
        });

        it('should handle exploded object in query parameters (separate params)', () => {
            const config = {
                template: '/api{?params*}',
                schema: Type.Object({
                    params: Type.Object({
                        x: Type.String(),
                        y: Type.String()
                    })
                }),
                values: { params: { x: '1', y: '2' } }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?x=1&y=2');
        });

        it('should handle object with numeric values', () => {
            const config = {
                template: '/filter{?coords*}',
                schema: Type.Object({
                    coords: Type.Object({
                        lat: Type.Number(),
                        lng: Type.Number()
                    })
                }),
                values: { params: { lat: 40.7128, lng: -74.0060 } }
            };

            // Note: The schema defines 'coords' but we pass 'params' - this will fail validation
            // Let me fix this test
            const fixedConfig = {
                template: '/filter{?coords*}',
                schema: Type.Object({
                    coords: Type.Object({
                        lat: Type.Number(),
                        lng: Type.Number()
                    })
                }),
                values: { coords: { lat: 40.7128, lng: -74.0060 } }
            };

            const result = expandUriTemplate(fixedConfig);
            expect(result).toBe('/filter?lat=40.7128&lng=-74.006');
        });

        it('should handle empty object (produces empty result)', () => {
            const config = {
                template: '/api{?params*}',
                schema: Type.Object({
                    params: Type.Object({})
                }),
                values: { params: {} }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api');
        });
    });

    describe('Complex Edge Cases: Special Values and Characters', () => {
        it('should handle optional parameters with undefined values', () => {
            const config = {
                template: '/search{?q,page,limit}',
                schema: Type.Object({
                    q: Type.String(),
                    page: Type.Optional(Type.Number()),
                    limit: Type.Optional(Type.Number())
                }),
                values: { q: 'test' }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?q=test');
        });

        it('should URL-encode special characters in values', () => {
            const config = {
                template: '/search{?q}',
                schema: Type.Object({ q: Type.String() }),
                values: { q: 'hello world' }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?q=hello%20world');
        });

        it('should URL-encode ampersands and equals signs', () => {
            const config = {
                template: '/search{?q}',
                schema: Type.Object({ q: Type.String() }),
                values: { q: 'hello&world=test' }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?q=hello%26world%3Dtest');
        });

        it('should handle values with forward slashes', () => {
            const config = {
                template: '/api{?path}',
                schema: Type.Object({ path: Type.String() }),
                values: { path: 'folder/subfolder/file.txt' }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?path=folder%2Fsubfolder%2Ffile.txt');
        });

        it('should handle unicode characters', () => {
            const config = {
                template: '/search{?q}',
                schema: Type.Object({ q: Type.String() }),
                values: { q: 'café ☕' }
            };

            const result = expandUriTemplate(config);
            // Unicode should be percent-encoded
            expect(result).toMatch(/^\/search\?q=caf%/);
        });

        it('should handle null values by encoding them as string "null"', () => {
            const config = {
                template: '/api{?value}',
                schema: Type.Object({ value: Type.Union([Type.String(), Type.Null()]) }),
                values: { value: null }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?value=null');
        });

        it('should handle boolean values', () => {
            const config = {
                template: '/api{?active,archived}',
                schema: Type.Object({
                    active: Type.Boolean(),
                    archived: Type.Boolean()
                }),
                values: { active: true, archived: false }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?active=true&archived=false');
        });
    });

    describe('Complex Edge Cases: Validation Edge Cases', () => {
        it('should not compile if array contains wrong type elements', () => {
            const config = {
                template: '/items{?ids*}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: { ids: [1, 2, 3] } // Numbers instead of strings
            };

            // @ts-expect-error Testing runtime validation with wrong array element types
            expect(() => expandUriTemplate(config)).toThrow(/Values do not match schema/);
        });

        it('should not compile if object has wrong value types', () => {
            const config = {
                template: '/api{?params*}',
                schema: Type.Object({
                    params: Type.Object({
                        x: Type.Number(),
                        y: Type.Number()
                    })
                }),
                values: { params: { x: 'one', y: 'two' } } // Strings instead of numbers
            };

            // @ts-expect-error Testing runtime validation with wrong nested types
            expect(() => expandUriTemplate(config)).toThrow(/Values do not match schema/);
        });

        it('should not compile if required array is missing', () => {
            const config = {
                template: '/items{?ids*}',
                schema: Type.Object({ ids: Type.Array(Type.String()) }),
                values: {}
            };

            // @ts-expect-error Testing runtime validation with missing required property
            expect(() => expandUriTemplate(config)).toThrow(/Values do not match schema/);
        });

        it('should allow optional array to be missing', () => {
            const config = {
                template: '/items{?ids*}',
                schema: Type.Object({ ids: Type.Optional(Type.Array(Type.String())) }),
                values: {}
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/items');
        });

        it('should handle array of objects (though uncommon in URI templates)', () => {
            const config = {
                template: '/api{?items*}',
                schema: Type.Object({
                    items: Type.Array(Type.Object({
                        id: Type.String(),
                        name: Type.String()
                    }))
                }),
                values: { items: [{ id: '1', name: 'test' }] }
            };

            // This is a valid schema, expansion behavior depends on library
            const result = expandUriTemplate(config);
            expect(typeof result).toBe('string');
        });
    });

    describe('Edge Cases: URI Template Expansion Errors', () => {
        it('should throw when expansion fails (prefix modifier with composite value)', () => {
            // RFC 6570 §2.4.1: prefix modifiers are only valid for string values.
            // A composite value (array/object) passes TypeBox schema validation
            // but is rejected by the URI template engine during expansion.
            const config = {
                template: '/pets{?tags:3}',
                schema: Type.Object({ tags: Type.Array(Type.String()) }),
                values: { tags: ['food', 'toys'] },
            };

            expect(() => expandUriTemplate(config)).toThrow(
                /Failed to expand URI template \/pets\{\?tags:3\}/
            );
        });

        it('should sanitize expansion errors in safe mode', () => {
            const config = {
                template: '/pets{?tags:3}',
                schema: Type.Object({ tags: Type.Array(Type.String()) }),
                values: { tags: ['food', 'toys'] },
                verbosity: 'safe' as const,
            };

            expect(() => expandUriTemplate(config)).toThrow('URI template expansion failed');
            expect(() => expandUriTemplate(config)).not.toThrow(/pets/);
        });

        it('should wrap parsing errors with descriptive message', () => {
            // Parsing errors are caught in a dedicated try/catch and wrapped
            // with a "Failed to parse" prefix distinct from expansion errors
            const config = {
                template: '/pets/{id',  // Missing closing brace
                schema: Type.Object({ id: Type.String() }),
                values: { id: '123' }
            };

            // The error message should include both our wrapper and the original parse error
            expect(() => expandUriTemplate(config)).toThrow(/Failed to parse URI template \/pets\/{id - Error: Parse Error/);
        });

        it('should wrap parsing errors for invalid operators', () => {
            const config = {
                template: '/api/{%invalid}',  // Invalid operator
                schema: Type.Object({ invalid: Type.String() }),
                values: { invalid: 'test' }
            };

            // Should wrap the parse error nicely
            expect(() => expandUriTemplate(config)).toThrow(/Failed to parse URI template \/api\/{%invalid} - Error: Parse Error/);
        });
    });

    describe('verbosity: safe mode', () => {
        it('should sanitize validation error messages', () => {
            const config = {
                template: '/pets/{id}',
                schema: Type.Object({ id: Type.String() }),
                values: { id: 123 },
                verbosity: 'safe' as const
            };

            // @ts-expect-error Testing runtime validation with wrong type
            expect(() => expandUriTemplate(config)).toThrow('Invalid request parameters');
        });

        it('should not leak template structure in validation errors', () => {
            const config = {
                template: '/admin/users/{tenantId}/{userId}',
                schema: Type.Object({ tenantId: Type.String(), userId: Type.String() }),
                values: {},
                verbosity: 'safe' as const
            };

            // @ts-expect-error Testing runtime validation with missing properties
            const throwFn = () => expandUriTemplate(config);
            expect(throwFn).toThrow('Invalid request parameters');
            expect(throwFn).not.toThrow(/tenantId/);
            expect(throwFn).not.toThrow(/admin/);
        });

        it('should sanitize template parsing errors', () => {
            const config = {
                template: '/pets/{id',
                schema: Type.Object({ id: Type.String() }),
                values: { id: '123' },
                verbosity: 'safe' as const
            };

            expect(() => expandUriTemplate(config)).toThrow('URI template expansion failed');
        });

        it('should not leak template in parsing errors', () => {
            const config = {
                template: '/secret-endpoint/{id',
                schema: Type.Object({ id: Type.String() }),
                values: { id: '123' },
                verbosity: 'safe' as const
            };

            const throwFn = () => expandUriTemplate(config);
            expect(throwFn).toThrow('URI template expansion failed');
            expect(throwFn).not.toThrow(/secret-endpoint/);
        });

        it('should sanitize schema-mismatch errors', () => {
            const config = {
                template: '/pets/{id}',
                schema: Type.Object({
                    id: Type.String(),
                    extra: Type.String()
                }),
                values: { id: '123', extra: 'ignored' },
                verbosity: 'safe' as const
            };

            expect(() => expandUriTemplate(config)).toThrow('URI template expansion failed');
        });

        it('should not leak template or property names in schema-mismatch errors', () => {
            const config = {
                template: '/internal/api/v2/users/{id}',
                schema: Type.Object({
                    id: Type.String(),
                    secret: Type.String(),
                    internalFlag: Type.String()
                }),
                values: { id: '123', secret: 'val', internalFlag: 'val' },
                verbosity: 'safe' as const
            };

            const throwFn = () => expandUriTemplate(config);
            expect(throwFn).toThrow('URI template expansion failed');
            expect(throwFn).not.toThrow(/internal/);
            expect(throwFn).not.toThrow(/secret/);
            expect(throwFn).not.toThrow(/internalFlag/);
        });

        it('should still expand valid templates normally', () => {
            const config = {
                template: '/pets/{id}',
                schema: Type.Object({ id: Type.String() }),
                values: { id: '123' },
                verbosity: 'safe' as const
            };

            expect(expandUriTemplate(config)).toBe('/pets/123');
        });
    });

    describe('Complex Edge Cases: Multiple Operators', () => {
        it('should handle path and query parameters together', () => {
            const config = {
                template: '/users/{userId}/posts{?tags*,limit}',
                schema: Type.Object({
                    userId: Type.String(),
                    tags: Type.Array(Type.String()),
                    limit: Type.Number()
                }),
                values: { userId: '123', tags: ['tech', 'coding'], limit: 10 }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/users/123/posts?tags=tech&tags=coding&limit=10');
        });

        it('should handle fragment with exploded array', () => {
            const config = {
                template: '/page{#sections*}',
                schema: Type.Object({ sections: Type.Array(Type.String()) }),
                values: { sections: ['intro', 'body', 'conclusion'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/page#intro,body,conclusion');
        });

        it('should handle continuation operator with array after query parameter', () => {
            const config = {
                template: '/search{?q}{&filters*}',
                schema: Type.Object({
                    q: Type.String(),
                    filters: Type.Array(Type.String())
                }),
                values: { q: 'products', filters: ['active', 'verified'] }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/search?q=products&filters=active&filters=verified');
        });

        it('should handle multiple continuation operators', () => {
            const config = {
                template: '/api{?search}{&sort}{&limit}',
                schema: Type.Object({
                    search: Type.String(),
                    sort: Type.String(),
                    limit: Type.Number()
                }),
                values: { search: 'test', sort: 'asc', limit: 10 }
            };

            const result = expandUriTemplate(config);
            expect(result).toBe('/api?search=test&sort=asc&limit=10');
        });
    });
});
