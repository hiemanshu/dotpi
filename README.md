# pi config — plan-first, permission-gated, Tokyo Night

A portable [pi](https://pi.dev) agent configuration, version-managed in git. Every
session starts in **plan mode**, asks before anything risky, delegates builds to
subagents, and keeps plans/decisions/notes as files.

Default model: **`opencode-go/deepseek-v4.1-flash`**.

## What's here

| Path | What it is |
|---|---|
| `agent/AGENTS.md` | Global working agreement: clarify first, plan files, decisions, notes, delegation |
| `agent/settings.json` | Default model, theme, padding, thinking |
| `agent/extensions/governance/` | Plan mode, permission gate, allowlists, hard blocks, title/status bars |
| `agent/extensions/blocky/` | Flat input panel with top/bottom separator rules |
| `agent/extensions/subagent/` | Subagent launches, project scoping, background jobs |
| `agent/extensions/questionnaire.ts` | Batched multiple-choice questions |
| `agent/agents/` | `scout`, `planner`, `reviewer`, `worker`, `tester`, `documenter` |
| `agent/prompts/` | `/implement`, `/scout-and-plan`, `/implement-and-review`, `/document` |
| `agent/themes/opencode.json` | Tokyo Night palette (theme name `opencode`) |
| `setup/` | Setup plans, decisions, notes, and the shareable bootstrap summary |
| `.gitignore` | Excludes secrets and runtime state from git |

## How a session behaves

- **Plan first.** Read, explore, and ask questions. Non-trivial work gets a plan
  in `docs/plans/NNNN-slug.md` (or `~/.pi/setup/` for agent setup work).
- **Gate:** reads are free. Writes anywhere in the current project and `~/.pi`
  are allowed; writes outside those paths and non-read-only bash prompt for
  approval. Approvals can be remembered per project or globally.
- **Hard blocks:** `sudo`, force push, hard reset, publish, `rm -rf` outside the
  project, pipe-to-shell, and similar are blocked. One run can be authorized
  with the one-time passcode from `/i-understand-the-danger`.
- **Source edits** are delegated to `worker` subagents by the working agreement.
  Every subagent launch requires a confirmation showing agent, tools, task, and
  scope. Children are limited to the project directory; outside access requires
  an explicit `allowPaths` grant.
- **Docs writes** are part of the normal flow. Decisions go to `docs/decisions.md`
  (or the repo convention); gotchas to `docs/notes/`.

## TUI

- Tokyo Night palette: dark panels, blue `#7aa2f7`, violet `#bb9af7`, cyan
  `#89ddff`, green `#9ece6a`, red `#f7768e`.
- Title bar: project · mode · model.
- Input: flat panel, top/bottom rules, dark line-highlight background, bold text.
- Footer: session title · context % · tokens, branch · cost; top/bottom rules.
- User messages: the same panel tone with a violet left rail.
- Thinking starts collapsed (“Thinking… click to show”).
- Tool results share a uniform 4-line collapsed height; click or `ctrl+o` expands.
- Subagent/questionnaire rows are compact; details expand on click.

## Commands

| Command | Effect |
|---|---|
| `/plan` | Toggle plan-first instructions (gate stays active) |
| `/permissions` | Show project + global allowlists |
| `/name <title>` | Set the session title shown in the footer |
| `/header`, `/footer` | Toggle the title/status bars |
| `/user-rail` | Toggle the left rail on user messages |
| `/blocky` | Toggle the flat input panel |
| `/jobs` | List background subagent jobs; `/jobs cancel <id\|all>` |
| `/i-understand-the-danger` | One-time passcode for one hard-blocked command |
| `/document` | Record the current work in `docs/` via the documenter |

## Background subagents

`subagent` accepts `background: true` for a single agent + task:

- Returns immediately; keep chatting.
- One job per agent name runs at a time; extras queue.
- A widget above the input shows running/queued jobs and the last streamed line.
- On completion the result posts and the main agent gets an automatic turn.
- Children are killed on quit; results only deliver while pi is alive.

## New machine / syncing

```bash
git clone <private-url> ~/.pi    # before pi creates the directory
cd ~/.pi && pi login             # auth is per-machine, never committed
```

Pull/push config changes normally. **Never** commit `agent/auth.json`,
`agent/sessions/`, `agent/models-store.json`, `agent/permissions.json`, or
`.pi/permissions.local.json` — they are ignored. The global allowlist is
machine-local; add the `~/.pi/` rule on each machine (write rules support `~`).

If this repo was ever copied or pushed before the cleanup, rotate the provider
token with `pi logout` / `pi login`.

## Tests

```bash
node --experimental-strip-types agent/extensions/governance/classifier.test.ts
node --experimental-strip-types agent/extensions/blocky/separator.test.ts
node --experimental-strip-types --check agent/extensions/governance/index.ts
```

## More detail

- `setup/how-i-run-pi.md` — shareable bootstrap summary
- `setup/decisions.md` — D-0001 … D-0026
- `setup/0001…0010-*.md` — setup plans and the build history
- `agent/AGENTS.md` — the rules an agent actually reads

## Summary of this setup

- **Governance:** default plan mode, permission gate with project/global
  allowlists, hard-block list + passcode, subagent scoping, title/status bars.
- **Subagents:** mandatory confirmation, project-directory scope, `allowPaths`,
  compact rows, background jobs with queue/widget/auto-turn, `/jobs`.
- **Agents:** scout, planner, reviewer, worker, tester, documenter.
- **TUI:** Tokyo Night, flat separators, dark-violet panels, bold input, dim
  thinking, uniform tool boxes, user rail.
- **Repo hygiene:** secrets and runtime ignored; portable `~` write rules;
  private-remote workflow.
