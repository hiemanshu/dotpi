# Working agreement (global default)

This file applies to every project. Project-level `AGENTS.md` files override it where they are more specific.

## Where things live

- **Global agent details:** `~/.pi/` — extensions, agents, prompts, this file, and the global permission allowlist (`~/.pi/agent/permissions.json`).
- **Setup artifacts:** `~/.pi/setup/` — plans, decision records, and notes about configuring the agent itself. Setup docs never belong in a project repo.
- **Project docs:** `docs/` inside each repo (plans, decisions, notes), unless the repo has its own convention.

## Default mode: plan first, governed

Every session starts in **plan mode**. The `governance` extension enforces this:

- Read-only tools (`read`, `grep`, `find`, `ls`) and allowlisted read-only shell commands run without asking.
- Writes anywhere inside the current project are pre-approved (source included). `~/.pi/` is writable from any project via the global allowlist.
- Every other write/edit and every non-read-only shell command requires an explicit user approval per call. If the user allows it "always", it is added to an allowlist (`<project>/.pi/permissions.local.json` or `~/.pi/agent/permissions.json`).
- A never-allow list (sudo, force push, hard reset, publish, `rm -rf` outside the project, pipe-to-shell, …) is hard-blocked. Only the user can authorize one of these, once, with the passcode from `/i-understand-the-danger`.
- Subagents run in separate processes scoped to the project directory. They cannot prompt, so out-of-scope actions fail closed. Outside access requires the main session to ask the user and re-launch with `allowPaths`.
- Never try to evade the gate (shell redirection, encoding tricks, alternate tools). If a call is denied, explain and ask for direction.

`/plan` toggles the plan-first instructions (the gate stays active). `/permissions` shows the allowlists. `/i-understand-the-danger` prints a one-time passcode.

## Ask before you act

- Clarify first. Use the `questionnaire` tool to batch questions. Ask until goal, scope, constraints, and success criteria are unambiguous.
- Restate the task and your understanding, then get explicit approval before doing non-trivial work.
- Surface assumptions explicitly; never silently choose between plausible interpretations.
- More questions up front is better than rework later. Prefer asking over guessing, even when a guess seems obvious.
- If the user denies a permission prompt, stop and ask; do not retry or route around it.

## Plans, decisions, notes

- Non-trivial work gets a plan file: `docs/plans/NNNN-slug.md` (unless the repo has its own convention — check `CONTRIBUTING.md`, existing `docs/` layout, or ADR setup first). Work on the agent setup itself goes to `~/.pi/setup/` instead.
- Plan files include: goal, context, non-goals, numbered steps, files to touch, test plan, risks, open questions, and status (`draft` / `approved` / `in-progress` / `done`). Update the status as work proceeds.
- Important decisions go in `docs/decisions.md` (or the repo's ADR convention): date, decision, alternatives considered, rationale.
- Gotchas and lessons go in `docs/notes/YYYY-MM-DD-topic.md` so they are not rediscovered.
- Keep the plan file honest: if the approach changes, update the plan before or with the change, not after.

## Build by delegation

The main session does not edit source code. Implementation happens through subagents (each launch requires user confirmation):

| Agent | Tools | Use for |
|---|---|---|
| `scout` | read-only | Fast codebase recon, compressed context |
| `planner` | read-only | Implementation plan from context + requirements |
| `reviewer` | read-only | Review of a diff or change for bugs/security |
| `worker` | full build | Implementation and fixes |
| `tester` | read-only + bash | Running the test suite/checks, reporting results |
| `documenter` | docs/ write | Plans, decision records, notes (never source) |

Suggested flow: scout → plan (write the plan file, get approval) → worker implements → tester verifies → reviewer reviews → worker fixes review findings → documenter records outcomes. Skip steps that add no value, but never skip verification.

## Model choice

Agent definitions intentionally omit `model`, so subagents inherit the session model and thinking level. We will tune per-agent models later.
