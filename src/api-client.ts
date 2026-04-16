import { Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ApiDefinition, LinkDefinition, ResourceDefinition } from './link-definition';

import { FetchFactory, FetchContext, defaultFetchFactory } from './fetch-customization';
import { rememberLinks, rememberEntryPoint, recallLink, KnownLink } from './runtime-metadata';
import { Navigable, RootNavigable, LinkSpec, LinkedResource, ResourceNameFrom, Verbosity } from './type-system';
import { ResourceOrFailure, Failure, UnexpectedFailure, uriExpansionFailure, networkFailure, responseFailure, invalidJsonFailure, invalidStructureFailure, failureToError } from './error-handling';
import { expandUriTemplate } from './uri-templates';

/**
 * Runtime orchestrator for the hypermedia client.
 *
 * Encapsulates all runtime behavior (fetching, validation, metadata management)
 * to keep the public API functions (linkTo, navigate) simple and stateless.
 *
 * Each client instance is bound to a specific API definition and manages:
 * - Fetching resources via a customizable fetch factory
 * - Validating responses against schemas
 * - Remembering fetched resources in runtime-metadata so their links become followable
 * - Handling failure responses (expected and unexpected)
 *
 * Design intent: api-client.ts is deliberately thin on error handling. Error
 * classification, verbosity, message formatting, parse recovery, and schema
 * validation all live in error-handling.ts. The fetch → parse → validate flow
 * lives in the single `fetchResource` method, which returns a
 * `{ resource, failure }` result. `resolve` runs that pipeline once per
 * navigation, hydrates links on whatever resource came back, and dispatches to
 * the link shape — constructing the public tuple for prone links, throwing
 * `failureToError(...)` for safe-link failures. If you find yourself adding a
 * second fetch method, a `verbosity === 'safe'` check, or error-message
 * concatenation in here, the right home is almost certainly
 * `error-handling.ts`.
 *
 * @internal
 */
export class ApiClient<ApiDef extends ApiDefinition> {
    private readonly fetchFactory: FetchFactory<ApiDef>;
    readonly errorVerbosity: Verbosity;

    constructor(
        private readonly apiDef: ApiDef,
        fetchFactory?: FetchFactory<ApiDef>,
        errorVerbosity?: Verbosity
    ) {
        // Cast required: defaultFetchFactory is typed FetchFactory<ApiDefinition> (the base type).
        // TypeScript cannot verify that FetchFactory<ApiDefinition> satisfies FetchFactory<ApiDef>
        // because FetchFactory is contravariant in its type parameter (it consumes FetchContext<Api>).
        // Safe at runtime: the default factory ignores context entirely, so it handles any ApiDef.
        this.fetchFactory = (fetchFactory ?? defaultFetchFactory) as FetchFactory<ApiDef>;
        this.errorVerbosity = errorVerbosity ?? 'verbose';
    }

    /**
     * Creates the initial unfetched link to the API root.
     *
     * Returns a navigable object without fetching — the actual fetch happens
     * when you call navigate() on it. This lazy evaluation allows the type system
     * to know what resource you'll get before making any network requests.
     */
    createEntryPoint<N extends ResourceNameFrom<ApiDef>>(
        url: string,
        resourceName: N
    ): RootNavigable<N, ApiDef> {
        // Create the root navigable object.
        // It's a navigable with a single 'href' property — the degenerate single-link case.
        const navigable = { href: url } as RootNavigable<N, ApiDef>;
        // Root URL is passed in absolute form by linkTo(); no baseURL needed for the root fetch.
        rememberEntryPoint(this, navigable, { to: resourceName as string }, url);
        return navigable;
    }

    /**
     * Resolves a link on a navigable object.
     *
     * Runs the unified fetch pipeline (`fetchResource`), hydrates links on
     * whatever resource was returned (success body *or* typed error body, since
     * both carry followable links), then dispatches based on the link shape:
     *
     * - **Prone links** (with `expect`): return the `[resource, failure]` tuple
     *   directly. The typed error body's links are already hydrated above.
     * - **Safe links** (no `expect`): return the resource on success, or throw
     *   `failureToError(failure, verbosity)` on failure. The converter maps each
     *   `Failure` reason back to the thrown-Error shape safe links advertise.
     *
     * Pre-pipeline programming errors (unknown link name, missing resource
     * definition) still propagate verbatim — they indicate caller bugs, not
     * server or network failures. URI template expansion errors, by contrast,
     * can happen at runtime (server changes a template), so they flow through
     * the pipeline as `reason: 'uriExpansion'` failures.
     *
     * The `as any` at the end is unavoidable: TypeScript cannot narrow the
     * conditional return type (`L['Error'] extends undefined ? ... : ...`) from
     * inside this generic body.
     */
    async resolve<L extends LinkSpec>(
        navigable: Navigable<any>,
        linkName?: string,
        params?: Static<L['Params']>
    ): Promise<L['Error'] extends undefined ? LinkedResource<L> : ResourceOrFailure<L>> {
        const link = recallLink(navigable, linkName);
        const linkDef = link.linkDef;
        const resourceDef = this.requireResourceDef(linkDef.to);

        const outcome = await this.fetchResource(link, params, navigable);

        // Hydrate links on whatever resource we received — success body OR
        // typed-error body. Unexpected failures have no resource to hydrate.
        if ('resource' in outcome) {
            rememberLinks(outcome.resource, resourceDef, outcome.baseURL, this);
        } else if (outcome.failure.kind !== 'unexpected') {
            rememberLinks(outcome.failure.resource, this.apiDef[outcome.failure.kind], outcome.baseURL, this);
        }

        // Dispatch by link shape — prone links return the public tuple.
        if (linkDef.expect) {
            return ('failure' in outcome
                ? [null, outcome.failure]
                : [outcome.resource, null]) as any;
        }
        if ('failure' in outcome) {
            // Cast: safe links have no `expect`, so a failure here is always one
            // of the `'unexpected'` variants. TypeScript can't narrow through
            // `linkDef.expect` from inside this generic body.
            throw failureToError(outcome.failure as UnexpectedFailure, this.errorVerbosity);
        }
        return outcome.resource as any;
    }

