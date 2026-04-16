# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-16

### Added

- Initial public release.
- Type-safe navigation for HATEOAS APIs with phantom types.
- `defineLinks` for compile-time and runtime validation of the link graph,
  including `SchemaResolver` support for `Type.Ref(...)` dereferencing.
- `linkTo`, `navigate`, `navigateAll` public API.
  - Single-link auto-resolve mode and named-link mode.
  - `navigateAll` for parallel resolution of single-link navigables.
- URI template expansion (RFC 6570) via `@hyperjump/uri-template`, plus the
  public `expandUriTemplate` utility for BFF servers building typed URLs.
- Typed error handling:
  - Optional `expect` on links producing `Promise<[Resource, null] | [null, Failure]>`.
  - `Failure` discriminated union over declared error resources plus
    sub-discriminated `'unexpected'` variants (`uriExpansion`, `network`,
    `unmappedStatus`, `invalidJson`, `invalidStructure`).
  - `ResponseInfo` carrying status, statusText, headers, and optional body.
- `errorVerbosity` option (`'verbose'` default, `'safe'` for BFF/gateway
  contexts) controlling URL and header disclosure in error messages.
- `FetchFactory<Api>` / `FetchContext<Api>` for full user control of HTTP
  behavior (methods, auth, headers, bodies).
- Support for both link-property and link-object styles
  (GitHub/JSON-LD and HAL/Siren/JSON:API).

[Unreleased]: https://github.com/feffef/typesafe-hypermedia/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/feffef/typesafe-hypermedia/releases/tag/v0.1.0
