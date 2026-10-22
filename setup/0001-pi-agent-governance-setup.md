# 0001 — Pi agent governance setup

- **Date:** 2026-10-16
- **Status:** done
- **Owner:** hiemanshu

## Goal

Make the default pi setup plan-first: the main session explores and plans but only writes to `docs/`; source changes happen through subagents, and every launch is explicitly approved. Plans, decisions, and gotchas are recorded as files in the repo.

## Context

- First-time pi configuration, applied globally via `~/.pi/agent/`.
- pi enforces this with extensions: `tool_call` hooks can prompt, mutate, or block calls, and the subagent example spawns isolated `pi` processes with explicit tool lists.
- Setup documentation lives in `~/.pi/setup/`; project repos keep only project docs. This file and `decisions.md` were moved out of `d2-clone/docs/` on 2026-10-16.

## Non-goals

- Per-agent model selection (deferred; agents inherit the session model for now).
- Auto-documenting every turn (the `documenter` agent is invoked explicitly).
- OS-level sandboxing (the `sandbox` example was not used).

## Decisions

All seven decisions are recorded in `decisions.md` (D-0001 … D-0007). Summary:

1. Plans live in `docs/plans/`, repo conventions win.
2. Main session may write to `docs/`; source changes go through subagents.
3. One confirmation per subagent launch, scoped to the project directory; outside access needs an explicit `allowPaths` grant.
4. The main session starts read-only; each new write/command prompts, and the prompt can remember the pattern in the project or globally.
5. A never-allow list is hard-blocked; `/i-understand-the-danger` prints a one-time passcode to allow a single run.
6. `/plan` remains as an escape hatch and defaults on for every session.
7. Subagent roster: scout, planner, reviewer, worker, tester, documenter.

## Implementation

- [x] `~/.pi/agent/extensions/governance/` — plan mode, permission prompts, allowlists, hard-block list, subagent scoping
- [x] `~/.pi/agent/extensions/subagent/` — copied from the pi example; patched for mandatory launch confirmation, project scoping, and `allowPaths`
- [x] `~/.pi/agent/extensions/questionnaire.ts` — batched clarifying questions
- [x] `~/.pi/agent/agents/*.md` — scout, planner, reviewer, worker, tester, documenter
- [x] `~/.pi/agent/prompts/document.md` — `/document` workflow
- [x] `~/.pi/agent/AGENTS.md` — global working agreement
- [x] `decisions.md` — decision record
- [x] `.pi/permissions.local.json` — empty project allowlist (gitignored)

## Test plan

- [x] Extensions load without errors in a fresh `pi -p` invocation.
- [x] A write outside `docs/` is blocked in a non-interactive session.
- [x] A write inside `docs/` is allowed in a non-interactive session.
- [ ] Interactive: a source write prompts and "always allow" persists to `.pi/permissions.local.json`.
- [ ] Interactive: a subagent launch shows the confirmation summary.
- [x] `sudo` and `rm -rf` outside the project are hard-blocked in a non-interactive session.
- [ ] Interactive: `/i-understand-the-danger` + passcode allows exactly one hard-blocked run.
- [ ] A read outside the project inside a subagent is blocked and reported (guard path verified non-interactively; full run needs an interactive launch).

## Verification notes (2026-10-16, non-interactive `pi -p --model cat-jam-free`)

- `write evil.txt` → blocked with "no UI for approval"; no file created.
- `write docs/ok.md` → allowed; file created.
- `ls -la 2>&1` → allowed after treating stderr redirects as harmless.
- `sudo echo hi` → HARD BLOCK, not executed.
- `rm -rf /tmp/pi-definitely-outside` → HARD BLOCK, not executed.
- `subagent(agent: scout)` → blocked pending interactive approval.

## Open questions

- Which model(s) each agent should use (fast/cheap for scout and documenter, stronger for worker/reviewer).
- Whether the documenter should be invoked automatically at session end.
- Whether hard-blocked commands should ever be allowed inside a subagent (currently never).

## Notes

- 2026-10-16 amendment (D-0009): the gate now pre-approves writes anywhere in the current project and `~/.pi` from any project. The original docs-only policy was relaxed at the user's request; subagent delegation for source code remains the workflow convention.
- 2026-10-16 amendment: `cd` into the project directory and harmless redirects (`2>&1`, `>/dev/null`) are now classified as safe read-only segments.
- 2026-10-16 amendment: permission prompts gained a **✎ Type a custom rule…** free-text option (natural language, project/global scope, `allow once`/`deny`). The bash classifier is now quote/escape-aware (grep patterns with `|` no longer look like pipes), strips `FOO=bar` prefixes, allows `sed -n`/`awk` with guards, and checks write-capable flags (`find -exec`, `sort -o`, `curl -o`, `git branch -D`, …). Regression tests: `governance/classifier.test.ts` (49 cases).
- 2026-10-16: hard-block `rm` detection is per `rm` invocation now; separate `rm -r` and `rm -f` commands are no longer combined into `rm -rf` (that false positive blocked a legitimate cleanup). Regression tests in `classifier.test.ts` (53 cases).
- 2026-10-17: bash commands whose absolute paths all fall inside `~/.pi` are auto-allowed, and `rm -rf` inside a trusted root is no longer hard-blocked (D-0013).
- Extension copies live in `~/.pi/agent/`, not in Homebrew's Cellar, so pi upgrades do not break them.
- The governance gate authorizes per `tool_call`; parallel tool calls each prompt independently.
