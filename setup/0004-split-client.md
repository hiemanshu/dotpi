# 0004 — pi-split: a custom split-screen client for pi

- **Date:** 2026-10-17
- **Status:** rejected — user rejected the two-panel split. The app was deleted; the pivot is a single-pane blocky style in plan 0005 / D-0015.
- **Owner:** hiemanshu

## Goal

A standalone TUI app that runs pi with a real side-by-side layout: **chat on the left, the code being edited on the right** — plus an opencode-style title bar and status bar. It must keep everything the normal pi TUI has: sessions, auth, model/tools, extensions, and the governance permission gate.

## Architecture: RPC client + pi-tui (not an in-process SDK session)

The app spawns a real `pi --mode rpc` process and renders its own UI with `@earendil-works/pi-tui`. Why not `createAgentSession()`:

| Concern | RPC child process | SDK in-process |
|---|---|---|
| Governance gate / extensions | Loaded exactly as usual; `select`/`confirm`/`input`/`editor` dialogs are forwarded over the [RPC extension UI protocol](../../opt/homebrew/Cellar/pi-coding-agent/1.2.0/libexec/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc-extension-ui.md) | Requires the host to supply a UI context; more integration surface |
| Sessions, auth, settings, skills | Identical to the normal CLI | Identical, but assembled by hand |
| Isolation | Child process crashes don't take down the UI | Same process |
| Reference | `examples/rpc-extension-ui.ts` (a working chat client) + exported `RpcClient` | `examples/sdk/*` |

