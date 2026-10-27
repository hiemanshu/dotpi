# Decision log

Decisions that shape the project. Newest at the bottom. Each entry: date, decision, alternatives considered, rationale.

---

## D-0001 — Plans are stored in `docs/plans/`

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Plans, decision records, and notes live in the repo under `docs/`, with one file per plan (`docs/plans/NNNN-slug.md`), unless a repo already has a different convention (in which case that wins).

**Alternatives:** repo-root `plans/`; `docs/decisions/NNNN-*.md` ADR files; local `.pi/plans/` (gitignored).

**Rationale:** Versioned with the code, reviewable in PRs, and one obvious place to look.

---

## D-0002 — The main session may write only to `docs/`

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** The main (planning) session can read anywhere and write inside `docs/` without asking. Source, config, and every other file write is routed through a subagent after explicit approval.

**Alternatives:** no writes at all in the main session (plans live in chat or are saved by a subagent); normal `write` with a prompt for everything.

**Rationale:** Plans and decisions are the main session's output, so writing them must be frictionless. Code changes are the risky part and are delegated.

---

## D-0003 — One confirmation per subagent launch, project-scoped

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Every subagent launch shows one confirmation with the agents, tools, tasks, and scope. Subprocesses are hard-scoped to the project directory; anything outside — including reads — is blocked and reported back. The parent session can ask the user and re-launch with an explicit `allowPaths` grant.

**Alternatives:** one confirmation with no scoping (trust the task); per-write confirmations inside the subagent (subprocesses have no UI, so this needs significant extra plumbing).

**Rationale:** Keeps approval overhead at one prompt per delegation while still enforcing the boundary mechanically.

---

## D-0004 — Prompt-once pattern allowlisting

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** The first time a non-approved action is attempted, the user is prompted with: allow once, always allow in this project, always allow everywhere, or deny. Remembered rules are stored in `<project>/.pi/permissions.local.json` (gitignored) and `~/.pi/agent/permissions.json`.

**Alternatives:** a single global allowlist; hard-block everything not on a static list; ask every single time with no memory.

**Rationale:** The allowlist grows to match the user's actual workflow instead of predicting it, and the project/global split keeps repo-specific commands local.

---

## D-0005 — Hard-block list with a one-time passcode

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** `sudo`, `rm -rf` outside the project, force push, `git reset --hard`, `git clean -fd`, package publish, pipe-to-shell, disk formatting, fork bombs, and similar are never allowed by the normal flow. To allow one, the user runs `/i-understand-the-danger`, which prints a one-time passcode (2 minutes, single use) that must be typed into the prompt.

**Alternatives:** always prompt even for these; block with no override.

**Rationale:** Catastrophic actions deserve a deliberate, human-paced override that the model cannot self-serve.

---

## D-0006 — `/plan` stays as an escape hatch, default on

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Every session starts in plan mode. `/plan` toggles it off for the session; a new session starts in plan mode again.

**Alternatives:** fully locked (build only through subagents, no toggle); start in normal mode and require `/plan` to opt in.

**Rationale:** The default is safe, but the user stays in control and can grant the main session access deliberately.

---

## D-0007 — Subagent roster

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Six agents: `scout` (recon), `planner` (plans), `reviewer` (review), `worker` (build), `tester` (runs tests, read-only), `documenter` (writes `docs/` only). Agents omit `model` and inherit the session model for now.

**Alternatives:** the pi example's four agents (scout/planner/worker/reviewer); a single generic worker.

**Rationale:** A tester that cannot edit catches verification gaps; a documenter that cannot touch source keeps the record accurate without risking code.

---

## D-0008 — Agent setup docs live in `~/.pi/setup`

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Global agent details live in `~/.pi/` (extensions, agents, prompts, instructions, allowlists). Documentation about configuring the agent itself — setup plans, decision records, notes — lives in `~/.pi/setup/`. Project repos contain only project documentation.

**Alternatives:** keep setup docs in each project repo's `docs/`; leave them only in session history.

