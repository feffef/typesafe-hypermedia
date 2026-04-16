---
name: fix-findings
description: "Implements fixes for code review findings from review-workspace/. Reads solution files, applies the recommended approach (or a user-specified one), runs tests, and opens PRs. Also handles quick fixes (typos, stale docs, formatting) as a single bundled PR. Trigger when the user says 'fix findings', 'implement findings', 'apply findings', 'fix quick fixes', 'apply quick fixes', or references specific FINDING-XX IDs to fix."
---

# Fix Findings

Implements fixes for code review findings produced by the review-orchestrator skill.
Also supports applying quick fixes from `review-workspace/quick_fixes.md` as a single PR.

## Prerequisites

- For findings: `review-workspace/review.md` and `review-workspace/solution_FINDING-XX.md` must exist
- For quick fixes: `review-workspace/quick_fixes.md` must exist
- Working tree must be clean (`git status` shows no uncommitted changes)
- `gh` CLI must be authenticated and at version >= 2.88.0 (required for `--add-reviewer @copilot`)

## Permissions for Parallel Agents

Background agents (`run_in_background: true`) **cannot prompt the user** for tool permissions.
Any Bash command not in the allow list will silently fail, causing the agent to report
"Bash access denied."

**Before launching parallel agents**, verify that `.claude/settings.json` (tracked,
project-level) exists with the required permission patterns. If it does not exist,
create it and **commit to `main`** so worktree agents inherit it automatically.
This is the only reliable approach — worktrees get a fresh git checkout, so untracked
files like `settings.local.json` are never present, and agents cannot even run the `cp`
command to copy them without pre-existing permissions.

Required permission patterns (or broader ones):

```json
{
  "permissions": {
    "allow": [
      "Bash(git checkout:*)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git branch:*)",
      "Bash(git restore:*)",
      "Bash(git stash:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git status:*)",
      "Bash(git fetch:*)",
      "Bash(git merge:*)",
      "Bash(npx jest:*)",
      "Bash(gh pr:*)",
      "Bash(gh api:*)",
      "Bash(gh:*)",
      "Bash(ls:*)",
      "Bash(sleep:*)"
    ]
  }
}
```

## Critical: Agents must NEVER use `cd` in Bash commands

Permission patterns like `Bash(git add:*)` match the **first word** of the command.
A command like `cd /path && git add .` starts with `cd`, not `git add`, so it **will
not match** `Bash(git add:*)` and will be silently denied for background agents.

**Rules:**
- **Never prefix Bash commands with `cd`**. It breaks permission pattern matching.
- Agents launched with `isolation: "worktree"` already have cwd set to the worktree —
  no `cd` is ever needed.
- For follow-up work on existing worktrees (e.g., Copilot comment fixes), the
  orchestrator must use `git -C /worktree/path <command>` from the main thread,
  or launch a new isolated agent. Never launch a non-isolated agent and tell it
  to `cd` into a worktree.
- **Follow-up agents checking out existing branches** must always merge `origin/main`
  before starting work: `git fetch origin && git merge origin/main`. When multiple
  PRs are developed in parallel and some are merged before others, later branches
  will have conflicts unless they incorporate the latest main.

## Input

The user specifies findings to fix in one of these forms:

```
# Fix all findings that have solution files (use recommended approach for each)
/fix-findings

# Fix specific findings with recommended approach
/fix-findings FINDING-01, FINDING-05

# Fix specific findings with explicit approach overrides
/fix-findings FINDING-01 - A, FINDING-04 - C, FINDING-07 - B

# Fix quick fixes (typos, stale docs, formatting, etc.) — single bundled PR
/fix-findings quick-fixes
```

**Mode detection:** If the user says "quick fixes", "quick findings", "apply quick fixes",
or the input is literally `quick-fixes`, use the **Quick Fixes** workflow (Phase Q below).
Otherwise, use the standard **Findings** workflow (Phases 1–5).

## Quick Fixes Workflow (Phase Q)

Quick fixes are low-risk, small-scope items collected in `review-workspace/quick_fixes.md`
by the review-orchestrator. They are bundled into a **single branch and single PR**.