`ctx.mode` is `"rpc"` in the child. Extension `setStatus`/`notify`/`setWidget` (string form) are forwarded; `setFooter`/`setHeader`/component widgets are no-ops — the client owns the chrome.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  π  <project>                          ⏸ plan · <model>      │  title bar
├───────────────────────────────┬──────────────────────────────┤
│  transcript (ScrollView)      │  code preview (ScrollView)   │
│  user / assistant markdown    │  path · lines X-Y of N       │
│  tool calls & results         │  syntax-highlighted region   │
│                               │  ±3 lines of context         │
├───────────────────────────────┴──────────────────────────────┤
│  ⏸ plan │ ctx 23% │ ↑1.2k ↓340 $0.01        ⎇ main │ model   │  status bar
├──────────────────────────────────────────────────────────────┤
│  > _                                                          │  editor / dialog
└──────────────────────────────────────────────────────────────┘
```

## Components

| Module | Responsibility |
|---|---|
| `src/main.ts` | entry point, arg passthrough, terminal + TUI host, layout |
| `src/agent.ts` | `RpcClient` lifecycle, event stream, command helpers (`prompt`, `steer`, `abort`, `get_state`, `get_messages`, `get_session_stats`) |
| `src/chat-view.ts` | transcript model: user/assistant/tool entries → pi-tui components (`Text`, `Markdown`, `ScrollView`) |
| `src/code-view.ts` | last edit/write → line ranges → highlighted snippet (patch parsing, ±3 context) |
| `src/dialogs.ts` | `extension_ui_request` handling: `select`/`confirm`/`input`/`editor`, plus `notify`/`setStatus`/`setWidget`/`set_editor_text` |
| `src/chrome.ts` | title bar, status bar, theme mapping from `~/.pi/agent/themes/opencode.json` |
| `bin/pi-split` | launcher: resolves the pi install, runs the app with the right module paths |
| `README.md` | usage, keys, architecture notes |

## Data flow

- **User input → pi:** `prompt` command; while streaming, Enter steers (`steer`) or queues (`follow_up`).
- **Assistant text:** `message_update`/`text_delta` → append to the active markdown buffer.
- **Tools:** `tool_execution_start` renders the call; `tool_execution_end` renders the result; `edit`/`write` also update the code pane.
- **Code pane ranges:** reuse the patch-hunk parser from the removed preview extension (`@@ +start,count @@`), falling back to `firstChangedLine` / searching `newText`; read the file, show range ±3.
- **Dialogs:** `extension_ui_request` → dock a dialog component in the editor area, respond with `extension_ui_response`.
- **History:** `get_messages` on startup (resumed sessions); `get_session_stats` for the status bar.
- **Chrome:** own title/status bars; governance's `setStatus("governance", …)` request renders in the status bar.

## Packaging and module resolution

- Location: `~/.pi/apps/pi-split/` (setup tooling, outside any repo).
- Node 24 can run TypeScript directly (`--experimental-strip-types`); no build step for v1.
- `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` live inside the pi install (`.../pi-coding-agent/node_modules/@earendil-works/`). The launcher resolves the pi package root from `which pi` and passes it, and the app imports via absolute file URLs (`pathToFileURL(join(piRoot, "dist/..."))`) so pi upgrades don't break it. A tiny `types.ts` locally documents the shapes; full type ownership can come later.
- `bin/pi-split` accepts pi args (`--model`, `--session`, `--continue`) and forwards them to the child.

## Stages

**Stage 0 — spike (de-risk first)**
RpcClient script: spawn `pi --mode rpc`, `get_state`, `get_messages`, send a prompt, and trigger a governance permission dialog (e.g. ask the child to run a non-readonly command) to prove `extension_ui_request` arrives and a response resolves it. Print events to stdout. *Acceptance: transcript streams, dialog round-trips.*

**Stage 0 result (2026-10-17):** verified with `spike/stage0.ts` — the child loaded extensions and sent `⏸ plan` via `setStatus`; `get_state` responded; a `prompt` streamed; the governance `select` dialog arrived over RPC and was answered with "Allow once"; `bash` ran; `agent_settled` fired; the child exited 0. Note: the exported `RpcClient` cannot answer extension UI dialogs, so pi-split uses its own JSONL client (`src/rpc.ts`).

**Stage 1 — TUI shell**
`ProcessTerminal` + `TuiAltScreen`, HStack split (~58/42), title/status bars, editor input, prompt/stream/abort wiring. *Acceptance: chat works in the left pane against a live pi child.*

**Stage 1 result (2026-10-17):** implemented by worker subagents, reviewed, fixed, and re-verified.
- `src/main.ts` — split layout, streaming Markdown, tool/notice lines, dialog dock, keys, `--probe`.
- `src/rpc.ts` — own JSONL client (the exported `RpcClient` can't answer extension UI dialogs), with spawn/error/close handling, stdout tail flush, bounded stderr, malformed-line diagnostics.
- `src/split.ts` — `createRatioSplit` with explicit per-frame `basis`; 57.5–58.3% chat measured at 80/100/120/160/200 cols (pi-tui's sequential `grow` allocator otherwise lands at ~79/21).
- `bin/launch.mjs` + `bin/pi-split` — resolve the installed pi package (`$PI_BIN`/`which pi`, Homebrew and npm layouts), refresh `node_modules` symlinks, run the app.
- Reviewer findings fixed: handled-prompt disposition, `/commands` routed through `prompt`, dialog cancellation for unknown methods, SIGTERM escalation, `set_editor_text` while a dialog owns the dock, launcher validation.
- Verified: syntax checks, `./bin/pi-split --probe --no-session` (prints `get_state`, exit 0), `node test/layout.test.ts` (55–60% assertion). Interactive TUI left for the user to judge.

**Stage 2 — transcript**
Message model + `Markdown` rendering + `ScrollView` with follow, tool call/result lines. *Acceptance: a multi-turn session renders correctly, including a resumed session from `get_messages`.*

**Stage 3 — code pane**
Patch parsing + file read + highlighted snippet with header and ±3 context; updates on edit/write. *Acceptance: editing a file shows the region; a second edit updates it.*

**Stage 4 — dialogs + status**
Full extension UI handling (select/confirm/input/editor/notify/setStatus/set_editor_text), permission prompts inside the split layout, status bar with governance mode + context/tokens/cost. *Acceptance: a governed write prompts and can be allowed/denied; the mode badge tracks `/plan`.*

**Stage 5 — polish**
Theme mapping, keybindings (ctrl+o expand? scroll keys), session naming, error surfaces, README. *Acceptance: a full day of real use.*

## Risks

- **Scope:** this is a real app (transcript rendering, input, scrolling, dialogs). Stages keep it shippable at each step.
- **pi-tui API drift** across pi upgrades; mitigated by resolving the installed package at runtime and keeping to documented exports.
- **Module resolution** from a standalone app into pi's bundled deps is the first thing Stage 0 proves.
- **Permissions:** the gate lives in the child process; if a dialog is not answered, the child blocks — expected. `custom()` isn't available in RPC mode, so no component overlays from extensions (we render our own).
- **Transcript fidelity:** matching pi's rich tool renderers is out of scope; v1 renders text/markdown/tool summaries.

## Open questions

- App name/command: `pi-split` ok? (was the removed tmux launcher's name)
- Editor: single-line `Input` for v1, or multi-line `Editor` from the start?
- Should the app also expose the right pane as a toggle (`ctrl+b`?) and a diff view later?
- Keep the normal pi TUI's new title/status bars as-is while the client exists (yes, they're independent).
