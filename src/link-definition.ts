import { TSchema, TypeGuard, Kind, TProperties } from '@sinclair/typebox';

/**
 * Resource names that cannot be used as error resource names in `expect` maps.
 *
 * With the `Failure` discriminated union, the only collision is `'unexpected'` —
 * it's the `kind` value for the catch-all unexpected Failure variant.
 *
 * Inlined here (rather than imported from error-handling.ts) to avoid a
 * circular dependency: error-handling.ts already imports from this module.
 */
type ReservedErrorKeys = 'unexpected';

/** Runtime counterpart of `ReservedErrorKeys` — kept in sync manually. */
const RESERVED_ERROR_KEYS = new Set<ReservedErrorKeys>(['unexpected']);

/**
 * Resolves a `$ref` string to its corresponding schema.
 *
 * Used during link path validation to dereference `Type.Ref(...)` nodes in the
 * schema tree. When the traversal encounters a `{ $ref: "SomeId" }` node, it
 * calls this function to obtain the actual schema so it can continue walking
 * the path.
 *
 * Returns `undefined` when the referenced schema is unknown — the traversal
 * then treats the path segment as unresolvable (same as any other missing
 * property).
 */
type SchemaResolver = (ref: string) => TSchema | undefined;


/**
 * A mapping of HTTP status codes to resource names for error cases.
 *
 * `ReservedErrorKeys` (`'unexpected'`) is excluded from the value type so that
 * developers get a compile-time error when they use a name that collides with
 * the `Failure` catch-all variant. The runtime guard in
 * `validateExpectedErrors` provides the same protection.
 */
export type ErrorResourceMap<ValidNames extends string = string> =
    Record<number, Exclude<ValidNames, ReservedErrorKeys>>;

/**
 * Defines a single link within a resource, constrained to valid resource names.
 *
 * @template P - Parameter property bag (a `TProperties` map of schemas). URI
 * templates always expand from an object of parameters, so callers pass the
 * bare property bag (e.g. `params: { id: Type.Number() }`) and the framework
 * wraps it with `Type.Object(...)` internally where a `TObject` is needed
 * (URI template expansion, validation).
 */
export interface LinkDefinition<ValidNames extends string = string, P extends TProperties = TProperties> {
    readonly to: ValidNames;
    readonly params?: P;
    readonly expect?: ErrorResourceMap<ValidNames>;
}

/**
 * Defines a resource with links that can only target the specified valid names.
 */
export interface ResourceDefinition<ValidNames extends string = string> {
    readonly schema: TSchema;
    readonly links: Record<string, LinkDefinition<ValidNames, any>>;
}

/**
 * Defines the complete structure of a hypermedia API.
 *
 * An ApiDefinition is a record mapping resource names to their definitions (schema + links).
 * This type is the foundation of typesafe-hypermedia's type system - all navigation, validation, and
 * type inference flows from the API definition.
 *
 * Key responsibilities:
 * - Maps each resource name to a {@link ResourceDefinition} (schema + links)
 * - Enforces that all link targets reference valid resource names (via ValidNames)
 * - Enables compile-time validation of the entire API structure
 * - Powers type-safe navigation by encoding resource relationships
 *
 * Always create API definitions using {@link defineLinks} for compile-time and runtime validation.
 *
 * @template ValidNames - Union of valid resource names (constrains link targets)
 *
 * @example
 * ```typescript
 * // Create an API definition with defineLinks
 * const api = defineLinks(['shop', 'product', 'category'], {
 *   shop: {
 *     schema: Type.Object({
 *       name: Type.String(),
 *       productsLink: Type.String()
 *     }),
 *     links: {
 *       'productsLink': { to: 'product' }  // ✓ 'product' is valid
 *     }
 *   },
 *   product: {
 *     schema: Type.Object({
 *       id: Type.String(),
 *       name: Type.String(),
 *       category: Type.String()
 *     }),
 *     links: {
 *       'category': { to: 'category' }
 *     }
 *   },
 *   category: {
 *     schema: Type.Object({ name: Type.String() }),
 *     links: {}
 *   }
 * });
 *
 * // Use it to connect to the API
 * const shopLink = linkTo({ api, resource: 'shop', url: 'https://api.example.com' });
 * ```
 */
