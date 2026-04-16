import { Static, TObject } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as UriTemplate from '@hyperjump/uri-template';
import { Verbosity } from './type-system';

/**
 * Extracts variable names from a pre-parsed URI template AST.
 */
function extractTemplateVariablesFromAst(segments: ReturnType<typeof UriTemplate.parse>): Set<string> {
    const variables = new Set<string>();

    for (const segment of segments) {
        if ('variables' in segment && Array.isArray(segment.variables)) {
            for (const variable of segment.variables) {
                variables.add(variable.name);
            }
        }
    }

    return variables;
}

/**
 * Shared helper for throwing parse/expand/schema-mismatch errors.
 * Enforces the verbose/safe contract for these error paths: safe mode always returns
 * a generic message, verbose mode includes the full detail string.
 * Note: parameter validation errors are thrown directly before reaching this helper.
 */
function throwTemplateError(verbosity: Verbosity, detail: string): never {
    if (verbosity === 'safe') {
        throw new Error('URI template expansion failed');
    }
    throw new Error(detail);
}

/**
 * Validates that all properties defined in the schema are present in the URI template.
 * This ensures the API definition is consistent - every property in the schema (whether
 * required or optional) must appear as a variable in the template.
 */
function validateSchemaMatchesTemplate(
    schema: TObject,
    templateVariables: Set<string>,
    template: string,
    verbosity: Verbosity
): void {
    const schemaProperties = Object.keys(schema.properties);
    const missingInTemplate = schemaProperties.filter(prop => !templateVariables.has(prop));

    if (missingInTemplate.length > 0) {
        throwTemplateError(
            verbosity,
            `Schema defines more properties than there are variables in the template ${template}: ${missingInTemplate.join(', ')}`
        );
    }
}

/**
 * Configuration for {@link expandUriTemplate}.
 *
 * @public
 */
export interface ExpandUriTemplateConfig<T extends TObject> {
    /** The URI template string (e.g., `"/pets/{id}"` or `"/search{?q,limit}"`). */
    template: string;
    /** TypeBox object schema defining the structure and types of the parameters. */
    schema: T;
    /** The actual parameter values matching the schema type. */
    values: Static<T>;
    /** Error verbosity: `'verbose'` (default) includes internal details; `'safe'` omits them. */
    verbosity?: Verbosity;
}

/**
 * Expands a URI template with validated parameters.
 *
 * Part of the public API. Useful for building self-referential HATEOAS URLs on
 * the server side (e.g., a BFF constructing typed links pointing back to itself)
 * using the same TypeBox-validated expansion the library uses internally.
 *
 * @param config.template - The URI template string (e.g., "/pets/{id}" or "/search{?q,limit}")
 * @param config.schema   - TypeBox object schema defining the structure and types of the parameters
 * @param config.values   - The actual parameter values matching the schema type
 * @param config.verbosity - Error verbosity: 'verbose' (default) or 'safe' (omits internal details)
 * @returns The expanded URI string
 * @throws Error if values don't match the schema, schema properties are missing from template,
 *         or template parsing/expansion fails
 */
export function expandUriTemplate<T extends TObject>(config: ExpandUriTemplateConfig<T>): string {
    const { template, schema, values, verbosity = 'verbose' } = config;

    // Validate parameter values against schema
    if (verbosity === 'safe') {
        if (!Value.Check(schema, values)) {
            throw new Error('Invalid request parameters');
        }
    } else {
        const errors = [...Value.Errors(schema, values)];
        if (errors.length > 0) {
            throw new Error(
                `Values do not match schema for template ${template} - Reason: ${JSON.stringify(errors)}`
            );
        }
    }

    let ast: ReturnType<typeof UriTemplate.parse>;
    try {
        ast = UriTemplate.parse(template);
    } catch (error) {
        throwTemplateError(verbosity, `Failed to parse URI template ${template} - ${String(error)}`);
    }

    const templateVariables = extractTemplateVariablesFromAst(ast);
    validateSchemaMatchesTemplate(schema, templateVariables, template, verbosity);

    try {
        return UriTemplate.expand(ast, values);
    } catch (error) {
        throwTemplateError(verbosity, `Failed to expand URI template ${template} - ${String(error)}`);
    }
}
