import { defineLinks } from '../../src';
import { Type } from '@sinclair/typebox';
import {
    LinkSchema,
    OnlyIdSchema,
    NestedLinksSchema,
    ErrorSchema,
    DeepNestingSchema,
    IntersectionLinkSchema
} from '../test-schemas';

describe('defineLinks', () => {
    describe('API definition structure', () => {
        it('should reject declared but undefined resources', () => {
            expect(() => defineLinks(['resource', 'missing'], {
                resource: {
                    schema: Type.Object({ link: LinkSchema }),
                    links: { 'link': { to: 'resource' } }
                }
            })).toThrow("Resource 'missing' declared in resource names but not defined");
        });

        it('should reject defined but undeclared resources', () => {
            expect(() => defineLinks(['resource'], {
                resource: {
                    schema: Type.Object({ link: LinkSchema }),
                    links: { 'link': { to: 'resource' } }
                },
                extra: { schema: OnlyIdSchema, links: {} }
            } as any)).toThrow("Resource 'extra' defined in API definition but not declared");
        });
    });

    describe('link path validation', () => {
        it('should accept all valid nested link paths', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: NestedLinksSchema,
                    links: {
                        'requiredLink.href': { to: 'target' },
                        'optionalLink.href': { to: 'target' },
                        'manyLinks[].href': { to: 'target' },
                        'nested.deepLink.href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should reject invalid link paths', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: NestedLinksSchema,
                    links: {
                        'requiredLink.href': { to: 'target' },
                        'optionalLink.href': { to: 'target' },
                        'manyLinks[].href': { to: 'target' },
                        'nested.deepLink.href': { to: 'target' },
                        'nonExistentLink': { to: 'target' } as any
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow('Invalid link path \'nonExistentLink\' in resource \'resource\': Property does not exist in schema');
        });
    });

    describe('optional schema handling', () => {
        it('should handle Optional(Array(Link))', () => {
            const schema = Type.Object({
                items: Type.Optional(Type.Array(LinkSchema))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: { schema, links: { 'items[].href': { to: 'target' } } },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should reject Optional(Array) without [] suffix', () => {
            const schema = Type.Object({
                items: Type.Optional(Type.Array(LinkSchema))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: { schema, links: { 'items.href': { to: 'target' } } },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow('Invalid link path \'items.href\' in resource \'resource\': Property does not exist in schema');
        });

        it('should handle Optional(Array(Object)) with nested links', () => {
            const schema = Type.Object({
                items: Type.Optional(Type.Array(Type.Object({
                    link: LinkSchema
                })))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: { schema, links: { 'items[].link.href': { to: 'target' } } },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should handle Array(Object) with nested links', () => {
            const schema = Type.Object({
                items: Type.Array(Type.Object({ link: LinkSchema }))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: { schema, links: { 'items[].link.href': { to: 'target' } } },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should handle Optional(Object) with nested links', () => {
            const schema = Type.Object({
                nested: Type.Optional(Type.Object({ link: LinkSchema }))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: { schema, links: { 'nested.link.href': { to: 'target' } } },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should handle deeply nested optional structures', () => {
            expect(() => defineLinks(['deep'], {
                deep: {
                    schema: DeepNestingSchema,
                    links: {
                        // Direct resource with all link types
                        'resource.requiredLink.href': { to: 'deep' },
                        'resource.presentLink.href': { to: 'deep' },
                        'resource.missingLink.href': { to: 'deep' },
                        'resource.requiredTemplate.href': { to: 'deep' },
                        'resource.presentTemplate.href': { to: 'deep' },
                        'resource.missingTemplate.href': { to: 'deep' },
                        'resource.arrayOfLinks[].href': { to: 'deep' },
                        // Nested object paths
                        'nested.resource.requiredLink.href': { to: 'deep' },
                        'nested.resource.presentLink.href': { to: 'deep' },
                        'nested.resource.missingLink.href': { to: 'deep' },
                        'nested.resource.requiredTemplate.href': { to: 'deep' },
                        'nested.resource.presentTemplate.href': { to: 'deep' },
                        'nested.resource.missingTemplate.href': { to: 'deep' },
                        'nested.resource.arrayOfLinks[].href': { to: 'deep' },
                        // Double nested
                        'nested.nested.resource.requiredLink.href': { to: 'deep' },
                        'nested.nested.resource.presentLink.href': { to: 'deep' },
                        'nested.nested.resource.missingLink.href': { to: 'deep' },
                        'nested.nested.resource.requiredTemplate.href': { to: 'deep' },
                        'nested.nested.resource.presentTemplate.href': { to: 'deep' },
                        'nested.nested.resource.missingTemplate.href': { to: 'deep' },
                        'nested.nested.resource.arrayOfLinks[].href': { to: 'deep' },
                        // Mixed: nested → array
                        'nested.items[].resource.requiredLink.href': { to: 'deep' },
                        'nested.items[].resource.presentLink.href': { to: 'deep' },
                        'nested.items[].resource.missingLink.href': { to: 'deep' },
                        'nested.items[].resource.requiredTemplate.href': { to: 'deep' },
                        'nested.items[].resource.presentTemplate.href': { to: 'deep' },
                        'nested.items[].resource.missingTemplate.href': { to: 'deep' },
                        'nested.items[].resource.arrayOfLinks[].href': { to: 'deep' },
                        // Array paths
                        'items[].resource.requiredLink.href': { to: 'deep' },
                        'items[].resource.presentLink.href': { to: 'deep' },
                        'items[].resource.missingLink.href': { to: 'deep' },
                        'items[].resource.requiredTemplate.href': { to: 'deep' },
                        'items[].resource.presentTemplate.href': { to: 'deep' },
                        'items[].resource.missingTemplate.href': { to: 'deep' },
                        'items[].resource.arrayOfLinks[].href': { to: 'deep' },
                        // Mixed: array → nested
                        'items[].nested.resource.requiredLink.href': { to: 'deep' },
                        'items[].nested.resource.presentLink.href': { to: 'deep' },
                        'items[].nested.resource.missingLink.href': { to: 'deep' },
                        'items[].nested.resource.requiredTemplate.href': { to: 'deep' },
                        'items[].nested.resource.presentTemplate.href': { to: 'deep' },
                        'items[].nested.resource.missingTemplate.href': { to: 'deep' },
                        'items[].nested.resource.arrayOfLinks[].href': { to: 'deep' },
                        // Nested array paths (array → array)
                        'items[].items[].resource.requiredLink.href': { to: 'deep' },
                        'items[].items[].resource.presentLink.href': { to: 'deep' },
                        'items[].items[].resource.missingLink.href': { to: 'deep' },
                        'items[].items[].resource.requiredTemplate.href': { to: 'deep' },
                        'items[].items[].resource.presentTemplate.href': { to: 'deep' },
                        'items[].items[].resource.missingTemplate.href': { to: 'deep' },
                        'items[].items[].resource.arrayOfLinks[].href': { to: 'deep' },
                        // Mixed: array → nested → array
                        'items[].nested.items[].resource.requiredLink.href': { to: 'deep' },
                        'items[].nested.items[].resource.presentLink.href': { to: 'deep' },
                        'items[].nested.items[].resource.missingLink.href': { to: 'deep' },
                        'items[].nested.items[].resource.requiredTemplate.href': { to: 'deep' },
                        'items[].nested.items[].resource.presentTemplate.href': { to: 'deep' },
                        'items[].nested.items[].resource.missingTemplate.href': { to: 'deep' },
                        'items[].nested.items[].resource.arrayOfLinks[].href': { to: 'deep' }
                    }
                }
            })).not.toThrow();
        });
    });

    describe('link target validation', () => {
        it('should allow self-references', () => {
            expect(() => defineLinks(['resource'], {
                resource: {
                    schema: Type.Object({ link: LinkSchema }),
                    links: { 'link.href': { to: 'resource' } }
                }
            })).not.toThrow();
        });

        it('should allow circular references between resources', () => {
            expect(() => defineLinks(['a', 'b'], {
                a: {
                    schema: Type.Object({ toB: LinkSchema }),
                    links: { 'toB.href': { to: 'b' } }
                },
                b: {
                    schema: Type.Object({ toA: LinkSchema }),
                    links: { 'toA.href': { to: 'a' } }
                }
            })).not.toThrow();
        });

        it('should reject links targeting undefined resources', () => {
            expect(() => defineLinks(['resource'], {
                resource: {
                    schema: Type.Object({ link: LinkSchema }),
                    links: {
                        // @ts-expect-error - testing runtime validation
                        'link.href': { to: 'unregistered' }
                    }
                }
            })).toThrow("Link 'link.href' in resource 'resource' targets resource 'unregistered' which is not defined");
        });
    });

    describe('parameterized link validation', () => {
        it('should reject a terminal array segment regardless of params (with params)', () => {
            // A link path whose terminal segment is a bare '[]' marker is
            // meaningless: the array marker says "iterate", but the terminal
            // needs a property name to extract a string href. This was
            // previously deferred to the runtime guard inside `traverse` —
            // defineLinks now rejects it up front with the same suggested-fix
            // message format as the runtime guard. The presence of `params`
            // is irrelevant; the path itself is invalid.
            const schema = Type.Object({ urls: Type.Array(Type.String()) });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema,
                    links: {
                        'urls[]': {
                            to: 'target',
                            params: { id: Type.String() }
                        }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow(
                /Array segment 'urls\[\]' cannot be terminal\. Specify the property name to extract \(e\.g\., 'urls\[\]\.href'\)/
            );
        });

        it('should reject a terminal array segment even without params', () => {
            // The terminal-array check fires for paths that defineLinks would
            // previously accept (no params, schema allows the path).
            const schema = Type.Object({ tags: Type.Optional(Type.Array(Type.String())) });

            expect(() => defineLinks(['tagged'], {
                tagged: {
                    schema,
                    links: {
                        'tags[]': { to: 'tagged' }
                    }
                }
            })).toThrow(
                /Array segment 'tags\[\]' cannot be terminal\. Specify the property name to extract \(e\.g\., 'tags\[\]\.href'\)/
            );
        });

        it('should report property-does-not-exist for completely unknown paths', () => {
            const schema = Type.Object({ items: Type.Array(LinkSchema) });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema,
                    links: {
                        'invalidPath[].href': {
                            to: 'target',
                            params: { id: Type.String() }
                        } as any
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow('Invalid link path \'invalidPath[].href\' in resource \'resource\': Property does not exist in schema');
        });

        it('should accept a bare property-bag params (no Type.Object wrapper)', () => {
            // FINDING-07: LinkDefinition.params is typed as TProperties so callers
            // pass the property bag directly instead of wrapping with Type.Object(...).
            // The framework wraps internally where a TObject is needed.
            const schema = Type.Object({ link: LinkSchema });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema,
                    links: {
                        'link.href': {
                            to: 'target',
                            params: { id: Type.Number() }
                        }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });
    });

    describe('error response validation', () => {
        const ResourceWithLink = Type.Object({ action: LinkSchema });

        it('should accept valid error responses', () => {
            expect(() => defineLinks(['resource', 'target', 'notFound'], {
                resource: {
                    schema: ResourceWithLink,
                    links: { 'action.href': { to: 'target', expect: { 404: 'notFound' } } }
                },
                target: { schema: OnlyIdSchema, links: {} },
                notFound: { schema: ErrorSchema, links: {} }
            })).not.toThrow();
        });

        it('should accept multiple status codes mapping to same error', () => {
            expect(() => defineLinks(['resource', 'target', 'notFound'], {
                resource: {
                    schema: ResourceWithLink,
                    links: { 'action.href': { to: 'target', expect: { 404: 'notFound', 410: 'notFound' } } }
                },
                target: { schema: OnlyIdSchema, links: {} },
                notFound: { schema: ErrorSchema, links: {} }
            })).not.toThrow();
        });

        it('should reject unknown error resources', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: ResourceWithLink,
                    links: { 'action.href': { to: 'target', expect: { 404: 'notFound' } } as any }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Link 'action.href' in resource 'resource' references unknown resource 'notFound'");
        });

        it('should reject invalid status codes (< 400 or > 599)', () => {
            const schema = Type.Object({
                action1: LinkSchema,
                action2: LinkSchema,
                action3: LinkSchema
            });

            try {
                defineLinks(['resource', 'target', 'error'], {
                    resource: {
                        schema,
                        links: {
                            'action1.href': { to: 'target', expect: { 200: 'error' } as any },
                            'action2.href': { to: 'target', expect: { 399: 'error' } as any },
                            'action3.href': { to: 'target', expect: { 600: 'error' } as any }
                        }
                    },
                    target: { schema: OnlyIdSchema, links: {} },
                    error: { schema: ErrorSchema, links: {} }
                });
                fail('Expected defineLinks to throw an error');
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain('API definition validation failed');
                expect(message).toContain('200');
                expect(message).toContain('399');
                expect(message).toContain('600');
            }
        });

        it('should accept valid status codes (400-599)', () => {
            const schema = Type.Object({
                action1: LinkSchema,
                action2: LinkSchema
            });

            expect(() => defineLinks(['resource', 'target', 'error'], {
                resource: {
                    schema,
                    links: {
                        'action1.href': { to: 'target', expect: { 400: 'error' } },
                        'action2.href': { to: 'target', expect: { 599: 'error' } }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} },
                error: { schema: ErrorSchema, links: {} }
            })).not.toThrow();
        });

        it('should reject expect on array links', () => {
            const schema = Type.Object({ items: Type.Array(LinkSchema) });

            expect(() => defineLinks(['resource', 'target', 'error'], {
                resource: {
                    schema,
                    links: { 'items[].href': { to: 'target', expect: { 404: 'error' } as any } }
                },
                target: { schema: OnlyIdSchema, links: {} },
                error: { schema: ErrorSchema, links: {} }
            })).toThrow("Link 'items[].href' in resource 'resource' defines error responses, but array links do not support error responses");
        });

        it('should allow previously-reserved names (message, cause, resp) in expect maps', () => {
            // With the Failure discriminated union, only 'unexpected' is reserved.
            expect(() => defineLinks(['shop', 'message'], {
                shop: {
                    schema: Type.Object({ link: Type.String() }),
                    links: {
                        link: { to: 'message', expect: { 404: 'message' } }
                    }
                },
                message: {
                    schema: Type.Object({ text: Type.String() }),
                    links: {}
                }
            })).not.toThrow();
        });

        it('should reject "unexpected" as an error resource name', () => {
            expect(() => defineLinks(['shop', 'unexpected'], {
                shop: {
                    schema: Type.Object({ link: Type.String() }),
                    links: {
                        // as any: bypass compile-time Exclude<ValidNames, ReservedErrorKeys> to test the runtime guard
                        link: { to: 'unexpected', expect: { 500: 'unexpected' as any } }
                    }
                },
                unexpected: {
                    schema: Type.Object({ detail: Type.String() }),
                    links: {}
                }
            })).toThrow(/reserved Failure discriminant value/);
        });

        it('should reject "unexpected" as error resource name at compile time', () => {
            // TypeScript rejects 'unexpected' in the expect map at compile time (Exclude<ValidNames, ReservedErrorKeys>).
            // The @ts-expect-error directive confirms the compile-time constraint is active.
            expect(() => defineLinks(['resource', 'target', 'unexpected'], {
                resource: {
                    schema: Type.Object({ link: LinkSchema }),
                    links: {
                        // @ts-expect-error - 'unexpected' is a reserved Failure discriminant
                        'link.href': { to: 'target', expect: { 500: 'unexpected' } }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} },
                unexpected: { schema: OnlyIdSchema, links: {} }
            })).toThrow(/reserved Failure discriminant value/);
        });

        it('should collect and report all validation errors together', () => {
            const schema = Type.Object({
                action1: LinkSchema,
                action2: LinkSchema
            });

            try {
                defineLinks(['resource', 'target'], {
                    resource: {
                        schema,
                        links: {
                            'action1': {
                                to: 'target',
                                expect: {
                                    404: 'notFound',  // Unknown resource
                                    200: 'error'      // Invalid status code
                                }
                            } as any,
                            'action2': {
                                to: 'target',
                                expect: { 404: 'validationError' }  // Unknown resource
                            } as any
                        }
                    },
                    target: { schema: OnlyIdSchema, links: {} }
                });
                fail('Expected defineLinks to throw an error');
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toContain('API definition validation failed');
                expect(message).toContain('notFound');
                expect(message).toContain('200');
                expect(message).toContain('validationError');
            }
        });
    });

    describe('union and intersection support', () => {
        it('should detect links in unions and intersections', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        intersection: IntersectionLinkSchema,
                        union: Type.Union([LinkSchema, Type.Object({ foo: Type.String() })]),
                        items: Type.Array(IntersectionLinkSchema)
                    }),
                    links: {
                        'intersection.href': { to: 'target' },
                        'union.href': { to: 'target' },
                        'items[].href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should reject non-link unions and intersections', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        notALink: Type.Union([
                            Type.Object({ foo: Type.String() }),
                            Type.Object({ bar: Type.Number() })
                        ])
                    }),
                    links: {
                        'notALink.href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow('Invalid link path \'notALink.href\' in resource \'resource\': Property does not exist in schema');
        });

        it('should handle arrays wrapped in intersections', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        // Array wrapped in an intersection
                        items: Type.Intersect([
                            Type.Array(LinkSchema),
                            Type.Object({ metadata: Type.String() })
                        ])
                    }),
                    links: {
                        'items[].href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });

        it('should handle arrays wrapped in unions', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        // Array wrapped in a union
                        items: Type.Union([
                            Type.Array(LinkSchema),
                            Type.Object({ alternativeData: Type.String() })
                        ])
                    }),
                    links: {
                        'items[].href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).not.toThrow();
        });
    });

    describe('Type.Ref schema resolution', () => {
        const AddressSchema = Type.Object({
            street: Type.String(),
            city: Type.String(),
            mapsUrl: Type.String()
        }, { $id: 'Address' });

        it('should resolve Type.Ref when schemas option is provided', () => {
            const UserSchema = Type.Object({
                name: Type.String(),
                address: Type.Ref('Address')
            });

            expect(() => defineLinks(['user', 'map'], {
                user: {
                    schema: UserSchema,
                    links: { 'address.mapsUrl': { to: 'map' } }
                },
                map: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { Address: AddressSchema } })).not.toThrow();
        });

        it('should auto-resolve Type.Ref from resource schemas with $id', () => {
            const UserSchema = Type.Object({
                name: Type.String(),
                address: Type.Ref('Address')
            });

            // AddressSchema has $id: 'Address' and is used as a resource schema,
            // so it should be auto-discovered without explicit schemas option
            expect(() => defineLinks(['user', 'map', 'address'], {
                user: {
                    schema: UserSchema,
                    links: { 'address.mapsUrl': { to: 'map' } }
                },
                map: { schema: OnlyIdSchema, links: {} },
                address: { schema: AddressSchema, links: {} }
            })).not.toThrow();
        });

        it('should treat unresolvable Type.Ref as missing property (graceful fallback)', () => {
            const UserSchema = Type.Object({
                name: Type.String(),
                address: Type.Ref('UnknownSchema')
            });

            // Without schemas option and no matching $id in API — the $ref can't be
            // resolved, so 'address.street' is treated as nonexistent (same as today)
            expect(() => defineLinks(['user', 'target'], {
                user: {
                    schema: UserSchema,
                    links: { 'address.street': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Invalid link path 'address.street' in resource 'user': Property does not exist in schema");
        });

        it('should resolve Type.Ref for array items', () => {
            const ItemSchema = Type.Object({
                href: Type.String(),
                title: Type.String()
            }, { $id: 'Item' });

            const ListSchema = Type.Object({
                items: Type.Array(Type.Ref('Item'))
            });

            expect(() => defineLinks(['list', 'detail'], {
                list: {
                    schema: ListSchema,
                    links: { 'items[].href': { to: 'detail' } }
                },
                detail: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { Item: ItemSchema } })).not.toThrow();
        });
    });

    describe('edge cases in array unwrapping', () => {
        it('should reject array notation on non-array properties', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        // Object with href, but not wrapped in an array
                        notAnArray: LinkSchema
                    }),
                    links: {
                        // Using [] notation on non-array should fail
                        'notAnArray[].href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Array notation [] used on non-array property");
        });

        it('should reject array notation on union without arrays', () => {
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: Type.Object({
                        // Union of objects (both have href), but neither branch is an array
                        noArrayInUnion: Type.Union([
                            LinkSchema,
                            Type.Object({ href: Type.String(), alternative: Type.Boolean() })
                        ])
                    }),
                    links: {
                        // Using [] notation when no branch is an array should fail
                        'noArrayInUnion[].href': { to: 'target' }
                    }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Array notation [] used on non-array property");
        });

        it('should treat unresolvable Type.Ref in array items as missing ([] on non-array via ref)', () => {
            // A Ref inside an array position that cannot be resolved — collectArrayItems
            // will encounter a Ref, resolve returns undefined, and unwrappedSchemas stays empty.
            // This exercises the `if (derefed)` false branch in collectArrayItems and the
            // `unwrappedSchemas.length === 0` early return in resolveSchemaAtPath.
            const ContainerSchema = Type.Object({
                items: Type.Array(Type.Ref('UnresolvableItem'))
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: ContainerSchema,
                    links: { 'items[].href': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Invalid link path 'items[].href' in resource 'resource': Property does not exist in schema");
        });

        it('should resolve Type.Ref pointing directly to an array (collectArrayItems IsRef path)', () => {
            // When a property's value is itself a Type.Ref to an array schema,
            // collectArrayItems is called with the Ref node — exercising the IsRef
            // branch inside collectArrayItems (not just collectProperties).
            const LinkArraySchema = Type.Array(Type.Object({
                href: Type.String()
            }), { $id: 'LinkArray' });

            const ContainerSchema = Type.Object({
                // Property value is a Ref to an array — not Array(Ref(...))
                items: Type.Ref('LinkArray')
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: ContainerSchema,
                    links: { 'items[].href': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { LinkArray: LinkArraySchema } })).not.toThrow();
        });
    });

    describe('cycle detection in $ref resolution', () => {
        it('should not loop infinitely when a $ref resolves to a schema containing the same $ref (collectProperties)', () => {
            // NodeSchema has $id 'Node' and contains a child property that is Type.Ref('Node').
            // When collectProperties follows the ref and encounters the same ref again, the
            // visitedRefs cycle guard must fire (the `return` early-exit branch).
            const NodeSchema = Type.Object({
                value: Type.String(),
                child: Type.Ref('Node')
            }, { $id: 'Node' });

            // 'child.value' traversal: root.child → Ref('Node') → NodeSchema → NodeSchema.child
            // → Ref('Node') again → cycle detected, stop.
            // Result: 'value' is found via the first deref, so the link is valid.
            expect(() => defineLinks(['tree', 'target'], {
                tree: {
                    schema: NodeSchema,
                    links: { 'child.value': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { Node: NodeSchema } })).not.toThrow();
        });

        it('should trigger cycle guard in collectProperties when union branch re-introduces same $ref', () => {
            // SchemaA resolves to Union([Object({value}), Ref('SchemaA')]).
            // When collectProperties processes the union it calls itself recursively on Ref('SchemaA'),
            // which is already in visitedRefs — the cycle guard `return` fires on that branch.
            // This directly exercises line 350 (the `if (visitedRefs.has(...)) return` branch).
            const SchemaA = Type.Union([
                Type.Object({ value: Type.String() }),
                Type.Ref('SchemaA')
            ], { $id: 'SchemaA' });

            // Traversing 'value' when the root schema is a Ref to SchemaA:
            // collectProperties(Ref('SchemaA'), 'value', ...) → resolve → SchemaA (union)
            //   → branch 1: Object({value}) → found ✓
            //   → branch 2: Ref('SchemaA') → already in visitedRefs → cycle guard fires
            const RootSchema = Type.Object({ a: Type.Ref('SchemaA') });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: RootSchema,
                    links: { 'a.value': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { SchemaA } })).not.toThrow();
        });

        it('should trigger cycle guard in collectArrayItems when union branch re-introduces same $ref', () => {
            // SchemaB resolves to Union([Array(Object({href})), Ref('SchemaB')]).
            // When collectArrayItems processes the union it calls itself on Ref('SchemaB'),
            // which is already in visitedRefs — the cycle guard fires on that branch.
            // This exercises the cycle `return` inside collectArrayItems (the true branch of
            // `if (visitedRefs.has(schema.$ref))`).
            const SchemaB = Type.Union([
                Type.Array(Type.Object({ href: Type.String() })),
                Type.Ref('SchemaB')
            ], { $id: 'SchemaB' });

            // items is a Ref to SchemaB, and the path uses [] to unwrap it.
            // collectArrayItems(Ref('SchemaB'), ...) → resolve → Union
            //   → branch 1: Array(Object({href})) → pushes Object({href}) ✓
            //   → branch 2: Ref('SchemaB') → already in visitedRefs → cycle guard fires
            const ContainerSchema = Type.Object({ items: Type.Ref('SchemaB') });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: ContainerSchema,
                    links: { 'items[].href': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { SchemaB } })).not.toThrow();
        });

        it('should treat unresolvable Type.Ref as empty when used directly in array position', () => {
            // When a property IS a Type.Ref (not wrapped in Array) and the ref cannot be resolved,
            // collectArrayItems encounters the Ref, resolves to undefined, and does nothing.
            // This exercises the `if (derefed)` false branch inside collectArrayItems IsRef block.
            const ContainerSchema = Type.Object({
                // Property is a direct Ref to an unknown schema (not wrapped in Array)
                items: Type.Ref('UnresolvableArray')
            });

            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: ContainerSchema,
                    links: { 'items[].href': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            })).toThrow("Invalid link path 'items[].href' in resource 'resource': Property does not exist in schema");
        });

        it('should handle mutual $ref cycles between two schemas without infinite recursion', () => {
            // SchemaA has a field that refs SchemaB, and SchemaB has a field that refs SchemaA.
            const SchemaA = Type.Object({
                href: Type.String(),
                b: Type.Ref('SchemaB')
            }, { $id: 'SchemaA' });

            const SchemaB = Type.Object({
                label: Type.String(),
                a: Type.Ref('SchemaA')
            }, { $id: 'SchemaB' });

            // Traversing 'b.a.href': Ref(B) → SchemaB → SchemaB.a → Ref(A) → SchemaA → href ✓
            // On a second visit of Ref(A) the cycle guard fires.
            expect(() => defineLinks(['resource', 'target'], {
                resource: {
                    schema: SchemaA,
                    links: { 'b.a.href': { to: 'target' } }
                },
                target: { schema: OnlyIdSchema, links: {} }
            }, { schemas: { SchemaA, SchemaB } })).not.toThrow();
        });
    });
});
