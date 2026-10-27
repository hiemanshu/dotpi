# 0013 — Colleague loop: confirm, discuss, then work without prompts

- **Date:** 2026-10-27
- **Status:** approved (2026-10-27) — one piece, starts once the other session's uncommitted `utils.ts` work is committed
- **Owner:** hiemanshu
- **Supersedes:** D-0029 (docs-only main-session writes), refines D-0002 (plan-first gate)

## Goal

Replace the plan/build gate with the working relationship the user actually wants:

1. **Before any task**, the agent restates what it understood, says how it will prove it worked, and gets a go-ahead. Discussion first, like colleagues.
2. **No permission prompts for ordinary work inside the project or `~/.pi`** — writes, tests, `git`, package scripts, extension edits.
3. **Prompts survive only where they carry information**: actions reaching outside the project and `~/.pi`, and irreversible operations.

## Context

- The gate was built for a trust problem that no longer dominates: the user wants a collaborator, not a supervised build.
- Measured friction: every non-read-only bash call (`node …/x.test.ts`, `git commit`, `mv`), every write outside `docs/`+`setup/`, and every subagent launch prompts. One agile slice costs 3–6 prompts, which is why the small-piece loop stalled.
- Plan mode does two jobs: it injects the plan-first rules and it hard-blocks writes. Only the second is objectionable; the injected rules duplicate `AGENTS.md`, which loads every session anyway.
- 2026-10-27 review of this plan: plan mode is removed entirely (no toggle, no badge, no read-only mode); the confirmation loop is carried by `AGENTS.md`; the safety net widens to destructive in-project actions.

## Non-goals

- No new TUI chrome, badges, or commands. No new config file format.
- No sandboxing/containerizing; the shell stays best-effort.
- No change to `blocky`, themes, or the subagent implementation beyond deleting the plan-mode special case.
- No automatic commits or pushes; git stays an explicit, agreed step.

## Design

### Behaviour (`AGENTS.md`, no code)

- **Before starting any task**, post a short restatement: goal, files touched, how it will be verified, first slice. Wait for a go-ahead unless the user already gave one for that scope.
- **A plan file** (`docs/plans/NNNN-slug.md`, or `~/.pi/setup/` for agent setup) for every non-trivial task, written before implementation and kept honest.
- **Small tested pieces**: implement → verify → the user tests → commit → next piece. Never move past an untested piece.
- Ambiguity is answered with a question, never a guess.
- The agent edits and runs things itself; subagents are for jobs that deserve an isolated context, not a per-task ritual.

### Gate (`governance/`)

| Action | Behaviour |
|---|---|
| `write`/`edit` inside the project | allow |
| `write`/`edit` inside `~/.pi` (docs, agents, prompts, themes, `settings.json`, extensions) | allow |
| `write`/`edit` outside both | prompt, rememberable via allowlist |
| Bash read-only | allow (unchanged classifier) |
| Bash that writes/executes inside the project or `~/.pi` | allow |
| Bash reaching outside both (`cd ~/elsewhere`, absolute paths, `git` on another repo) | prompt |
| Irreversible operations (below) | always prompt, never allowlisted, passcode as today |
| Subagent launch | prompt (rare by design) |

Plan mode loses its write block; `/plan`, the `⏸ plan` / `▶ governed` badge, the `plan` flag handling, and the injected `PLAN_CONTEXT` are deleted. The title bar's mode slot goes away; it shows project + model only.

### Always-prompt list (decided 2026-10-27)

`sudo` · force push (incl. `--force-with-lease`) · `git reset --hard` · `git clean -fd`/`-fdx` · `git checkout .` / `git restore` that discards work · `git branch -D` · rewrites of published history · package publish · pipe-to-shell · `rm -rf` anywhere (inside the project included) · disk formatting/`dd if=` · shutdown/reboot.

Everything on this list is either unrecoverable or destroys uncommitted work; the project tree is otherwise trusted because git is the safety net.

## Steps (one piece, after the other session commits)

1. `AGENTS.md`: rewrite the working agreement for the colleague loop; drop docs-only writes and build-by-delegation.
2. `index.ts`: gate verdicts for inside-scope allow; delete plan-mode block, badge, flag, and injected context; keep subagent launch approval.
3. `utils.ts`: `mainWriteVerdict` → allow inside project/`~/.pi`, ask outside; bash "inside scope" verdict; widen the always-prompt list.
4. `classifier.test.ts`: cases for every row of the table plus each always-prompt entry.
5. `README.md`, `setup/how-i-run-pi.md`: describe what remains.
6. `setup/decisions.md`: D-0030, superseding D-0029.
7. Commit once, with the plan file status moved to done.

## Files

| File | Change |
|---|---|
| `agent/AGENTS.md` | colleague loop, plan file always, small tested pieces, no delegation-by-default |
| `agent/extensions/governance/index.ts` | inside-scope allow, remove plan injection/badge/toggle |
| `agent/extensions/governance/utils.ts` | write + bash verdicts, wider always-prompt list |
| `agent/extensions/governance/classifier.test.ts` | verdict + danger-list cases |
| `agent/extensions/governance/README.md` | new gate description |
| `setup/how-i-run-pi.md` | permission model section |
| `setup/decisions.md` | D-0030 |
| `setup/0013-colleague-loop.md` | this plan |

## Test plan

- [ ] Classifier suite green, including: edit inside project → allow; edit inside `~/.pi` → allow; edit in `~/Downloads` → ask; `node …/x.test.ts` inside project → allow; `git commit` inside project → allow; `cd ~/other` → prompt; each always-prompt entry → blocked regardless of allowlist.
- [ ] Live: one full slice (edit, test, commit) produces **zero** prompts.
- [ ] Live: `~/Downloads/x` write prompts once and can be remembered; subagent launch still prompts once.
- [ ] Live: `/plan` is gone; session start, reload, and `/permissions` still work; no plan-mode badge in the title bar.

## Risks

- The always-prompt list is now the entire safety net. Too short is unrecoverable, so err long.
- Free `~/.pi` writes plus concurrent sessions widen the blast radius; mitigate by committing each tested piece promptly.
- Plan files can rot once the gate no longer forces them — a behavioural risk, not an enforceable one.
- Removing the write block removes the reason delegation existed; long autonomous edits become possible. The agreed restatement and the small-piece loop are the control, not the gate.

## Resolved open questions (2026-10-27)

1. Plan mode: removed entirely.
2. Always-prompt list: as above, widened to destructive in-project actions.
3. `~/.pi`: free to edit, extensions included.
4. Sequencing: one piece, started after the other session's uncommitted `utils.ts` work is committed.