**Rationale:** The setup applies to every project, so per-repo copies are noise and go stale independently. One home for agent configuration and its rationale keeps both discoverable. The `d2-clone` copies were removed on 2026-10-16.

---

## D-0009 — Writes: any project's cwd plus `~/.pi` are trusted

- **Date:** 2026-10-16
- **Status:** superseded by D-0029

**Decision:** The governance gate pre-approves writes anywhere inside the current project (source included) and anywhere under `~/.pi` from any project (via the global allowlist). Writes outside the current project — other than `~/.pi` — and all non-read-only shell commands still require approval. Source edits remain delegated to subagents by workflow convention, not by the gate.

**Alternatives:** allow current-project writes only for `d2-clone` (project allowlist); keep the main session limited to `docs/` and `.pi/`; keep prompting per new path.

**Rationale:** Per-path prompts added friction without changing behavior for setup work, and the user wants the main session able to edit project files directly when warranted. The cwd boundary plus `~/.pi` keeps everything else gated.

---

## D-0010 — Split TUI: tmux + a bat-rendered edit preview

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** The split view is a tmux layout (pi left 55%, code right 45%) launched with `~/.pi/bin/pi-split`. A preview extension records the changed line ranges of every `edit`/`write` to `<agent-dir>/state/preview.json`; `preview-watch.py` polls it and renders the edited region plus 3 lines of context with `bat --theme=ansi`, a dim header, and 2-space padding. pi gets `editorPaddingX: 1`.

**Alternatives:** a native `setWidget` panel (full-width, stacked, not left/right); a custom SDK client that reimplements the TUI (too much); no split.

**Rationale:** pi 1.2's extension API has no persistent side-by-side layout — widgets are full-width and `custom()` is a temporary overlay. tmux gives the real left/right look with minimal coupling. The state-file bridge keeps the extension and renderer independent, and works for subagent edits too. `bat --theme=ansi` follows the terminal palette, keeping the look consistent with the system theme.

**Superseded (2026-10-16):** the user rejected the tmux split and it was removed. The aesthetic was applied to pi's own TUI instead — see D-0011.

---

## D-0011 — opencode-style restyle of pi's own TUI

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Remove the tmux split entirely and restyle pi's native TUI: a fixed dark `opencode` theme (`~/.pi/agent/themes/opencode.json`), a slim full-width title bar replacing the built-in header, a status-bar footer with a top rule and `│` separators, and more padding (`editorPaddingX: 2`, `outputPad: 1`). `/header` and `/footer` toggle the chrome.

**Alternatives:** a native full-width preview widget (stacked, not side-by-side); keeping the tmux split and only restyling it; leaving the theme at `system` and only adding padding.

**Rationale:** pi 1.2 has no persistent split API, and the tmux workaround was rejected. Applying the aesthetic natively keeps everything inside pi and avoids the extra process/pane machinery. The title bar and status bar give the VS Code/opencode framing without changing how the transcript works.

---

## D-0012 — Blocky edit boxes and a user-message rail

- **Date:** 2026-10-16
- **Status:** accepted

**Decision:** Force the `edit` tool back into pi's default boxed shell via a `registerToolRenderer` resolver (`renderShell: "default"`), and give user messages a Markdown blockquote left rail via `registerMarkdownTransformer` when `messageType === "user"`. The transform is render-only: stored messages and model context are unchanged. `/user-rail` toggles it. Theme borders were brightened (`border`, `borderMuted`), `mdQuoteBorder` set to the violet accent, and `userMessageBg` given a subtle violet tint.

**Alternatives:** custom edit renderers with hand-drawn frames (more code, duplicates the shell); a theme-only background for user messages (no real border); rewriting stored user messages to blockquotes (pollutes exports, compaction, and model context).

**Rationale:** pi already has a boxed tool shell; the edit tool simply opts out. The Markdown transformer gives a real left rail without touching the conversation data, which keeps exports and compaction clean.

**Update (2026-10-22):** every built-in tool result now shares a uniform collapsed height (4 content lines + a dim hint) and expands to the full result on click / ctrl+o. The wrapper keeps the built-in result component so streaming updates stay intact.

