---
name: solutionize
description: "Proposes three solution approaches (pragmatic, balanced, ideal) for a specific code review finding. Reads the relevant code, analyzes constraints, and produces a comparison table. Used by the general-purpose agent during code review follow-up."
---

# Solutionize Skill

Given a specific code review finding, propose three concrete solution approaches.

## Workflow

### Step 1: Understand the Finding
1. **Always read `docs/how-it-works.md` first** — this is the architectural documentation
   that explains design decisions, trade-offs, and why things are the way they are. Many
   findings that look like issues are actually intentional design choices. You must
   understand the full context before proposing solutions.
2. Read the finding description, severity, and all referenced file locations
3. Read the actual code at those locations — understand the current implementation fully
4. Read surrounding code to understand constraints, callers, and downstream effects
5. If the file has tests, read them to understand what behavior is validated
6. **Evaluate whether the finding is a false positive** — if the code is intentionally
   designed this way and the finding misunderstands the design rationale, the right
   response is Approach D (see below), not a code change

### Step 2: Design Three Approaches

For each approach, think through the actual implementation — don't hand-wave. Include specific file changes.

**Approach A — Pragmatic Fix**
- Minimum viable change that addresses the finding
- Must NOT break backwards compatibility
- Must NOT require changes outside the immediately affected files
- Prioritizes: low risk, fast to implement, easy to review
- Acceptable tradeoff: may not fully solve the underlying issue

**Approach B — Balanced Solution**
- Addresses the root cause, not just the symptom
- May touch multiple files but keeps changes proportional
- May introduce new internal abstractions if they earn their keep
- Prioritizes: correctness and maintainability
- Acceptable tradeoff: moderate effort, some refactoring

**Approach C — Ideal Solution**
- The "if we were starting fresh" approach
- May break backwards compatibility or require migration
- May restructure modules, change public API types, or introduce new patterns
- Prioritizes: long-term quality and developer experience
- Acceptable tradeoff: high effort, breaking changes, needs migration path

**Approach D — False Positive / Document Design Intent** *(only when applicable)*
- Use when the finding is based on a misunderstanding of the design, or the current
  code is intentionally the way it is for good reasons
- The "fix" is to document the rationale so future reviewers don't raise the same concern
- Changes: add a code comment, update `docs/how-it-works.md`, or add a section to AGENTS.md
- This is a valid outcome — not every finding warrants a code change
- Must include a clear explanation of *why* the current design is correct and what
  problem the reviewer thought they saw vs what is actually happening
- If the finding is partially valid (real issue exists but is less severe than reported,
  or the proposed fix direction is wrong), combine D with A/B/C: document the design
  intent AND make the minimal code change that addresses the valid part

### Step 3: Report

Write to `review-workspace/solution_FINDING-XX.md`:

```markdown
# Solution: FINDING-XX — [Title]

## Finding
[Copy the original finding for reference]

## Relevant Code
[Key code snippets from the affected locations — enough to understand without reading files]

## Approaches

### A: Pragmatic Fix
**Summary**: [one sentence]
**Changes**:
- `file:line` — [what changes]
**Example**:
```[lang]
// before
[current code]

// after
[proposed code]
```

### B: Balanced Solution
**Summary**: [one sentence]
**Changes**:
- `file:line` — [what changes]
**Example**:
```[lang]
// before → after for key changes
```

### C: Ideal Solution
**Summary**: [one sentence]
**Changes**:
- `file:line` — [what changes]
**Example**:
```[lang]
// key structural changes
```

### D: False Positive — Document Design Intent *(if applicable)*
**Summary**: [one sentence explaining why the current code is correct]
**Rationale**: [why the finding is a false positive or misunderstanding]
**Changes**:
- `file:line` — [add comment or documentation explaining the design choice]

## Comparison

| | A: Pragmatic | B: Balanced | C: Ideal | D: Document *(if applicable)* |
|---|---|---|---|---|
| **Risk** | ... | ... | ... | None |
| **Effort** | ... | ... | ... | ~5 min |
| **Breaks API** | No | ... | ... | No |
| **Files touched** | N | N | N | 1-2 (docs/comments) |
| **Solves root cause** | ... | ... | ... | N/A — no issue exists |
| **Test changes** | ... | ... | ... | None |

## Recommendation
[Which approach fits best given the project's current stage and constraints, and why.
If D is recommended, explain clearly what the reviewer misunderstood and why the
current design is intentional.]
```

**Important rules:**
- Show real code, not pseudocode — the user should be able to say "implement approach B" and you'd know exactly what to do
- Be honest about tradeoffs — if the pragmatic fix is a band-aid, say so
- If a finding is genuinely trivial (typo fix, missing semicolon), say so and provide just one approach
- Consider test impact for each approach
