# 0023 — Auto mode while a plan is approved

- **Date:** 2026-11-08
- **Status:** done
- **Scope:** agent setup (`~/.pi/`)
- **Touches:** `agent/extensions/governance/` (new `trust.ts` + `trust.test.ts`, `index.ts`, `utils.ts`, `footer.ts`), `agent/extensions/governance/README.md`, `agent/AGENTS.md`, `setup/how-i-run-pi.md`, `setup/decisions.md`

## Goal

While a plan in this repo says `approved` or `in-progress`, the gate stops asking. Two things still stop: **installs and publishes**, and the **hard-block list** (which needs the passcode either way). When no plan is approved, behaviour is exactly what it is today.

## Context

The gate already asks in only five places (D-0033): installs/publishes, network commands, writes outside the project/`~/.pi`/temp dirs, destructive-but-not-hard-blocked forms (`rm -r`, `find -delete`), and MCP tools with no rule. Everything local runs free, and that is not changing.

The friction is the mid-implementation interruption: a `curl` to check a URL, a `rsync` of an asset out of the repo, a write into a sibling folder, a first call to an MCP tool — each needs a click that carries no information because the plan already said what the work is.

Four answers from the user, which is what makes this a design rather than a guess:

- **Trigger:** detect plan approval in files; otherwise ask as today.
- **Lifetime:** session only — nothing persisted, nothing carried into the next session.
- **Exceptions:** installs and publishes still ask. Everything else on the ask list is free while the mode is on.
- **Visibility:** a mode marker plus one notification when it turns on and off. Individual calls pass silently.

## Non-goals

- Not a security boundary. The bash gate is already allow-by-default for local work (D-0033), so the only ground auto mode actually gains is network commands, writes outside the trusted roots, `rm -r`/`find -delete`, and unlisted MCP tools. That is worth saying out loud in the README rather than implying the gate is now tighter than it is.
- Not persistence. There is no `/auto on` and no allowlist entry; approval comes from a file, and the session forgets it.
- Not a change to the hard-block list, the passcode, the `edit`/`write` gate inside the trusted roots, the subagent scope gate, or the `powershell`/unknown-tool blocks.
- Not a general plan-file parser. Only the `Status:` line of `docs/plans/*.md`, plus `~/.pi/setup/*.md` when the session is working on the setup itself.

## Design

**Which files count.** `<cwd>/docs/plans/*.md` always. `~/.pi/setup/*.md` only when `cwd` is inside `~/.pi` — a setup plan elsewhere must not grant trust in a project. No plans directory means no auto mode, which is the honest default: this repo has no `docs/plans/` yet, so the mode stays off until we create the first plan.

**What counts as approved.** The first 25 lines, looking for a line containing `status`, then `approved` or `in-progress`/`in progress` anywhere on that line, case-insensitive. So `- **Status:** approved`, `**Status:** approved (2026-11-08)`, and a table row all work. `draft`, `done`, `superseded`, `blocked`, and anything unrecognised do not.

**Derived, not latched.** The mode is on while any qualifying plan file says approved, and off when none does. No session flag that outlives its cause — a plan flipping to `done` turns the mode off at the next turn, which is the behaviour I want to be able to explain in one sentence. Re-evaluated on `session_start` and on `before_agent_start`, so it costs a couple of small file reads per turn.

**What the mode changes.** In `handleMainCall`, after the hard block and the install check:

| Call | Today | Auto mode |
|---|---|---|
| `bash` ask verdict (network, outside write, `rm -r`, `find -delete`) | ask | allow |
| bash install/publish | ask | **still asks** |
| `edit`/`write` outside the trusted roots | ask | allow |
| MCP tool with no rule | ask | allow |
| hard-block list (`rm -rf`, `sudo`, force push, …) | passcode | **unchanged** |
| unknown tool, `powershell` | block | **unchanged** |
| subagent scope | env-scoped | **unchanged** (no UI there anyway) |

**The install gap this exposes.** `INSTALL_OR_PUBLISH` in `utils.ts` has no `pi install` pattern, so today `pi install git:…` runs unprompted — and that clones and executes third-party extension code. If installs are the one thing that still asks, this has to be recognised first. Add `pi (install|update|uninstall|remove)` to the list, which plan 0024 then exercises for real.

**Marker.** `⚙ auto` appended to the existing status element next to `🔑`, with one notification when it flips on (naming the plan file) and one when it flips off. Footer segments are untouched — the throughput `⚡` already owns that glyph.

**Command.** `/auto` reports whether the mode is on, which file is holding it on, and the exception list. `/auto off` disables it for the rest of the session; `/auto` again re-derives from the plan files. There is deliberately no `/auto on`, because that would be me approving my own plan.

## Steps