---

## D-0013 — Path-scoped bash trust for `~/.pi`

- **Date:** 2026-10-17
- **Status:** superseded by D-0029

**Decision:** A bash command whose absolute (or `~`) path arguments all resolve inside the pi config root (`~/.pi`) runs without prompting, even when it is not on the read-only list. `rm -rf` targets inside a trusted root (project cwd or `~/.pi`) are no longer hard-blocked. Hard blocks still apply everywhere else; commands with only relative paths, or that touch any other path, keep the normal approval flow.

**Alternatives:** extend the same trust to the current project's cwd; add a static bash allowlist for setup commands; leave it as-is.

**Rationale:** The global write allowlist already treats `~/.pi` as trusted, but bash classification is command-based and never saw paths, so setup commands (`find ~/.pi/... -delete`, `rm -f ~/.pi/...`, `node --check ~/.pi/...`) kept asking. Trusting commands scoped to the config root makes the trust consistent without opening up arbitrary commands.

---

## D-0014 — pi-split architecture: RPC child + custom pi-tui client

- **Date:** 2026-10-17
- **Status:** accepted

**Decision:** The split client is a standalone TUI that spawns `pi --mode rpc`, speaks the JSONL protocol directly (the package's `RpcClient` has no public way to answer extension UI dialogs), and renders with `@earendil-works/pi-tui`. It is not an in-process SDK session. The child keeps the real pi process — sessions, auth, tools, skills, extensions, and the governance permission gate — while the client renders the split and answers forwarded `select`/`confirm`/`input`/`editor` dialogs.

The split uses an explicit per-frame `basis` (58% chat / 42% code) because pi-tui's sequential `grow` allocator distributes 6:4 as ~79:21.

**Alternatives:** in-process SDK embedding (needs a host-provided UI context and more integration surface); tmux split (rejected by the user); a full-width native widget (stacked, not side-by-side).

**Rationale:** RPC mode is the documented path for custom UIs, preserves every pi feature including the governance gate, and gives a true left/right layout. The custom JSONL client exists only because dialog responses are not exposed by the typed client.

**Superseded (2026-10-17):** the user rejected the two-panel split after seeing Stage 1. The pi-split app was deleted; the style pivot is a single-pane blocky TUI — see D-0015 and plan 0005.

---

## D-0015 — Single-pane blocky style instead of a split

- **Date:** 2026-10-17
- **Status:** accepted

**Decision:** Drop the split entirely. Restyle the normal pi TUI toward opencode's blocky single-column look: a rounded, compact input box as the main visual block, rounded tool blocks (only if the default shell isn't already boxed), existing title/status bars, existing `opencode` theme. Implemented as a separate `blocky` extension; `/blocky` toggles the custom editor.

**Alternatives:** the tmux split (rejected); the RPC split client (rejected, deleted); theme-only changes (insufficient); boxing every message (not supported for built-in messages).

**Rationale:** The user wants opencode's blockiness without two panels. The extension API can box the editor and tool output but cannot border built-in user/assistant messages, so the input box plus tool/chrome blocks is the honest maximum inside pi.

---

## D-0016 — Text hierarchy: bright output, bold input, dim thinking

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Terminal cells have a fixed size, so per-block font scaling is impossible. Approximate the requested hierarchy instead: assistant text and tool output use brighter theme tokens (`#e8ecf8` / `#d6dcf0`), user-message text is bright, thinking text and thinking-level borders are dimmed (`#6b7394` and a muted ramp), and `BoxedEditor` bolds its content lines. Thinking keeps the same cell size.

**Alternatives:** terminal zoom (global, affects everything); hiding thinking blocks; a custom client with per-region fonts (rejected with the split).

**Rationale:** Keeps the grid and the existing box/chrome while making output and input visually dominant. Dim thinking resolves the "which is which" problem without changing content or stored messages.

