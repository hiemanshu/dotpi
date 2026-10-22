# 0002 — Split TUI: chat left, code right

- **Date:** 2026-10-16
- **Status:** rejected — tmux split removed at the user's request; native restyle in plan 0003 / D-0011.
- **Owner:** hiemanshu

## Goal

A VS Code/opencode-flavored split view: pi runs in the left pane, and the code region just edited appears in the right pane with a few lines of context, updating on every `edit`/`write`.

## Context

- pi 1.2's extension API has no persistent side-by-side layout; `setWidget` is full-width and `ctx.ui.custom()` is a temporary overlay. A true split needs tmux.
- `tmux 3.8` and `bat 0.26.1` are installed.
- User choices: implement the tmux version to judge; show the edited region with a couple of lines above/below; update on every edit/write.
- Setup work lives in `~/.pi`; this plan is independent of any project directory.

## Decisions

1. **tmux split**, left 55% pi / right 45% preview. Pane borders with `pi` and `code` titles, subtle colors.
2. **Preview trigger:** `tool_result` for `edit` and `write` only (not reads). Done in an extension so subagent edits also update the pane.
3. **Content:** the changed region(s) plus 3 lines of context. For `edit`, parse the tool's unified patch (`@@ +start,count @@`). For `write`, show the file from line 1, capped by the pane height.
4. **Rendering:** `bat --style=numbers,grid --theme=ansi` so colors follow the terminal theme; custom dim header with relative path and line range; 2-space padding and a blank line; clear-and-redraw only when the state file changes.
5. **State:** `~/.pi/agent/state/preview.json`, atomically replaced. Holds absolute path, cwd, ranges, total lines, tool, timestamp.
6. **Launcher:** `~/.pi/bin/pi-split`. Outside tmux it creates/attaches a session; inside tmux it splits the current window and `exec`s pi. No project changes.
7. **Padding:** set `editorPaddingX: 1` in pi settings; the preview adds its own padding.

## Non-goals

- File tree, tabs, mouse interaction, inline diff toggle (possible follow-ups).
- Editing from the preview pane.
- A custom pi client/SDK rewrite.

## Files

| File | Purpose |
|---|---|
| `~/.pi/agent/extensions/preview/ranges.ts` | patch parsing, range merge/expand, needle fallback |
| `~/.pi/agent/extensions/preview/index.ts` | `tool_result` hook → writes preview state |
| `~/.pi/agent/extensions/preview/ranges.test.ts` | unit tests for range logic |
| `~/.pi/agent/extensions/preview/README.md` | usage + how it works |
| `~/.pi/bin/preview-watch.py` | polls state, renders with bat, `--once` for tests |
| `~/.pi/bin/pi-split` | tmux launcher |
| `~/.pi/agent/settings.json` | `editorPaddingX: 1` |

## Test plan

- [x] `node --experimental-strip-types ranges.test.ts` — patch hunks, deletions, merges, needles.
- [x] `python3 -m py_compile preview-watch.py`; `bash -n pi-split`.
- [x] `PREVIEW_STATE=... python3 preview-watch.py --once` renders a sample file range with bat.
- [x] Fresh `pi -p` loads the preview extension and captures a real `write` into the state file.
- [ ] Manual: run `pi-split`, make an edit, confirm the right pane shows ±3 lines and updates on the next edit.
- [ ] Manual: subagent `worker` edit updates the same pane.

## Verification (2026-10-16)

- Range tests pass (patch hunks, count-0 deletion, merging, needle fallback).
- Watcher `--once` rendered a real Lua file: dim header, 2-space padding, bat line numbers, ±3 context.
- Nested `pi -p` run wrote `state/preview-smoke.txt`; `state/preview.json` recorded `ranges: [[1,3]]`, `totalLines: 3`; the watcher rendered it. Smoke fixture removed afterwards.
- Extension loads in both main and subagent processes (no stderr errors).
- tmux launcher syntax-checked; visual check left to the user.

## Risks

- tmux-only; direct `pi` won't show the split.
- `bat` must be installed (it is); fallback message if missing.
- `edit` patches are parsed heuristically; if no hunks are found, falls back to `firstChangedLine` / `newText` search.
- State file is global: two simultaneous sessions will show the latest edit. Acceptable for now.
- Very large writes are capped to the pane height.

## Open questions

- Diff toggle in the preview pane (tmux key binding) — later.
- Per-session state instead of global — later.
- Should `read` also update the preview when nothing has been edited yet? Currently no.