Launch **one agent** (can use `isolation: "worktree"` or run in main tree):

**Agent prompt template:**

```
You are applying quick fixes from a code review. Read AGENTS.md first for project conventions,
then read docs/how-it-works.md to understand the architecture and design decisions.

CRITICAL: Never prefix Bash commands with `cd /path &&` — it breaks permission pattern
matching. You are in a worktree; your cwd is already correct.

## Quick fixes to apply
[Paste the full contents of review-workspace/quick_fixes.md]

## Steps

1. **Create branch and sync with main**:
   ```
   git fetch origin
   git checkout -b fix/quick-fixes
   git merge origin/main
   ```
   This ensures the branch includes any recently merged PRs and avoids conflicts.

2. **Read each file** mentioned in the quick fixes list. Understand context before changing anything.

3. **Apply all fixes**: Work through the list item by item. These are typically:
   - Typo corrections in comments/docs/strings
   - Stale or incorrect JSDoc/comments
   - Unused imports
   - Formatting inconsistencies
   - Wrong property names in documentation
   - Duplicate blank lines
   Do NOT add extra changes beyond what quick_fixes.md specifies.

4. **Run all tests**: `npx jest`
   - ALL tests must pass. If a test fails, diagnose whether your change caused it.
   - Quick fixes should never break tests. If one does, revert that specific fix and note it.

5. **Commit**:
   ```
   git add [specific files]
   git commit -m "$(cat <<'EOF'
   chore: apply quick fixes from code review

   Fixes minor issues: [brief summary — e.g., typos, stale comments, unused imports]

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

6. **Push and create PR**:
   ```
   git push -u origin fix/quick-fixes
   gh pr create --title "chore: apply quick fixes from code review" --body "$(cat <<'EOF'
   ## Summary
   Applies low-risk quick fixes identified during code review.

   ## Changes
   [Bulleted list of each fix applied, grouped by file]

   ## Test plan
   - [x] All existing tests pass
   - [x] No behavioral changes — only cosmetic/doc fixes

   ## Review checklist
   - [ ] Copilot review: approved (or concerns explicitly overridden with comment)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   gh pr edit --add-reviewer @copilot
   ```

7. **Iterate with Copilot review and CI** — follow the Copilot iteration loop as
   described in the "Iterate with Copilot review and CI" section below (max 5 rounds).

IMPORTANT: If you cannot run Bash commands (permission denied), do NOT try workarounds.
Instead, report a detailed failure message including: (1) the exact command that failed,
(2) the exact error message, (3) which permissions are missing. Then STOP. The main
session will fix the root cause and relaunch you.

IMPORTANT: Report back the PR URL when done, the final Copilot review state, CI status,
and any unresolved concerns.
```

Use `model: "sonnet"` for the quick fixes agent (these are straightforward changes).

---

## Findings Workflow (Phases 1–5)

### Phase 1: Parse Input & Validate

1. Parse the user's input to extract finding IDs and optional approach overrides
2. For each finding ID, verify that `review-workspace/solution_FINDING-XX.md` exists
3. If no finding IDs specified, scan `review-workspace/` for all `solution_FINDING-*.md` files
4. Read `review-workspace/review.md` to get severity — skip INFO findings (no fix needed)
5. Verify working tree is clean: `git status` must show no uncommitted changes. If dirty, stop and ask the user to commit or stash first.

### Phase 2: Read Solutions

For each finding to fix:

1. Read `review-workspace/solution_FINDING-XX.md`
2. Determine which approach to use:
   - If the user specified an approach (A/B/C): use that
   - Otherwise: use the **Recommendation** section from the solution file
3. Extract from the chosen approach:
   - Exact file paths and line numbers to change
   - The before/after code examples
   - Whether tests need to be added or updated
   - Number of files touched

### Phase 3: Implement (Parallel Agents)

Launch one agent per finding, all in a **single message** for parallel execution.

Each agent runs in an isolated worktree (`isolation: "worktree"`).

**Agent prompt template:**

```
You are implementing a code review fix. Read AGENTS.md first for project conventions,
then read docs/how-it-works.md to understand the architecture and design decisions.