**Update (2026-10-22):** thinking now starts collapsed (`hideThinkingBlock: true`) with the label "Thinking… click to show"; clicking the label (or the block) expands the full thinking, and `ctrl+t` toggles all thinking blocks. pi 1.2 renders the collapsed thinking state as a one-line label, not a content preview, so a "last 4 lines" collapsed view is not possible without patching. A markdown transformer could always show the last 4 lines, but that would remove the full view.

---

## D-0017 — Compact custom-tool rows

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Custom tool rows are compact by default. The call line is the tool/agent (no raw JSON args); the collapsed subagent result shows a status, the **last streamed text item**, and a click hint. Expanding (click / ctrl+o) reveals the task, child tool calls, full output, and usage. Tools without a custom call renderer get a generic name-only call; their argument JSON appears only when expanded. The governance resolver preserves existing renderers for non-boxed tools instead of returning `undefined`.

**Alternatives:** raw JSON arguments and child tool-call lines in the collapsed row (the noisy default); hiding tool rows entirely; custom per-tool UIs.

**Rationale:** The user wants the call and streaming results, with details on demand. Passing existing renderers through the resolver also fixed the regression where returning `undefined` dropped the subagent/questionnaire renderers.

---

## D-0018 — Footer separators and a dark-violet input

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** The footer is a full-width top rule, one content line, and a full-width bottom rule — no rounded border. The line shows the session title (fallback `session`), context %, and `↑input ↓output` on the left; `⎇ branch` and `$cost` on the right. Mode and model stay out. The blocky input box uses flat top/bottom separator rules (no rounded border) and its content rows are painted with `theme.bg("userMessageBg")`; the theme's `userMessageBg` is `#1e202e` (the official Tokyo Night line highlight).

**Alternatives:** the rounded session card (built first, rejected by the user); a flat line without separators; hardcoding a one-off violet color instead of a theme token.

**Rationale:** Top/bottom rules separate the footer without boxing it. Reusing `userMessageBg` for the input keeps the color in the theme and identical to the user's transcript messages.

---

## D-0019 — Model lives only in the title bar

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Remove the model id from the blocky input box's top-right header. The governance title bar remains the only place the model is shown; the input header keeps the `message` label/spinner, and the footer stays session/tokens/branch/cost only.

**Alternatives:** keep the model in the input box and drop it from the title bar; show it in both.

**Rationale:** The model was repeated in the title bar and input box. The title bar is persistent and also carries the project and mode, so it is the natural home.

---

## D-0020 — Flat input panel instead of a rounded box

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** The blocky input is a flat panel: a full-width top separator rule with the `message` label/spinner, full-width content rows painted with `userMessageBg` (dark violet, shared with user messages) and bold, and a full-width bottom rule with the key hints. No corners, no side borders. The rounded `box.ts` helper and its test were removed; `separator.ts` / `separator.test.ts` provide the flat width-safe rule.

**Alternatives:** the rounded box (rejected); a square-cornered box (still a box); the plain default editor.

**Rationale:** The user rejected rounded borders across the chrome. Flat rules around a violet content block match the title bar and footer and keep the editor readable.

---

## D-0021 — Session title and context live in the footer

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** The footer's left side shows the session title (`sessionManager.getSessionName()`, fallback `session`), context %, and token totals; the right side shows branch and cost. Context usage is removed from the input panel's bottom rule, which now carries only the key hints. Long titles are truncated with an ellipsis.

**Alternatives:** keep context in the input panel; use the project name as the footer title; show the session id.

**Rationale:** The footer is the session-level surface; context and session identity belong there, while the input panel is only about composing the prompt. `/name` sets the title.

---

## D-0022 — Input and user messages share the violet panel

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** The blocky input content rows and the transcript's user-message panel both use the theme's `userMessageBg`, set to `#1e202e` (the official Tokyo Night line highlight). User messages keep their violet left rail and bright text. Hook-injected custom messages keep `customMessageBg`.

**Alternatives:** keep two tokens with the same value; change only `userMessageBg` and leave the input on `customMessageBg`.

**Rationale:** The input is where the user writes, and the transcript bubble is what they wrote; one token keeps them visually identical and tunable in one place.

---