export type ApiDefinition<ValidNames extends string = string> = Record<string, ResourceDefinition<ValidNames>>;

/**
 * Helper function to define the API structure with compile-time validation of resource names.
 *
 * Resource names are specified first, then used to validate all link 'to' properties.
 * Invalid references will cause TypeScript compilation errors with autocomplete support.
 *
 * @param resourceNames - Array of valid resource names (no 'as const' needed when passed inline)
 * @param apiDefinition - API definition with resources and links
 *
 * @example
 * ```typescript
 * // Define API with validated resource references
 * const api = defineLinks(['users', 'posts'], {
 *   users: {
 *     schema: UserSchema,
 *     links: {
 *       'posts[]': { to: 'posts' }  // ✓ Autocomplete for 'posts' works! Validated!
 *     }
 *   },
 *   posts: {
 *     schema: PostSchema,
 *     links: {
 *       'author': { to: 'users' }    // ✓ Validated!
 *       // 'author': { to: 'userz' } // ✗ TypeScript error - 'userz' not in ['users', 'posts']
 *       // 'othor': { to: 'users' }  // ✗ fails during runtime validation
 *     }
 *   }
 * });
 * ```
 */
export function defineLinks<
    const Names extends readonly string[],
    ApiDef extends ApiDefinition<Names[number]>
>(
    resourceNames: Names,
    apiDefinition: ApiDef,
    options?: { schemas?: Record<string, TSchema> }
): ApiDef {
    validateApiDefinition(apiDefinition, resourceNames, options?.schemas);
    return apiDefinition;
}

// ============================================================================
// Runtime Validation
// ============================================================================

function validateApiDefinition<ApiDef extends ApiDefinition<any>>(
    apiDef: ApiDef,
    resourceNames: readonly string[],
    userSchemas?: Record<string, TSchema>
): void {
    const allErrors: string[] = [];

    // Build a schema registry for $ref resolution.
    // Sources: (1) user-provided schemas, (2) resource schemas that have $id.
    // Use Object.create(null) to avoid prototype pollution (e.g. $ref: "toString").
    const allSchemas: Record<string, TSchema> = Object.create(null);
    if (userSchemas) {
        for (const [schemaId, schema] of Object.entries(userSchemas)) {
            allSchemas[schemaId] = schema;
        }
    }
    for (const def of Object.values(apiDef) as ResourceDefinition[]) {
        const schema = def.schema as TSchema & { $id?: string };
        if (schema.$id) {
            allSchemas[schema.$id] = schema;
        }
    }
    // Safe to use `in` because allSchemas has a null prototype (no inherited properties)
    const resolve: SchemaResolver = (ref) =>
        ref in allSchemas ? allSchemas[ref] : undefined;

    // Validate that all declared names have definitions
    for (const name of resourceNames) {
        if (!(name in apiDef)) {
            allErrors.push(
                `Resource '${name}' declared in resource names but not defined in API definition.`
            );
        }
    }

    // Validate that all definitions are in declared names
    for (const name of Object.keys(apiDef)) {
        if (!resourceNames.includes(name)) {
            allErrors.push(
                `Resource '${name}' defined in API definition but not declared in resource names.`
            );
        }
    }

    // Validate resource definitions
    for (const [resourceName, resourceDef] of Object.entries(apiDef)) {
        allErrors.push(...validateResourceDefinition(resourceName, resourceDef, resolve));
    }

    // Validate that all link targets exist in the API definition
    for (const [resourceName, resourceDef] of Object.entries(apiDef)) {
        for (const [linkPath, linkDef] of Object.entries(resourceDef.links)) {
            const link = linkDef as LinkDefinition;
            if (!(link.to in apiDef)) {
                allErrors.push(
                    `Link '${linkPath}' in resource '${resourceName}' targets resource '${link.to}' which is not defined in the API definition.`
                );
            }

            // Validate error responses
            allErrors.push(...validateExpectedErrors(resourceName, linkPath, link, apiDef));
        }
    }

    if (allErrors.length > 0) {
        throw new Error(
            `API definition validation failed:\n${allErrors.map(e => `  - ${e}`).join('\n')}`
        );
    }
}

