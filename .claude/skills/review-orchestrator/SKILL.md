---
name: review-orchestrator
description: "Orchestrates a full code review: scopes files, launches a reviewer agent (using review-checklist), parses findings, fans out solutionizer agents in parallel, and merges everything into a final report. Trigger when the user asks for a code review, code audit, codebase review, quality check, or says 'review this', 'audit this code', 'check this code', 'find issues in this code'."
---

# Code Review Orchestrator

Runs one reviewer agent, then spawns parallel solutionizer agents for each important finding.

## Execution Mode: Sub-agent

## Workflow

### Phase 0: Workspace Check
1. Check if `review-workspace/` already exists in the project root
2. If it exists, ask the user whether the old workspace can be removed. **Do not proceed until the user confirms.**
3. Once confirmed, remove the existing `review-workspace/` directory

### Phase 1: Preparation
1. Determine review scope:
   - If the user specified files/directories: use those
   - If the user said "review this PR" or similar: run `git diff main...HEAD --name-only` to get changed files
   - If no specific scope: review all source files (`src/**/*.ts` or equivalent)
2. Create `review-workspace/` directory in the project root
3. Build the file list and store in `review-workspace/00_review_scope.md`

### Phase 2: Review

Launch ONE reviewer agent:

```
Agent(
  description: "Code review",
  subagent_type: "general-purpose",
  model: "opus",
  run_in_background: true,
  prompt: "You are a code reviewer. Read .claude/skills/review-checklist/SKILL.md for your methodology.

IMPORTANT: Before reviewing code, read docs/housekeeping.md and docs/roadmap.md.
- Housekeeping items are known small cleanups. Treat open housekeeping items as candidates for findings — if you spot one that is still unresolved in the code, include it as a finding.
- Roadmap items are large planned features. Do NOT report roadmap items as findings — they are out of scope for this workflow.

Review scope: [file list from Phase 1]

Read each file and analyze across all four domains (architecture, security, performance, style). Write your findings to review-workspace/review.md following the output structure in the skill file.

IMPORTANT: Number each finding as FINDING-01, FINDING-02, etc. Include all relevant file locations. Focus on WARNING and CRITICAL findings — be selective with INFO items.

IMPORTANT: Also produce review-workspace/quick_fixes.md for low-risk, small-scope items (typos, stale comments, formatting, stale JSDoc, unused imports, duplicate blank lines, wrong property names in docs). These should NOT be numbered findings — they go in quick_fixes.md only."
)
```

### Phase 3: Parse Findings

After the reviewer completes:

1. Read `review-workspace/review.md`
2. Extract all CRITICAL and WARNING findings (skip INFO — these are minor and don't warrant solution analysis)
3. For each finding, note its ID, title, severity, locations, and description

### Phase 4: Solutionize (Fan-out)

Launch one solutionizer agent PER important finding, all in parallel in a **single message**:

```
Agent(
  description: "Solve FINDING-XX",
  subagent_type: "general-purpose",
  model: "sonnet",
  run_in_background: true,
  prompt: "You are a solution architect. Read .claude/skills/solutionize/SKILL.md for your methodology.

You are solving this code review finding:

---
[Paste the full finding: ID, severity, domain, location, issue description, context]
---

Read the code at the referenced locations. Propose three solution approaches (pragmatic, balanced, ideal) with real code examples and a comparison table.

Write your solution to review-workspace/solution_FINDING-XX.md"
)
```

**Rules for fan-out:**
- Launch ALL solutionizer agents in a single message (parallel execution)
- Use `model: "sonnet"` for solutionizers — they need to read specific code and propose changes, not do broad analysis. Sonnet is sufficient and more token-efficient.
- Cap at 8 solutionizer agents maximum. If there are more than 8 WARNING+ findings, prioritize CRITICALs first, then WARNINGs by estimated impact.
- If there are 0 WARNING+ findings, skip this phase entirely.

### Phase 5: Merge

After all solutionizer agents complete:

1. Read `review-workspace/review.md`, all `review-workspace/solution_FINDING-*.md` files, and `review-workspace/quick_fixes.md`
2. Write the final report to `review-workspace/code_review_report.md`:

```markdown
# Code Review Report

**Scope**: [files reviewed]
**Date**: [date]

## Summary
[2-3 sentences — overall quality, key themes]

## Findings & Solutions

### FINDING-01: [Title] [CRITICAL|WARNING]
**Domain**: ... | **Location**: `file:line`

[Issue description]

**Solutions** — see [`review-workspace/solution_FINDING-01.md`] for full analysis

| | A: Pragmatic | B: Balanced | C: Ideal |
|---|---|---|---|
| Risk | ... | ... | ... |
| Effort | ... | ... | ... |
| Breaks API | ... | ... | ... |
| Recommendation | | **<--** | |

[Repeat for each finding with solutions]

## Minor Items (INFO)
[Bullet list of INFO findings — no solution analysis needed]

## Quick Fixes
[Count] quick fixes collected in [`review-workspace/quick_fixes.md`](review-workspace/quick_fixes.md).
These are low-risk, small-scope changes (typos, stale docs, formatting) that can all be applied at once.

## Positive Observations
[Notable good design decisions]
```

3. Present the summary and findings table to the user
4. Tell the user: individual solution files are at `review-workspace/solution_FINDING-XX.md` for detailed code examples
5. Tell the user: quick fixes are at `review-workspace/quick_fixes.md` — these can all be applied in one pass with a single prompt

## Data Flow

```
[file list] → [reviewer agent] → review.md + quick_fixes.md
                                      │
                            ┌─── parse findings ───┐
                            │         │             │
                            ▼         ▼             ▼
                     [solutionize] [solutionize] [solutionize]
                            │         │             │
                            ▼         ▼             ▼
                     solution_01  solution_02   solution_03
                            │         │             │
                            └────── merge ──────────┘
                                      │
                                      ▼
                            code_review_report.md
                            (references quick_fixes.md)
```

## Error Handling

| Situation | Strategy |
|-----------|----------|
| Reviewer agent fails | Retry once. If still fails, report error to user. |
| A solutionizer fails | Proceed without it. Note "[FINDING-XX] solution unavailable" in report. |
| Reviewer finds 0 issues | Skip Phase 4. Report "no issues found" with positive observations. |
| Reviewer finds >8 WARNINGs | Prioritize top 8 by severity and impact. List remaining in report without solutions. |