## D-0023 — Retheme to the official Tokyo Night palette

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Replace the hand-built approximation with the user-supplied Tokyo Night VS Code theme mapped onto pi's roles. Key values: text `#c0caf5`, muted `#9aa5ce`, dim `#51597d`, accent `#bb9af7`, border `#29355a`, borderAccent `#7aa2f7`, borderMuted `#363b54`, selectedBg `#202330`, userMessageBg/input `#1e202e`, customMessageBg/toolPendingBg/title bar `#16161e`. Syntax: comments `#51597d`, keywords `#bb9af7`, functions `#7aa2f7`, strings `#9ece6a`, numbers `#ff9e64`, types `#2ac3de`, operators `#89ddff`, punctuation `#9abdf5`. Markdown: heading `#89ddff`, link `#73daca`, inline `#bb9af7`, fenced code `#89ddff`. Tool success/error backgrounds are solid 30% blends of the official diff colors (`#41a6b5`, `#db4b4b`) over `#1a1b26`: `#264551` and `#542931`. The custom `#241b3a` violet is retired.

**Alternatives:** keep the approximation; use `#1a1b26` for user/input (less contrast); keep the custom violet panel.

**Rationale:** The official palette is cohesive and the user supplied it. `#1e202e` is the closest official dark panel to the previous violet; the title bar moves to the official `#16161e`.

---

## D-0024 — Background subagent jobs

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Add `background: true` to the `subagent` tool for single-agent jobs. The tool returns immediately; a persistent `aboveEditor` widget shows running and queued jobs with elapsed time and the last streamed line; one job per agent name runs at a time and extra jobs for the same agent queue. On completion the extension posts a `subagent-result` custom message and calls `sendMessage(..., { triggerTurn: true })`, so the main agent summarizes automatically. `/jobs` lists and cancels; `session_shutdown` aborts every child. Parallel and chain modes stay foreground-only.

**Alternatives:** a fully detached process with no result injection; tmux panes; blocking like the existing tool.

**Rationale:** Reuses `runSingleAgent` and the existing governance scope, gives the user a live chat while work runs, and keeps the safety property that only one write-capable worker edits at a time.

---

## D-0025 — `~/.pi` is the private config repo

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Keep portable pi config in a git repo rooted at `~/.pi`: `agent/AGENTS.md`, extensions, agents, prompts, themes, `settings.json`, `setup/`, and `.gitignore`. Ignore and untrack `agent/auth.json`, `agent/sessions/`, `agent/models-store.json`, `agent/permissions.json`, `agent/state/`, `agent/logs/`, and `.pi/permissions.local.json`. The initial single commit was amended to purge the committed auth token and the old objects were pruned; no remote existed. Auth is recreated per machine with `pi login`; sessions stay local.

**Alternatives:** sync the whole `~/.pi` (leaks credentials/transcripts); a config repo elsewhere with `PI_CODING_AGENT_DIR` (more setup); no version control.

**Rationale:** The config is portable; secrets and runtime are not. A private remote plus per-machine login gives multi-machine sync without leaking tokens or conversations.

---

## D-0026 — `~` expansion in write allowlists

- **Date:** 2026-10-22
- **Status:** accepted

**Decision:** Write allowlist rules accept a leading `~` and expand it to the current user's home directory. Global folder/file approvals under `$HOME` are stored home-relative (for example `~/.pi/`), so a permissions file can be moved between machines with the same layout. `agent/permissions.json` remains machine-local and gitignored.

**Alternatives:** store absolute home paths (machine-specific); ignore permissions and recreate every rule by hand.

**Rationale:** Keeps the config portable without making the global allowlist part of the shared repo by default.

---

## D-0027 — Throughput is generation-only rate, shown live in the footer

- **Date:** 2026-10-27
- **Status:** accepted

**Decision:** Show `⚡<rate> tok/s · <ttft>s ttft` in the governance footer's left group (after `↑in ↓out`). The rate excludes time-to-first-token: output tokens ÷ (first delta → last delta), so slow starts and slow generation stay distinguishable. While streaming it renders in accent; when idle the last completed call's numbers stay visible in muted color. Missing mid-stream `usage.output` falls back to a character-based estimate rendered with a `~` prefix. In-memory only: nothing is persisted to session entries.