CRITICAL: Never prefix Bash commands with `cd /path &&` — it breaks permission pattern
matching. You are in a worktree; your cwd is already correct.

## Finding

[Paste the FULL finding from review.md: ID, severity, domain, location, description,
context, and code snippets. Include enough detail that the agent understands the problem
without reading the solution file.]

## Approach to implement: [A/B/C]
[Paste the full approach section from the solution file, including all code examples]

## Steps

1. **Create branch and sync with main**:
   ```
   git fetch origin
   git checkout -b fix/finding-XX-[short-kebab-description]
   git merge origin/main
   ```
   This ensures the branch includes any recently merged PRs and avoids conflicts.

2. **Read the code**: Read every file mentioned in the approach. Understand the current state before changing anything.

3. **Check if tests need updating BEFORE the fix**:
   - If the approach mentions test changes, read the relevant test files first
   - If there's an existing test that asserts OLD behavior (e.g., expects "is not a function" but the fix changes the error message), update the test expectation as part of the fix
   - If the approach says "add a test", write it

4. **Implement the fix**: Apply the code changes exactly as described in the approach. Do not add extra changes, refactoring, or "improvements" beyond what the approach specifies.

5. **Run all tests**: `npx jest`
   - ALL tests must pass. If a test fails, read the failure, diagnose whether it's caused by your change, and fix it.
   - If a test fails for a reason unrelated to your change, report it but do not modify unrelated code.

6. **Check coverage**: `npx jest --coverage -- [changed-source-files]`
   - New code paths should be covered. If a new branch (e.g., a new `throw`) is not covered, add a targeted test.
   - Don't chase 100% on files you didn't change — only verify coverage on the lines you touched.

