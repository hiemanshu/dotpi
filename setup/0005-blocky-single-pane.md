# 0005 — Single-pane blocky pi (opencode-inspired)

- **Date:** 2026-10-17
- **Status:** in-progress (implemented; manual TUI check pending)
- **Owner:** hiemanshu

## Goal

No split. Make the normal pi TUI feel closer to opencode's blocky single-column style: a rounded input box, rounded tool blocks, compact spacing, with the existing opencode theme and title/status bars.

## Context

- The tmux split (0002) and the RPC split client (0004) were both rejected by the user. The pi-split app was deleted.
- Extensions can style the **editor**, **tool calls/results**, and **chrome** (header/footer/widgets). Built-in user/assistant messages cannot be given borders; only background panels via the theme.
- The current TUI already has: the `opencode` dark theme, a title-bar widget above the editor, and a status-bar footer.

## Decisions

1. **Single column.** No side panels, no tmux.
2. **Boxed input (the main block):** a `CustomEditor` subclass that draws a rounded (`╭ ╮ ╰ ╯`) compact box around the input:
   - top: `╭─ message ───────────────────────╮` (the model stays in the title bar)
   - sides: `│ <editor lines, padded> │`
   - bottom: `╰─ enter send · / commands · esc abort ───── ctx NN% ╯`
   - The model id stays in the title bar; the input header no longer repeats it.
   - working spinner in the top-left while streaming; `setWorkingVisible(false)` so there is no separate working row.
   - width-safe with `truncateToWidth`/`visibleWidth`; preserve the editor's cursor marker for IME.
3. **Tool blocks:** the default `ToolExecutionComponent` already wraps calls/results in a background-filled box; no border glyphs. `governance/renderers.ts` clips every built-in result to a uniform collapsed height (4 content lines + a dim hint) and expands to the full result on click / ctrl+o, preserving the default shell and its mouse/image handling. Rounded borders were not added (double-box risk).
4. **Chrome:** keep the governance title bar and status bar as-is. No new theme.
5. **New extension** `~/.pi/agent/extensions/blocky/`, separate from `governance/`. `/blocky` toggles the custom editor back to the default as an escape hatch.
6. Compact density: no blank lines between the title bar, input box, and status bar.
7. **Bold input:** `BoxedEditor` bolds its content lines. Terminals have one font size per cell, so bold is the "larger input" approximation; thinking stays normal weight and is dimmed by the theme.

## Non-goals

- Border-boxed user/assistant messages (not supported by the extension API).
- Split panes, tmux, a custom client.
- Theme palette changes (the `opencode` theme stays).

## Files

| File | Purpose |
|---|---|
| `~/.pi/agent/extensions/blocky/index.ts` | extension entry: editor install, spinner state, `/blocky` |
| `~/.pi/agent/extensions/blocky/boxed-editor.ts` | `CustomEditor` subclass + pure `composeBox` helper |
| `~/.pi/agent/extensions/governance/renderers.ts` | uniform tool-result height + click hint (governance-owned) |
| `~/.pi/agent/extensions/blocky/boxed-editor.test.ts` | width/corner assertions for `composeBox` |
| `~/.pi/agent/extensions/blocky/README.md` | usage/limits |

## Test plan

- [x] Fresh `pi -p` load with empty stderr (extension is inert in non-TUI modes).
- [x] `composeBox` test: 12 checks pass (widths 40/80/120, corners, side borders, ANSI labels, cursor-marker zero width, tiny widths).
- [x] Lazy reinstall after `/reload` (`before_agent_start`), idempotent, `/blocky` toggle intent preserved.
- [ ] Manual TUI: input box renders, typing/cursor works, multi-line input grows inside the box, spinner appears while streaming, `/blocky` restores the default editor.
- [ ] Manual: tool calls remain correctly boxed (background, not double-bordered) with the theme.
- [ ] Subagent edits still use the normal pi UI (this extension is TUI-only; no effect in print/json/RPC).

## Result (2026-10-17)

- `extensions/blocky/{box.ts,boxed-editor.ts,index.ts,boxed-editor.test.ts,README.md}` implemented by a worker and a follow-up fix.
- Boxed editor: `CustomEditor` subclass, `super.render(width-4)`, sentinel replacement of the editor's own top/bottom border rows (confirmed `Editor.render` pushes border strings untouched), rounded compact box, spinner in the header, side borders on content rows, cursor marker preserved, autocomplete kept below the box.
- The model was removed from the box header; the title bar is the only place it appears.
- Input content lines are bolded; the theme's assistant text/tool output are brighter and thinking text/borders are dimmer (terminal font size is fixed — see D-0016).
- Thinking starts collapsed (`hideThinkingBlock: true`) with the "Thinking… click to show" label; pi's collapsed state is a label, not a last-N-lines preview.
- Tool-shell finding: default shell is a background box without border glyphs. Governance now normalizes collapsed height and adds a click/ctrl+o expand hint without adding border glyphs.
- Verification: 12 box tests, syntax checks, fresh non-TTY load (exit 0, stderr empty), lazy reinstall hook added for `/reload`.
- Manual TUI judgment pending; `/blocky` is the escape hatch.

## Risks

- `CustomEditor.render` internals: it may include its own border/padding rows; the subclass must account for that or the box will double up or clip.
- Cursor/IME positioning when adding side borders: the cursor marker must keep its column offset.
- Tool renderer wrapping can double-box or fight the default shell; verify before shipping.
- TUI-only; no automated visual test.

## Open questions

- If the default tool shell turns out not to be a box, do we wrap all tools or only the noisy ones? Start with all, revisit if it feels heavy.
- Resolved: the input header stays label-only. The title bar owns project/mode/model; the footer owns session stats.

## Update (2026-10-22)

- Rounded box replaced by a flat panel: top/bottom separator rules, full-width content rows on the official Tokyo Night line highlight `#1e202e`, no side borders. `box.ts`/`boxed-editor.test.ts` removed; `separator.ts`/`separator.test.ts` added.
- The model was moved out of the input header; context usage moved to the governance footer, which now also shows the session title.
- See D-0020 and D-0021.