1. `trust.ts` — pure functions: `planStatus(line)`, `qualifyingPlans(files)`, `autoModeReason(plans, cwd)`, and `autoAllow(kind, command)` that answers "does the mode cover this call".
2. `trust.test.ts` — the parse table, the scope rules, and the gate matrix.
3. `utils.ts` — add the `pi` install patterns.
4. `index.ts` — derive the mode on session start and before each turn, notify on change, wire it into the four ask paths, add the marker and `/auto`.
5. Run the suites: new trust tests, the existing classifier (494 cases) and MCP/throughput/cache suites.
6. `/reload`, then prove it live: create a scratch `docs/plans/0001-smoke.md` with `Status: approved` in a temp repo, confirm `/auto` reports on, run a network command that asked before and see it pass, then flip the plan to `done` and see the mode drop.
7. Docs: README (what the mode does, what still asks, what it is not), `how-i-run-pi.md` (the setup summary), `AGENTS.md` (the permission section now has a third state), `decisions.md` (D-0037).

## Files

- `agent/extensions/governance/trust.ts` — new
- `agent/extensions/governance/trust.test.ts` — new
- `agent/extensions/governance/index.ts` — mode derivation, markers, `/auto`, gate wiring
- `agent/extensions/governance/utils.ts` — `pi` install patterns
- `agent/extensions/governance/README.md` — auto mode section
- `agent/AGENTS.md` — permission gate paragraph
- `setup/how-i-run-pi.md`, `setup/decisions.md`

## Test plan

- `node --experimental-strip-types trust.test.ts` — status parsing (approved, in-progress, draft, done, superseded, missing, bold markdown, table row), scope rules (project plans, setup plans only inside `~/.pi`, no directory), and the gate matrix above including "install still asks under auto mode" and "hard block unaffected".
- Existing suites unchanged and still green except the `classifier.test.ts` case the README already records as failing on this Windows machine — run it before and after to show the failure set is identical.
- Live: the scratch-repo walkthrough in step 6, with the actual output pasted into the plan's result section.

## Risks and honest limits

- **The plan file is agent-writable, and writes inside the project are free.** So an agent can set `Status: approved` on its own plan and switch the mode on. The plan doc says this in the README; the guard is that the change is visible in the transcript and that installs and hard blocks still hold. I considered requiring the approval to predate the session, which would break the actual flow (plan approved in conversation, then implementation in the same session).
- **MCP tools become unattended in auto mode**, including write/delete tools on any configured server. That follows from "only installs still ask", and it is the one widening worth naming separately.
- **A plan left at `in-progress` after the work is done keeps the mode on** until it is set to `done`. That is a documentation habit, not a code guarantee.
- **Notification noise:** one notification per on/off transition, so a plan edited back and forth notifies each way.

## Result

Built as designed. `trust.ts` holds the parse, the scan scope and the gate matrix as pure functions; `index.ts` derives the mode on session start and before every turn and wires it into the three ask paths that can prompt.

| Check | Evidence |
|---|---|
| Status parse, scope, gate matrix, `pi install` pattern | `trust.test.ts` — 34 cases pass |
| Existing suites | `mcp` 24, `throughput` 26, `cache` 8 pass; `classifier.test.ts` fails on exactly the `cd C:\Users\…\govtest-… && grep -n "x|y" src` case the README already records, reproduced against a copy of `HEAD` in a temp dir |
| Network ask gone | `curl -sS -m 2 http://127.0.0.1:1` ran, exit 7, no block message (approved plan) |
| Network ask intact without a plan | same command in a `draft` repo → `⛔ BLOCKED · command approval` |
| Outside write gone | `echo … > ~/autotest-outside.txt` ran (approved); same command in the `draft` repo → `⛔ BLOCKED · command approval` |
| Destructive ask gone | `rm -r junk` ran, directory gone |
| Install still asks | `npm install --dry-run --offline left-pad` → `⛔ BLOCKED · command approval` (approved plan) |
| Hard block intact | `rm -rf /tmp/autotest-nonexistent-dir` → `⛔ HARD BLOCK · rm -rf` |

Sessions were run with `pi -p` in scratch repos (no UI, so an ask becomes a block — which is exactly what makes the before/after readable). Markers and `/auto` are TUI-only and are exercised by hand in the next interactive session; the notification text was read from the built code, not observed.

**One change from the plan:** the plan test list said "four print-mode sessions"; it took seven once each category had a before and an after. Also, the first outside-write probe used `/tmp`, which is a trusted root, so it proved nothing — the retest used `$HOME`.

**Open question, decided:** no staleness warning for an old `Status: approved`. A timestamp would invite trusting a number that means little; the plan file is re-read every turn anyway, so the freshest signal is the one already in use.