7. **Commit**:
   ```
   git add [specific files]
   git commit -m "$(cat <<'EOF'
   fix: [concise description of what changed]

   [One paragraph explaining why — reference FINDING-XX]

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

8. **Push and create PR**:
   ```
   git push -u origin fix/finding-XX-[description]
   gh pr create --title "fix: [title]" --body "$(cat <<'EOF'
   ## Finding

   **[FINDING-XX]** | [SEVERITY] | [DOMAIN]
   **Location**: `[file:line]`

   [Full description of the issue from review.md — what is wrong and why it matters.
   For abstract problems, give a CONCRETE example of what could go wrong if this PR
   is not merged. E.g., "If a server returns href `/internal/api/v2/users/{id}` and
   the client is in safe mode, the error message would leak the internal URL path
   to the caller, potentially exposing infrastructure details to end users."]

   ## Approach chosen: [A/B/C] — [approach name]
   [1-2 sentences on why this approach was selected]

   ### Alternatives considered
   - **Approach [X] — [name]**: [Description of what this approach does, its trade-offs,
     and why it was not selected. Be specific — e.g., "Adds a try-catch in resolveUrl to
     sanitize errors. Lower risk (1 file, ~10 lines), but only protects this one call site.
     Any future caller of expandUriTemplate would have the same leak. Rejected because it
     doesn't solve the root cause."]
   - **Approach [Y] — [name]**: [Same level of detail]

   ## Test plan
   - [x] All existing tests pass
   - [x] [Any new tests added — be specific about what they verify]
   - [x] Coverage adequate on changed files

   ## Review checklist
   - [ ] CI: build_and_test passing
   - [ ] Copilot review: approved (or concerns explicitly overridden with comment)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   gh pr edit --add-reviewer @copilot
   ```

9. **Iterate with Copilot review and CI** — follow the loop described in the
   "Iterate with Copilot review and CI" section below (max 5 rounds).

IMPORTANT: If you cannot run Bash commands (permission denied), do NOT try workarounds.
Instead, report a detailed failure message including: (1) the exact command that failed,
(2) the exact error message, (3) which permissions are missing. Then STOP. The main
session will fix the root cause and relaunch you.

IMPORTANT: Report back the PR URL when done, the final Copilot review state, CI status,
and any unresolved concerns.
```

**Rules for parallel execution:**
- Launch ALL agents in a **single message** (one Agent tool call per finding)
- Use `isolation: "worktree"` on every agent so they work on independent copies
- Use `run_in_background: true` so they run concurrently
- Cap at 6 parallel agents. If more than 6 findings, batch in groups of 6.
- Use `model: "sonnet"` for straightforward fixes (approach A, single-file changes). Use `model: "opus"` for complex fixes (approach B/C, multi-file changes, new test files).

**Before launching agents**, determine the GitHub username (run `gh api user --jq .login`) and the repo owner/name (run `gh repo view --json nameWithOwner --jq .nameWithOwner`). Replace `GITHUB_USERNAME` and `{owner}/{repo}` placeholders in the agent prompt with the actual values.

### Phase 4: Handle Agent Failures

**Do NOT fall back to sequential execution in the main tree.** Switching between main
branch and worktrees in the main session causes ugly state conflicts.

If an agent fails:

1. Read the agent's result to understand WHY it failed (the agent is required to report
   the exact command, error message, and missing permissions).
2. Fix the root cause in the main session (e.g., add missing permissions to
   `.claude/settings.json` and commit to main).
3. Relaunch the failed agent with `isolation: "worktree"` — it gets a fresh checkout
   that includes the fix.

**Common failure causes and fixes:**
| Cause | Fix |
|-------|-----|
| Missing Bash permission | Add pattern to `.claude/settings.json`, commit to main |
| Agent used `cd` prefix | This shouldn't happen (prompt says not to). Relaunch — agents are non-deterministic. |
| `gh` auth issue | Ask user to run `! gh auth status` and fix |
| Git conflict in worktree | Delete stale worktree, relaunch agent |

### Phase 5: Report

After all agents complete:

1. Collect results: PR URL, pass/fail, CI status, Copilot state
2. Present a summary table:

```markdown
| Finding | Approach | Branch | PR | CI | Copilot | Status |
|---------|----------|--------|-----|-----|---------|--------|
| FINDING-01 | A | fix/finding-01-... | #N | ✅ | Approved | ✅ |
| FINDING-07 | B | fix/finding-07-... | #N | ✅ | 3 rounds, approved | ✅ |
| FINDING-03 | A | fix/finding-03-... | #N | ❌ | Concerns deferred | ⚠️ |
| Quick fixes | — | fix/quick-fixes | #N | ✅ | Approved | ✅ |
```

3. If any finding failed or has unresolved Copilot concerns, explain what went wrong and what the user can do.
4. If Copilot did not approve after 5 rounds, flag it clearly — the user may need to manually override or address remaining concerns.
5. **Collect non-blocking review suggestions**: After all rounds complete, review all
   reviewer comments across all PRs. Any suggestion that was flagged as valid but
   out of scope (nits, type-level guards, consistency cleanups, documentation
   improvements) must be appended to `docs/housekeeping.md`. Each entry should include:
   - Source (PR number and finding ID)
   - Location (file and line)
   - Effort estimate
   - Brief description of what to do
   This ensures good suggestions from reviewers are not lost between rounds.

---

## Alternative: Opus Reviewer Agent

When Copilot review is unavailable (e.g., no tokens left), launch an opus reviewer agent
instead. The reviewer runs against the PR diff and posts comments via `gh`.

**Reviewer agent prompt template:**

```
You are a critical code reviewer for the typesafe-hypermedia library.

## Required reading (do these FIRST, before looking at the PR)
1. Read `docs/how-it-works.md` — this is the architectural documentation that explains
   design decisions and trade-offs. Many things that look like issues are intentional.
2. Read `AGENTS.md` — project conventions, testing strategy, and common mistakes.

## Your task
Review PR #{pr_number} on branch `{branch}` in {owner}/{repo}.

Read the PR diff:
```bash
gh pr diff {pr_number}
```

Read the full files for any changed code to understand context beyond the diff.

## Review criteria
- Correctness: does the fix actually solve the finding?
- Safety: does it introduce regressions, break backwards compatibility, or weaken types?
- Test coverage: are new code paths tested? Are existing tests updated if behavior changed?
- Code quality: naming, clarity, unnecessary complexity
- Consistency with project conventions (see AGENTS.md)

## What NOT to flag
- Design decisions documented in `docs/how-it-works.md` — if the PR follows an
  established pattern, don't suggest alternatives unless there's a concrete problem
- Style preferences that don't affect correctness or readability
- Missing tests for code paths that are already covered by existing tests

## Output
Post your review as PR comments:
- For specific code concerns: use `gh api` to post review comments on specific lines
- For overall assessment: use `gh pr comment` with a summary

Always prefix comments with: `Opus Reviewer (on behalf of @{github_username}):`

If the code is good, say so clearly. Don't manufacture concerns to seem thorough.
```

Use `model: "opus"` for reviewer agents.

**Iteration with opus reviewer** follows the same loop as "Iterate with Copilot review
and CI" below, except:
- Skip the `sleep` polling — the reviewer agent runs synchronously or in background
- Replace Copilot-specific `gh api` queries with queries for the reviewer's comments
- The fix agent addresses reviewer feedback, pushes, and the orchestrator launches
  another reviewer round
- Max 5 rounds, same as Copilot

---

## Iterate with Copilot review and CI

This section defines the shared iteration loop used by both quick-fix and finding agents.
**Max 5 rounds.**

After pushing and requesting Copilot review, enter this loop:

### a. Poll for review and CI status

Wait 3 minutes, then check:

```bash
sleep 180

# Copilot review
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --jq '.[] | select(.user.login == "copilot-pull-request-reviewer") | {state, body}'

# Copilot comments
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  --jq '.[] | select(.user.login == "copilot-pull-request-reviewer" or .user.login == "Copilot") | {id, path, line, body}'

# CI status — check the build_and_test job
gh api repos/{owner}/{repo}/commits/$(git rev-parse HEAD)/check-runs \
  --jq '.check_runs[] | select(.name | test("build|test|Tests|Coverage")) | {name, conclusion, status}'
```

If no review yet or CI still running, wait another 2 minutes and retry (max 3 poll
attempts per round).

### b. Evaluate CI results

The CI workflow runs a `build_and_test` job with three sequential steps:
1. **Build** — TypeScript compilation
2. **Tests** — `npx jest` with coverage
3. **Coverage** — Checks against thresholds in `jest.config.js`

If ANY step fails:
- Read the CI logs: `gh run list --branch $(git branch --show-current) --limit 1 --json databaseId --jq '.[0].databaseId'` then `gh run view {run_id} --log-failed`
- Diagnose and fix the issue locally
- Run `npx jest` to verify the fix
- Commit, push, and re-poll

### c. Evaluate Copilot concerns

For each Copilot comment/suggestion:
- Read the referenced code to understand context
- Determine: is this a valid concern?
- Determine: would the fix increase PR complexity significantly (new abstractions, large refactors, scope creep)?
- If valid AND low-complexity: implement the fix
- If valid BUT high-complexity or out of scope: reply to the comment explaining why
  it's deferred, and **include the suggestion in your final report** so the orchestrator
  can append it to `docs/housekeeping.md`
- If not valid: reply to the comment explaining the reasoning

**Bias toward fixing, not deferring.** If a reviewer comment is about code introduced
or modified in this PR and the fix is minimal (a renamed variable, a removed redundant
cast, a one-line JSDoc, a type-level test), implement it immediately — even if it's
flagged as a "nit." Each PR should be self-contained and not leave behind immediate
housekeeping tasks for code it just touched. Only defer suggestions that affect code
outside the PR's scope or that would meaningfully expand the PR's footprint.

**How to reply to Copilot's review comments:**

Copilot leaves **pull request review comments** (attached to specific lines of code).
These are NOT regular issue/PR comments. You MUST use the correct API endpoint:

```bash
# CORRECT: Reply to an existing review comment (in_reply_to = the comment ID)
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  -X POST \
  -F in_reply_to={copilot_comment_id} \
  -f body="Claude Code (on behalf of @GITHUB_USERNAME): [your reply]"
```

```bash
# WRONG — this endpoint does not exist and returns 404:
gh api repos/{owner}/{repo}/pulls/comments/{id}/replies
```

```bash
# For a general PR comment (not a reply to a specific review comment):
gh pr comment {pr_number} --body "Claude Code (on behalf of @GITHUB_USERNAME): [message]"
```

To get comment IDs for replies, extract them from the poll response:
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  --jq '.[] | select(.user.login == "Copilot") | {id, path, line, body}'
```

### d. If changes were made — critically evaluate coverage

- Run `npx jest --coverage -- [changed-source-files]`
- Inspect the coverage report for ANY new or modified lines/branches that are not covered
- If new code paths exist without tests (e.g., a new `throw`, a new branch, a new helper), ADD a targeted test immediately
- Do NOT skip this step. Lesson learned: new runtime behavior without tests leads to Copilot flagging missing coverage in the next round, wasting an iteration.

### e. Push and re-request review

```bash
git add [specific files]
git commit -m "$(cat <<'EOF'
fix: address Copilot round N feedback

[What changed and why, referencing specific Copilot comments]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
git push
gh pr edit {pr_number} --add-reviewer @copilot
```

### f. Comment on PR with attribution

```bash
gh pr comment {pr_number} --body "Claude Code (on behalf of @GITHUB_USERNAME): Addressed review feedback — [brief summary of changes]. Re-requesting Copilot review."
```

### g. Repeat from step (a) until:
- Copilot approves (review state = "APPROVED") AND CI passes, OR
- Max 5 iteration rounds reached — report final state to user

**Important rules for iteration:**
- Always attribute comments: `Claude Code (on behalf of @GITHUB_USERNAME):`
- Never blindly implement suggestions that add redundant tests (check AGENTS.md "value over volume" principle)
- Never add code that duplicates existing test coverage — verify with `npx jest --coverage` first
- If Copilot suggests a test that is already covered by an existing test file, explain this in the reply comment
- Coverage evaluation is MANDATORY after every code change, not just the initial implementation
- CI failures take priority over Copilot comments — fix CI first, then address review

---

## Error Handling

| Situation | Strategy |
|-----------|----------|
| Solution file missing | Skip finding, warn user |
| Working tree dirty | Stop before starting, ask user to commit/stash |
| Tests fail after fix | Agent diagnoses and fixes. If unfixable, report the failure. |
| Coverage gap on new code | Agent adds a targeted test |
| Agent can't run Bash | Agent reports exact error and stops. Main session fixes root cause and relaunches. |
| PR creation fails | Report error, leave branch pushed for manual PR creation |
| `gh` version too old for `@copilot` | Warn user to run `brew upgrade gh`, skip reviewer assignment |
| Copilot review not appearing | Retry poll up to 3 times (2-3 min intervals). If still absent, report and move on. |
| Copilot suggests redundant test | Reply with comment explaining existing coverage. Do NOT add the test. |
| Copilot doesn't approve after 5 rounds | Report unresolved concerns in summary. User decides whether to override or address manually. |
| Coverage gap after Copilot-driven change | Agent MUST add test before pushing. This is non-negotiable — uncovered new code caused extra iteration rounds in past reviews. |
| `quick_fixes.md` missing | Warn user that no quick fixes file was found. Nothing to do. |
| Quick fix breaks a test | Revert that specific fix, note it in the PR body, apply the rest. |
| CI build fails | Agent reads `gh run view --log-failed`, diagnoses, and fixes. |
| CI coverage threshold fails | Agent adds tests to meet threshold, then re-pushes. |

## Branch Naming Convention

`fix/finding-XX-[2-4 word kebab-case description]`

Examples:
- `fix/finding-01-double-validation`
- `fix/finding-07-resolvefrom-error-message`
- `fix/finding-03-server-bind-localhost`
- `fix/quick-fixes` (for the bundled quick fixes PR)