**Alternatives:** effective rate (output ÷ full `durationMs`, TTFT included) — cheaper but conflates start latency with generation speed; a `/tps` history command — deferred; no live display, retrospective analysis only — rejected as the requested behavior.

**Rationale:** The two numbers answer different questions (provider speed vs. queue/TTFT), the footer is the only always-visible surface, and the fallback keeps the display honest on providers that report usage only in the final chunk.

---

## D-0028 — Throughput covers every generated token; the footer stays per-call

- **Date:** 2026-10-27
- **Status:** accepted

**Decision:** The `⚡ tok/s` number counts everything the model emitted in one call — visible text, thinking/reasoning, and tool-call argument JSON — because that is exactly what `usage.output` reports (`reasoning` is a subset of `output`, per pi's message types). Tool *results* are prompt-side and land in `usage.input`; nested model work performed by a tool (subagents, classifiers) carries its own `usage` on the tool-result message and is excluded. Display stays per assistant message: live = the streaming message, idle = the last completed message, even when a tool-heavy turn ends on a small tool-call message.

**Alternatives:** exclude `reasoning` from the numerator (higher, spikier, and no longer matches `usage.output`); aggregate a whole user turn into one number (hides per-call variance, needs turn state in the tracker); show the last text-bearing message instead of the last message (mismatch between live and idle semantics).

**Rationale:** Parity with `usage.output` means the live estimate, the final number, and any later session analysis all agree. Keeping per-call semantics is honest about what was measured, and the tool-call-stub case is a visible reminder of how much work the model did rather than a wrong number.

---

## D-0029 — Docs-only main-session writes; prompt-free reads; best-effort bash scope

- **Date:** 2026-10-27
- **Status:** accepted
- **Supersedes:** D-0009 (whole-project write trust), D-0013 (path-scoped bash trust)

**Decision:** The main session writes freely only inside `<project>/docs/`, `~/.pi/setup/`, `/tmp`, and `os.tmpdir()`; everything else inside the project and inside `~/.pi` outside `setup/` is hard-blocked with a "delegate to `worker`" message, with no passcode path. Project or `~/.pi` free-write roots are rejected when they are symlinks to somewhere else. Read-only bash may `cd` into the project, `~/.pi`, the pi installation directory, temp dirs, and configured `read` roots, and may redirect/`mkdir` inside free-write roots and non-recursively `rm` inside temp dirs. The auto-safe command list is a minimal read-only core (`cat head tail grep ls eza pwd wc diff stat du df tree which whereis type printenv uname whoami id date ps jq`, `echo`/`printf` without a redirect, `rg`/`find`/`fd` with their exec flags blocked, a short `git` subcommand list, `npm list/view/audit`, `--version` probes); every command that can write or execute with one flag or positional argument (`sed`, `awk`, `sort`, `uniq`, `curl`, `wget`, `less`, `file`, …) prompts. Subagent bash scope honours `allowPaths`, audits quoted paths, `cd --`, relative paths, `--opt=value`, attached short-flag values, and interpreter code-exec flags, and fails closed on unanalysable quoting. Subagents do not receive the plan-first text and run with plan mode off.

**Alternatives:** keep D-0009's whole-project trust and rely on convention (the original setup had the docs-only rule only in prose, which the gate silently contradicted); keep patching individual `sed`/`awk` script forms (five review rounds each found another one-flag or one-token write: `sed -n -i`, `s///e`, `1W`, `-f`, `$'…'`, letter delimiters, `uniq in out`, `git log --output`, `curl -D`, `less -o`, `tree -oout`, quoted flags, `python3.12 -c`); treat bash as a security boundary and sandbox it.

**Rationale:** The main session's output is plans, decisions, and notes; everything else is a build change and belongs in a reviewable subagent diff. Making docs frictionless while blocking source mechanically matches the working agreement and removes the contradiction that let source edits through silently. Automating writes to `/tmp` and reads anywhere keeps exploration prompt-free. The shell classifier is best-effort by nature — every additional auto-allowed command is a new write primitive — so the safe list stays small, the writes that remain are bound to free-write roots, and the precise boundary is the `edit`/`write` tool plus one user-approved, project-scoped subagent launch.

**Consequence:** an emergency edit to `~/.pi/agent` from the main session now requires a `worker` launch. `sed`/`awk` one-liners and every command with an output flag prompt by default; allowlist the exact form if it becomes routine. Interpreters are allowed in subagents only with read-only flags and a script path inside the scope; stdin payloads and unlisted executors are explicitly out of scope.

---

## D-0030 — Colleague loop; plan mode removed; gate only prompts outside scope or for irreversible operations

- **Date:** 2026-10-27
- **Status:** accepted
- **Supersedes:** D-0029 (docs-only main-session writes; build by delegation)

**Decision:** Remove plan mode entirely — no plan-first context injection, no `plan` flag, no `/plan` command, no `⏸ plan` / `▶ governed` badge, no persisted `governance-mode` entry — and replace the build gate with a permission gate that only prompts where the answer carries information. Main-session writes/edits are free inside the project (`ctx.cwd`) and inside the pi config root (`~/.pi`), source and config included; anything outside both prompts and can be remembered in the project or global allowlist. Bash runs prompt-free when it is on the read-only safe list or when `bashScopeEscape` proves every path stays inside the project, `~/.pi`, the pi install, temp dirs, or configured `read` roots; network tools (`curl`, `wget`, `ssh`, …) and anything reaching elsewhere prompt. The confirmation loop moves into `agent/AGENTS.md`: restate goal/files/verification/first slice before any task, write a plan file for every non-trivial task, work in small tested pieces, one commit per tested piece. The main session edits and runs things itself; subagents are for jobs that deserve an isolated context, launched once with user approval (scope facts unchanged: `PI_SUBAGENT_ROOT` + `allowPaths`, no prompting, no nested subagents). An always-prompt list replaces the "never-allow" list and now covers destructive in-project actions: `sudo`, force push (including `--force-with-lease`), `git reset --hard`, `git clean -fd`/`-fdx`, `git checkout .`/`git checkout -- .`, `git restore` (any form), `git branch -D`, `git filter-branch`/`git filter-repo`, package publish, pipe-to-shell, `dd if=`, disk formatting, system power commands (halt, poweroff, reboot, shutdown), and `rm -rf` anywhere, the project included (plain `rm -r` is never auto-allowed either; it asks). Entries are never allowlistable and only a one-time passcode from `/i-understand-the-danger` authorizes a single run.

**Alternatives:** keep plan mode as an optional read-only toggle (two behaviours to maintain for a rule set that `AGENTS.md` already loads every session); keep docs-only writes and delegate all source edits to `worker` (the measured friction: 3–6 prompts per small slice, which stalled the tested-piece loop); scope the gate to the project only and prompt for `~/.pi` edits (makes extension fixes and settings changes cost a prompt every time); leave `rm -rf` trusted inside the project (recursive removal destroys uncommitted work even under git); keep the static never-allow list without destructive git (`git restore`/`checkout .` are one keystroke from losing a day's work).

**Rationale:** The gate was built for a trust problem that no longer dominates, and plan mode's enforced write block was the part causing the friction; its injected rules duplicated `AGENTS.md`. Prompting on ordinary local work trains the user to approve reflexively, which is worse than not prompting. What remains is exactly the set where a human decision is valuable: crossing the project boundary and irreversible actions. Because the shell classifier is best-effort, the always-prompt list is now the whole safety net — too short is unrecoverable, so it errs long and `rm -rf` is never automatic.

**Consequence:** a normal edit → test → commit slice produces zero prompts; a write outside the project/`~/.pi` prompts once and can be remembered; the title bar shows project and model only; `/plan` and the mode badge are gone. Plan files are now carried by the working agreement, not enforced by the gate.