    /**
     * Unified fetch pipeline for every link. Failures never throw — URI
     * expansion errors, transport errors, non-OK responses, malformed JSON,
     * and schema mismatches all become `Failure` variants in the returned
     * object. Safe links convert the returned Failure back to a thrown Error
     * in `resolve`; prone links return it unchanged.
     *
     * `rememberLinks` is NOT called here — the caller (`resolve`) handles
     * hydration because it has the single decision point for whether to hydrate
     * the success body or a typed-error body.
     */
    private async fetchResource(
        link: KnownLink,
        params: any,
        navigable: unknown,
    ): Promise<
        | { resource: unknown; baseURL: string }
        | { failure: Failure<any, any>; baseURL: string }
    > {
        // --- URI expansion ---
        let url: string;
        try {
            url = this.expandUrl(link, params);
        } catch (err) {
            return { failure: uriExpansionFailure(this.errorVerbosity, err as Error), baseURL: '' };
        }
        const baseURL = extractBaseURL(url);
        const linkDef = link.linkDef;
        const resourceDef = this.requireResourceDef(linkDef.to);

        // --- Fetch ---
        let response: Response;
        try {
            response = await this.doFetch(url, linkDef.to, navigable);
        } catch (err) {
            return { failure: networkFailure(this.errorVerbosity, url, err as Error), baseURL };
        }

        if (!response.ok) {
            return { failure: await responseFailure(
                this.errorVerbosity, url, response, linkDef, this.apiDef,
            ), baseURL };
        }

        // --- Parse & validate ---
        let resource: unknown;
        try {
            resource = await response.json();
        } catch (err) {
            return { failure: invalidJsonFailure(this.errorVerbosity, url, response, linkDef.to, err as Error), baseURL };
        }
        try {
            this.validateResource(resource, resourceDef, url);
        } catch (err) {
            return { failure: invalidStructureFailure(this.errorVerbosity, url, response, linkDef.to, err as Error), baseURL };
        }
        return { resource, baseURL };
    }

    /**
     * Expands any URI-template parameters on the link's href, then resolves
     * relative paths against the link's base URL.
     */
    private expandUrl(link: KnownLink, params: any): string {
        const paramsProps = link.linkDef.params;
        const resolvedHref = paramsProps
            ? expandUriTemplate({
                template: link.href,
                schema: Type.Object(paramsProps),
                values: params,
                verbosity: this.errorVerbosity,
            })
            : link.href;

        if (resolvedHref.startsWith('/') && link.baseURL) {
            return new URL(resolvedHref, link.baseURL).toString();
        }
        return resolvedHref;
    }

    /**
     * Pre-fetch invariant guard: the resource definition for every link target
     * must exist in the API definition. Shared between `resolve` and the fetch
     * pipeline.
     */
    private requireResourceDef(name: string): ResourceDefinition {
        const def = this.apiDef[name];
        if (!def) throw new Error(`Resource definition not found for: ${name}`);
        return def;
    }

    /**
     * Executes the customized fetch for a single URL.
     *
     * The factory is called inline here (no function-returning-function dance):
     * both fetch paths know the URL at the call site, so there's no reason to
     * bind context first and pass the URL later.
     */
    private doFetch(
        url: string,
        resourceName: string,
        navigable: unknown,
    ): Promise<Response> {
        // Cast required: FetchContext<ApiDef> is a conditional type on ApiDef,
        // and inside this generic method body TypeScript can't resolve which
        // branch applies, so neither branch's shape is assignable. Public API
        // type safety is preserved at the constructor boundary via ConnectOptions<ApiDef>.
        const ctx = {
            targetResourceName: resourceName,
            navigable,
        } as FetchContext<ApiDef>;
        return this.fetchFactory(ctx)(url);
    }

    /**
     * Validates a parsed resource against its schema definition.
     *
     * Uses two strategies based on error verbosity:
     * - `safe`: Value.Check to avoid materializing error details we'd discard
     * - `verbose`: Value.Errors for detailed diagnostics (consistent with uri-templates.ts)
     */
    private validateResource(resource: unknown, resourceDef: ResourceDefinition, url: string): void {
        if (this.errorVerbosity === 'safe') {
            if (!Value.Check(resourceDef.schema, resource)) {
                throw new Error('Response validation failed');
            }
        } else {
            const validationErrors = [...Value.Errors(resourceDef.schema, resource)];
            if (validationErrors.length > 0) {
                const errorDetails = validationErrors.map(e => `${e.path}: ${e.message}`).join(', ');
                throw new Error(`Response validation failed for ${url}: ${errorDetails}`);
            }
        }
    }
}

/**
 * Extracts the origin from an absolute URL so relative links in the fetched
 * resource can be resolved against the server that returned them — not the
 * client's origin.
 *
 * `new URL(url)` without a base throws `TypeError` for relative URLs — we
 * treat that as "no origin" and return `''`. Any absolute URL (any scheme)
 * yields its origin.
 *
 * File-private module function (not a method): reads no instance state, so
 * the `this.extractBaseURL(...)` form was misleading.
 */
function extractBaseURL(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return '';
    }
}
