# pi config — colleague loop, wide-open gate, Tokyo Night

A portable [pi](https://pi.dev) agent configuration, version-managed in git. Every
session agrees on the task first, then works in small tested pieces without
permission prompts inside the project.

Default model: **`opencode-go/deepseek-v4.1-flash`**.

## What's here

| Path | What it is |
|---|---|
| `agent/AGENTS.md` | Global working agreement: restate, plan file, small tested pieces, verify before proposing |
| `agent/settings.json` | Default model, theme, padding, thinking |
| `agent/mcp.json` | Remote MCP servers — currently the web search/fetch server |
| `agent/extensions/governance/` | Permission gate, hard blocks, allowlists, footer (cache + throughput), title bar |
| `agent/extensions/blocky/` | Flat input panel with top/bottom separator rules |
| `agent/extensions/subagent/` | Subagent launches, project scoping, background jobs |
| `agent/extensions/questionnaire.ts` | Batched multiple-choice questions |
| `agent/agents/` | `scout`, `planner`, `reviewer`, `worker`, `tester`, `documenter` |
| `agent/prompts/` | `/implement`, `/scout-and-plan`, `/implement-and-review`, `/document` |
| `agent/themes/opencode.json` | Tokyo Night palette (theme name `opencode`) |
| `setup/` | Setup plans (`0001`…`0015`), decisions (`D-0001`…`D-0030`), notes, bootstrap summary |
| `.gitignore` | Excludes secrets and runtime state from git |

## How a session behaves

- **Agree first.** The agent restates the goal, the files it will touch, and how
  it will verify, then waits for a go-ahead. Non-trivial work gets a plan file
  (`docs/plans/NNNN-slug.md`, or `~/.pi/setup/` for agent-setup work).
- **Small tested pieces.** Implement, run the checks, let you test, commit that
  piece, then start the next one. One commit per tested piece.
- **No plan/build modes.** There is no read-only mode and no `/plan` toggle; the
  confirmation loop above is the control, not a gate.
- **Gate:** reads, writes, and commands are free inside the current project and
  `~/.pi` (source, config, extensions included). Writes and commands reaching
  **outside** those roots prompt, and can be remembered per project or globally.
- **Always prompts, never allowlistable:** `sudo`, force push (incl.
  `--force-with-lease`), `git reset --hard`, `git clean -fd`, `git checkout .`,
  `git restore`, `git branch -D`, `git filter-branch`/`filter-repo`, package
  publish, pipe-to-shell, `dd if=`, disk writes, shutdown/reboot, and `rm -rf`
  anywhere. One run can be authorized with the passcode from
  `/i-understand-the-danger`.
- **Web lookups** go through MCP tools (`mcp__websearch__web_search`,
  `mcp__websearch__web_fetch`) instead of `curl`.

## Web search

`agent/mcp.json` registers `https://search.parallel.ai/mcp` with `direct`
exposure — the same backend opencode's `websearch` tool uses. Two read-only
tools:

| Tool | Arguments |
|---|---|
| `web_search` | `objective` (required), `search_queries[]` (required, 3–6 words each) |
| `web_fetch` | `urls[]` (required, up to 20), `objective`, `search_queries`, `full_content`, `allow_live_fetch` |

No key is required (Parallel's hosted free tier). If the endpoint starts
refusing, set `PARALLEL_API_KEY` for a personal 5,000 requests/month. Exa was
rejected: it rate-limits without a key. The gate allows these tools by name
prefix in both the main session and subagents.

## TUI

- Tokyo Night palette: dark panels, blue `#7aa2f7`, violet `#bb9af7`, cyan
  `#89ddff`, green `#9ece6a`, red `#f7768e`.
- Title bar: project · model.
- Footer: session title · context % · cache hit rate · live tok/s + TTFT ·
  `↑in ↓out`, with branch · cost on the right.
- Input: flat panel, top/bottom rules, dark line-highlight background, bold text.
- User messages: the same panel tone with a violet left rail.
- Thinking starts collapsed (“Thinking… click to show”).
- Tool results share a uniform 4-line collapsed height; click or `ctrl+o` expands.
- Subagent/questionnaire rows are compact; details expand on click.

### Footer numbers

- **Cache hit rate** (`◐93.1% cache rate`) — `ΣcacheRead ÷ Σ(cacheRead + input)`
  across the session's assistant messages. The glyph is the last call's bucket:
  `●` ≥90% cached, `◐` partial, `○` nothing cached.
- **Throughput** (`⚡142 tok/s · 0.9s ttft`) — generation rate excluding
  time-to-first-token, plus TTFT anchored at the real HTTP request. Includes
  text, thinking, and tool-call JSON (matching `usage.output`); `~` marks a rate
  estimated from streamed characters, `≈` a rate that still includes startup.
  Accent while streaming, muted for the last completed call.

Both segments go compact on narrow terminals (`◐93%`, `⚡142 · 0.9s`).

## Commands

| Command | Effect |
|---|---|
| `/permissions` | Show project + global allowlists |
| `/name <title>` | Set the session title shown in the footer |
| `/header`, `/footer` | Toggle the title/footer bars |
| `/user-rail` | Toggle the left rail on user messages |
| `/blocky` | Toggle the flat input panel |
| `/jobs` | List background subagent jobs; `/jobs cancel <id\|all>` |
| `/i-understand-the-danger` | One-time passcode for one hard-blocked command |
| `/document` | Record the current work in `docs/` via the documenter |

pi's own `/reload`, `/resume`, `/model`, `/thinking`, `/mcp`, and `/tree` work as
usual; `/mcp` inspects or changes server exposure.

## Background subagents

`subagent` accepts `background: true` for a single agent + task:

- Returns immediately; keep chatting.
- One job per agent name runs at a time; extras queue.
- A widget above the input shows running/queued jobs and the last streamed line.
- On completion the result posts and the main agent gets an automatic turn.
- Children are killed on quit; results only deliver while pi is alive.

Subagents are optional: the agent edits and runs things itself. Launch one when a
job deserves its own context (broad recon, a long test run, a focused review).

## New machine / syncing

```bash
git clone <private-url> ~/.pi    # before pi creates the directory
cd ~/.pi && pi login             # auth is per-machine, never committed
pi mcp list                      # the web search server should connect
```

Pull/push config changes normally. **Never** commit `agent/auth.json`,
`agent/mcp-auth.json`, `agent/sessions/`, `agent/models-store.json`,
`agent/permissions.json`, or `.pi/permissions.local.json` — they are ignored. The
global allowlist is machine-local; add the `~/.pi/` rule on each machine (write
rules support `~`).

If this repo was ever copied or pushed before the cleanup, rotate the provider
token with `pi logout` / `pi login`.

## Tests

```bash
cd agent/extensions/governance
node --experimental-strip-types classifier.test.ts   # 425 cases
node --experimental-strip-types cache.test.ts        # 8 cases
node --experimental-strip-types throughput.test.ts   # 26 cases
node --experimental-strip-types renderers.test.ts
node --experimental-strip-types ../../blocky/separator.test.ts
```

## More detail

- `setup/how-i-run-pi.md` — shareable bootstrap summary
- `setup/decisions.md` — D-0001 … D-0030
- `setup/0001…0015-*.md` — setup plans and the build history
- `agent/AGENTS.md` — the rules an agent actually reads

## Summary of this setup

- **Working agreement:** restate and agree, plan file for non-trivial work, small
  tested pieces, one commit per piece, ask instead of guessing, verify the
  current state instead of trusting memory, never estimate work in human time.
- **Gate:** free inside the project and `~/.pi`; prompts only for out-of-scope
  actions and an always-prompt irreversible list with a passcode path.
- **Observability:** footer shows cache hit rate, live tok/s, TTFT, context, and
  session tokens/cost.
- **Lookups:** MCP web search/fetch (Parallel via opencode's backend), no key.
- **Subagents:** optional, one approval per launch, project-scoped, background
  jobs with queue/widget/auto-turn.
- **Agents:** scout, planner, reviewer, worker, tester, documenter.
- **TUI:** Tokyo Night, flat separators, dark-violet panels, bold input, dim
  thinking, uniform tool boxes, user rail.
- **Repo hygiene:** secrets and runtime ignored; portable `~` write rules;
  private-remote workflow.