function validateResourceDefinition(name: string, def: ResourceDefinition, resolve: SchemaResolver): string[] {
    const errors: string[] = [];

    // We no longer validate for completeness (missing links) because any string property
    // could potentially be a link, so we can't infer intended links solely from the schema structure anymore.
    // However, we MUST validate that every configured link points to a valid location in the schema.

    for (const [path, linkDef] of Object.entries(def.links)) {
        // Reject terminal array segments early (e.g. 'foo.bar[]') — the terminal
        // must name a property to extract a string href from.
        const segments = path.split('.');
        const finalProperty = segments[segments.length - 1];

        if (finalProperty.endsWith('[]')) {
            const prop = finalProperty.slice(0, -2);
            errors.push(
                `Invalid link path '${path}' in resource '${name}': Array segment '${finalProperty}' cannot be terminal. ` +
                `Specify the property name to extract (e.g., '${prop}[].href').`
            );
            continue;
        }

        const resolved = resolveSchemaAtPath(def.schema, path, resolve);

        if (!resolved) {
            // Check if path contains array notation to provide more specific error message
            if (path.includes('[]')) {
                // Try resolving without [] to see if property exists
                const pathWithoutArrayNotation = path.replace(/\[\]/g, '');
                const propertyExists = resolveSchemaAtPath(def.schema, pathWithoutArrayNotation, resolve);

                if (propertyExists) {
                    errors.push(
                        `Invalid link path '${path}' in resource '${name}': Array notation [] used on non-array property.`
                    );
                } else {
                    errors.push(
                        `Invalid link path '${path}' in resource '${name}': Property does not exist in schema.`
                    );
                }
            } else {
                errors.push(
                    `Invalid link path '${path}' in resource '${name}': Property does not exist in schema.`
                );
            }
            continue;
        }

        // Validate that the resolved schema is a string (links must be string properties)
        if (!TypeGuard.IsString(resolved)) {
            errors.push(
                `Invalid link path '${path}' in resource '${name}': Link must point to a string property, but found ${resolved[Kind]}.`
            );
        }
    }

    return errors;
}

function validateExpectedErrors(resourceName: string, linkPath: string, link: LinkDefinition, apiDef: ApiDefinition): string[] {
    const errors: string[] = [];

    if (!link.expect) {
        return errors;
    }

    // Check that expect is not defined on array links
    if (linkPath.includes('[]')) {
        errors.push(
            `Link '${linkPath}' in resource '${resourceName}' defines error responses, but array links do not support error responses.`
        );
    }

    // Validate each error mapping
    for (const [statusCode, errorResourceName] of Object.entries(link.expect)) {
        const status = parseInt(statusCode, 10);

        // Check status code is in error range (400-599)
        if (status < 400 || status > 599) {
            errors.push(
                `Link '${linkPath}' in resource '${resourceName}' has invalid status code '${status}' in error responses (must be 400-599).`
            );
        }

        // Check that referenced error resource exists
        if (!(errorResourceName in apiDef)) {
            errors.push(
                `Link '${linkPath}' in resource '${resourceName}' references unknown resource '${errorResourceName}' in error responses.`
            );
        }

        // Check that the error resource name does not collide with the Failure
        // catch-all variant's 'unexpected' kind discriminant.
        if ((RESERVED_ERROR_KEYS as Set<string>).has(errorResourceName)) {
            errors.push(
                `Link '${linkPath}' in resource '${resourceName}' uses expect status ${status} ` +
                `targeting resource '${errorResourceName}', which is a reserved Failure ` +
                `discriminant value. Choose a different resource name.`
            );
        }
    }

    return errors;
}

