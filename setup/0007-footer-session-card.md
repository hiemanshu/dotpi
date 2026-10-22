# 0007 — Footer separators + Tokyo Night input

- **Date:** 2026-10-22
- **Status:** done (manual TUI check pending)
- **Owner:** hiemanshu

## Goal

Replace the rounded footer card and input box with flat top/bottom separator rules. The footer shows the session title, context, and tokens; the input panel gets the official Tokyo Night line-highlight block (`#1e202e`) and no rounded border.

## Context

- The title bar shows project + mode + model.
- The blocky input box no longer shows context or model; context moves to the footer, the model lives in the title bar.
- The footer used to repeat mode, context, and model, plus tokens/cost/branch.

## Decisions

1. **Top/bottom separations:** the footer is a full-width top rule, one content line, and a full-width bottom rule. No rounded corners or side borders.
2. **Unique data only:** session title (fallback `session`), context %, and `↑input ↓output` on the left; `⎇ branch` and `$cost` on the right. Mode and model stay out of the footer; the input bottom rule carries only the hints.
3. **Flat input:** top rule with the `message` label/spinner, full-width content rows (`userMessageBg` `#1e202e`, the official Tokyo Night line highlight, shared with user messages), bottom rule with the hints; no corners or side borders.
4. **Separator helper:** `separator.ts` is pure and tested; `box.ts` and its test were removed.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/extensions/governance/footer.ts` | top/bottom rules, session title + ctx + tokens |
| `~/.pi/agent/extensions/blocky/boxed-editor.ts` | flat panel, violet content |
| `~/.pi/agent/extensions/blocky/separator.ts` | flat width-safe rule helper |
| `~/.pi/agent/extensions/blocky/separator.test.ts` | width/label tests |
| `~/.pi/agent/themes/opencode.json` | `userMessageBg` → `#1e202e` |
| `~/.pi/agent/extensions/governance/README.md` | chrome docs |
| `~/.pi/agent/extensions/blocky/README.md` | flat-panel docs |

## Test plan

- [x] `node --experimental-strip-types --check footer.ts` and `index.ts`.
- [x] `separator` tests pass; `box.ts`/`boxed-editor.test.ts` removed.
- [x] Fresh `pi -p` load with empty stderr.
- [ ] Manual: footer has top and bottom rules, session title + ctx + tokens left, branch/cost right.
- [ ] Manual: input panel has top/bottom rules, Tokyo Night line-highlight content, no rounded border.
- [ ] Manual: `/footer` restores pi's default footer; `/blocky` restores the default editor.

## Risks

- The input panel's bottom rule plus the footer's top rule is a deliberate double separation; remove one if it feels heavy.
- The content block uses `userMessageBg` (`#1e202e`), shared with user messages; hook-injected custom messages use `customMessageBg` (`#16161e`).
- The autocomplete list below the input stays on the terminal background.
- Long session titles are truncated with an ellipsis; `/name` sets the title.
- The footer is three rows tall.
