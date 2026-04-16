// ============================================================================
// Public API
// ============================================================================

export {
    defineLinks,
} from './link-definition';

export type {
    ApiDefinition,
} from './link-definition';

export type {
    FetchFactory,
    FetchContext,
} from './fetch-customization';

export type {
    Failure,
    ResponseInfo,
} from './error-handling';

export {
    linkTo,
    navigate,
    navigateAll,
} from './navigate';

export type {
    Resource,
    Navigable,
    LinkSpec,
    ConnectOptions,
    RootNavigable,
    LinkedResource,
    Simplify,
    Verbosity,
} from './type-system';

export {
    expandUriTemplate,
} from './uri-templates';

export type {
    ExpandUriTemplateConfig,
} from './uri-templates';