// ============================================================================
// Schema Traversal Helpers
// ============================================================================

function resolveSchemaAtPath(root: TSchema, path: string, resolve: SchemaResolver): TSchema | undefined {
    const segments = path.split('.');
    let currentSchemas: TSchema[] = [root];

    for (const segment of segments) {
        const isArrayTraversal = segment.endsWith('[]');
        const key = isArrayTraversal ? segment.slice(0, -2) : segment;

        // 1. Find property 'key' in all current schemas
        const nextSchemas: TSchema[] = [];

        for (const schema of currentSchemas) {
            collectProperties(schema, key, nextSchemas, resolve);
        }

        if (nextSchemas.length === 0) {
            return undefined;
        }

        // 2. Handle Array unwrapping if requested
        if (isArrayTraversal) {
            const unwrappedSchemas: TSchema[] = [];
            for (const schema of nextSchemas) {
                collectArrayItems(schema, unwrappedSchemas, resolve);
            }
            if (unwrappedSchemas.length === 0) {
                return undefined;
            }
            currentSchemas = unwrappedSchemas;
        } else {
            currentSchemas = nextSchemas;
        }
    }

    // Return the first match found.
    // In a perfectly consistent API, all matches should be the same type (e.g. String).
    return currentSchemas[0];
}

function collectProperties(schema: TSchema, key: string, collector: TSchema[], resolve: SchemaResolver, visitedRefs: Set<string> = new Set()) {
    if (TypeGuard.IsRef(schema)) {
        if (visitedRefs.has(schema.$ref)) return; // cycle detected — stop recursion
        visitedRefs.add(schema.$ref);
        const derefed = resolve(schema.$ref);
        if (derefed) collectProperties(derefed, key, collector, resolve, visitedRefs);
        return;
    }

    // Note: TypeBox 0.34+ Optional is a transparent marker — the underlying schema
    // remains unchanged (IsObject, IsArray, etc. still return true). There is no
    // wrapper `.schema` property, so we fall through to the type-specific checks below.

    if (TypeGuard.IsObject(schema)) {
        if (key in schema.properties) {
            collector.push(schema.properties[key]);
        }
        return;
    }

    if (TypeGuard.IsIntersect(schema)) {
        for (const sub of schema.allOf) {
            collectProperties(sub, key, collector, resolve, visitedRefs);
        }
        return;
    }

    if (TypeGuard.IsUnion(schema)) {
        for (const sub of schema.anyOf) {
            collectProperties(sub, key, collector, resolve, visitedRefs);
        }
        return;
    }
}

function collectArrayItems(schema: TSchema, collector: TSchema[], resolve: SchemaResolver, visitedRefs: Set<string> = new Set()) {
    if (TypeGuard.IsRef(schema)) {
        if (visitedRefs.has(schema.$ref)) return; // cycle detected — stop recursion
        visitedRefs.add(schema.$ref);
        const derefed = resolve(schema.$ref);
        if (derefed) collectArrayItems(derefed, collector, resolve, visitedRefs);
        return;
    }

    // Note: TypeBox 0.34+ Optional is a transparent marker — the underlying schema
    // remains unchanged (IsArray, IsObject, etc. still return true). There is no
    // wrapper `.schema` property, so we fall through to the type-specific checks below.

    if (TypeGuard.IsArray(schema)) {
        collector.push(schema.items);
        return;
    }

    if (TypeGuard.IsIntersect(schema)) {
        for (const sub of schema.allOf) {
            collectArrayItems(sub, collector, resolve, visitedRefs);
        }
        return;
    }

    if (TypeGuard.IsUnion(schema)) {
        for (const sub of schema.anyOf) {
            collectArrayItems(sub, collector, resolve, visitedRefs);
        }
        return;
    }
}
