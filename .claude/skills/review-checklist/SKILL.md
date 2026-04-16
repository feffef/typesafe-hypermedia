---
name: review-checklist
description: "Review checklist and methodology for the reviewer agent. Defines what to look for across architecture, security, performance, and style domains, plus output format. Not user-invocable — used by the review-orchestrator skill."
---

# Code Review Skill

Single-pass review covering all four domains: architecture, security, performance, and style.

## Workflow

### Step 1: Orientation
1. Read AGENTS.md or CLAUDE.md if they exist — understand the project's intended architecture, conventions, and constraints
2. Identify the project's language, framework, module structure, and dependency graph
3. Check for linter/formatter configs to understand enforced rules
4. Determine hot paths vs cold paths for performance prioritization

### Step 2: Review

Read each file in scope and analyze across all four domains simultaneously. For each file, check:

**Architecture**
| Check | What to look for |
|-------|-----------------|
| Coupling | Modules importing too many others; God modules everything depends on |
| Cohesion | Files mixing unrelated responsibilities |
| Dependency direction | Lower layers importing upper layers; circular dependencies |
| Abstraction leaks | Internal details exposed through public APIs |
| Layering violations | Breaking the project's intended layer boundaries |

**Security**
| Check | What to look for |
|-------|-----------------|
| Injection | String concatenation in queries/commands/templates; unsanitized interpolation |
| Secrets | Hardcoded API keys, tokens, passwords; secrets in committed config |
| Input validation | Missing validation at system boundaries; trusting external data |
| Auth/Authz | Missing auth checks; privilege escalation; insecure sessions |
| Deserialization | `eval()`, `Function()`, unvalidated `JSON.parse` of untrusted data |
| Information leakage | Stack traces in responses; verbose errors exposing internals |

**Performance**

**Key principle: Prefer clean, simple code over micro-optimized code when the performance gain is negligible.** Don't flag redundant computations that are dwarfed by surrounding I/O (e.g., an extra `new URL()` call in a function that does an HTTP fetch). Only raise performance findings when the optimization materially impacts real-world behavior — not when it saves microseconds in a millisecond-scale operation. When in doubt, favor readability and simplicity.

| Check | What to look for |
|-------|-----------------|
| Algorithmic complexity | O(n^2) or worse in nested loops; repeated linear scans |
| Memory pressure | Allocation in hot loops; large copies; string concat in loops |
| N+1 patterns | Fetch/query inside a loop that could be batched |
| Caching misses | Repeated computation of same value in CPU-bound hot paths (not I/O-bound paths) |
| Blocking operations | Sync I/O in async contexts; CPU-bound work on event loop |

**Style**
| Check | What to look for |
|-------|-----------------|
| Naming | Inconsistent naming; misleading names; abbreviation inconsistency |
| Dead code | Unused exports, unreachable branches, commented-out code |
| TypeScript | `any` casts that could be typed; missing discriminated unions |
| Error handling | Inconsistent patterns; swallowed errors; missing context |
| Duplication | Copy-pasted logic (3+ occurrences) that should be shared |

### Review Hints (commonly missed patterns)

These are patterns that single-pass reviews frequently overlook. Check each explicitly.

**Performance — look harder at these (but apply the materiality test):**

Before raising a performance finding, ask: "Would this optimization produce a measurable difference in real-world usage?" If the answer is no (e.g., saving one `new URL()` in a function that does a network fetch), don't raise it — the added complexity of the fix outweighs the negligible gain. Only flag patterns where the fix is simpler or equal in complexity to the current code, OR the performance impact is material.

- **Redundant parsing in CPU-bound hot paths**: Is the same value parsed or computed multiple times in a tight loop or high-frequency pure function? (e.g., parsing a template for validation then parsing it again for expansion — both CPU-bound)
- **Redundant lookups**: Is a cache/map accessed with `.get()` then `.has()` on the same key? Use a single lookup. (This is also a clarity improvement — simpler code.)
- **Double iteration**: Is a collection iterated once to check a condition, then again to extract details? (e.g., `Value.Check()` then `Value.Errors()` — just use `Errors()` directly)
- **Sequential awaits in loops**: `for (const x of items) { await fetch(x) }` is N+1. Should it be `Promise.all()`?
- **Per-request allocation of reusable objects**: Are clients, extractors, or config objects recreated on every request when they could be hoisted?
- **DO NOT flag**: Extra computations dwarfed by I/O (an extra `new URL()` in a function doing HTTP), micro-optimizations that require adding complexity (lazy getters, memoization caches) for negligible gain, or "cacheable invariants" in I/O-bound code paths

