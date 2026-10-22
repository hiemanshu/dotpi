# 0006 — Compact custom-tool rows

- **Date:** 2026-10-22
- **Status:** done (manual subagent check pending)
- **Owner:** hiemanshu

## Goal

Custom tool rows (subagent, questionnaire, unknown extension tools) should show the tool call and streaming results, not raw JSON arguments or internal tool-call details. Details should appear only when the row is expanded.

## Context

- The subagent screenshot showed the default renderer dumping the full `{agent, task}` JSON. Two causes: the governance renderer resolver returned `undefined` for non-boxed tools (dropping the subagent's custom renderers), and the default renderer for tools without a call renderer prints the raw args.
- The subagent's collapsed result also rendered internal child tool calls, which the user does not want.
- pi's default tool shell already supports expand/collapse with click or `ctrl+o`.

## Decisions

1. **Preserve custom renderers:** the governance resolver returns the existing renderers for non-boxed tools instead of `undefined`.
2. **Generic compact call:** tools with no `renderCall` get a single `<tool name>` row; the argument JSON is shown only when expanded.
3. **Subagent call line:** collapsed shows only `subagent <agent> [scope]` (chain/parallel show the count); the task preview and step/task lists appear on expand.
4. **Subagent collapsed result:** a status line (`✓ done` / `⏳ running` / `✗ failed`), the **last streamed text item** (3-line preview), and `(click to expand)`. No child tool calls, usage stats, or totals.
5. **Expanded result:** task, child tool calls, full output, and usage stats; chain/parallel show every step/task.
6. **Questionnaire:** unchanged — its custom call already shows the count/labels, and its result shows the answers.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/extensions/subagent/index.ts` | compact call + collapsed result filtering |
| `~/.pi/agent/extensions/governance/renderers.ts` | preserve renderers; generic name-only call fallback |

## Test plan

- [x] `node --experimental-strip-types --check` on both files.
- [x] Fresh `pi -p` load with empty stderr.
- [ ] Manual: subagent row shows `subagent worker [user]`, then status + last streamed text.
- [ ] Manual: click/ctrl+o reveals the task, child tool calls, full output, usage.
- [ ] Manual: questionnaire call stays compact (count/labels) and answers render.
- [ ] Manual: an unknown custom tool shows only its name until expanded.

## Risks

- If the child emits no assistant text, the collapsed row shows `working…` / `(no streamed text)` with no tool-call activity. Expand to inspect.
- Chain/parallel collapsed rows still list each step/task header; they are compact but can grow with many tasks.
- The generic fallback only triggers for tools without a call renderer; a broken custom renderer still owns its row.