**Security — don't skip examples:**
- **Example code IS documentation**: Users copy examples verbatim. Review them with the same rigor as library code. An `as any` or `0.0.0.0` bind in an example becomes a pattern users replicate.
- **Error message content in server contexts**: Do error messages include internal URLs, schema details, or endpoint structure? These are fine for client-side debugging but leak topology when the library is used server-side (BFF, proxy).
- **Unvalidated redirects**: Are user-controlled values (query params, path params) used in redirect URLs or URL construction without validation?
- **Network binding**: Do example servers bind to `0.0.0.0` (all interfaces) when `127.0.0.1` (localhost) would be safer for development?

**Style/Documentation — catch the small stuff:**
- **Stale references after renames**: Search for references to old names (old file names, old property names, old function names) in comments, JSDoc, and string literals. These survive automated refactoring.
- **Stale JSDoc examples**: Do JSDoc `@example` blocks use current property/method names? Code changes but JSDoc often doesn't.
- **Cross-file inconsistency**: Is the same pattern (e.g., type branding, schema definition, config shape) done differently across files? Inconsistent naming or casing for the same concept?
- **Unused type parameters**: Are generic type parameters declared but never constrained or used in the function body?
- **Formatting drift**: Extra blank lines, missing semicolons where others have them, duplicate section comments — small things that signal unfinished edits.
- **Duplicate definitions**: Is the same type, schema, or constant defined in 3+ places when it should be in a shared file?

### Step 3: Report

Write findings to `review-workspace/review.md` using this structure:

```markdown
# Code Review

## Summary
[2-3 sentences on overall quality]

## Findings

### [FINDING-01] [CRITICAL|WARNING|INFO] Title
- **Domain**: Architecture | Security | Performance | Style
- **Location**: `file:line` (include all relevant locations)
- **Issue**: What's wrong and why it matters
- **Context**: Relevant code snippet or pattern (keep short)

### [FINDING-02] ...

## Positive Observations
[Notable good design decisions worth preserving]
```

Additionally, write a separate quick-fixes file to `review-workspace/quick_fixes.md`. This file collects all findings that are **low-risk, small-scope, and don't need discussion or solution analysis** — things like typos, stale comments, missing semicolons, stale JSDoc, duplicate blank lines, wrong property names in documentation, and similar. These should NOT appear as numbered FINDING entries in the main review.

```markdown
# Quick Fixes

Low-risk, small-scope changes that don't need discussion. Apply all at once.

## Fix 1: [Short title]
- **File**: `path/to/file.ts:line`
- **What**: [Exact description of what to change]
- **Why**: [One sentence]

## Fix 2: ...
```

**Rules for quick fixes:**
- Must be completable in under 2 minutes each
- Must have zero risk of breaking behavior (typos, comments, formatting, stale docs, unused imports)
- Must not require design decisions or tradeoffs
- Include the exact file and line number so an automated fix pass can find them
- Include enough context (the current wrong text and what it should be) that the fix is unambiguous

**Severity guide:**
- **CRITICAL**: Exploitable vulnerability, circular dependency, bug-causing inconsistency, visible performance degradation at normal scale
- **WARNING**: Suboptimal pattern that increases maintenance burden, potential vulnerability under specific conditions, inefficiency that matters at scale
- **INFO**: Minor improvement suggestion

**Important rules:**
- Number each finding sequentially (FINDING-01, FINDING-02, ...) — the orchestrator uses these IDs
- Deduplicate across domains: if `any` usage is both an architecture concern and a style concern, write ONE finding that covers both perspectives
- Keep findings actionable — every WARNING+ finding should have enough context for someone to propose a fix
- Don't pad the report. 5 real findings > 15 findings where 10 are cosmetic noise
