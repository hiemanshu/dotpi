# 0008 — Official Tokyo Night palette

- **Date:** 2026-10-22
- **Status:** done (manual visual check pending)
- **Owner:** hiemanshu

## Goal

Replace the approximated opencode palette with the official Tokyo Night VS Code theme the user supplied, mapped onto pi's theme roles. Keep the flat chrome, violet rail, and compact rows.

## Context

- The previous theme was a hand-built Tokyo Night approximation with custom panel values (`#241b3a`, `#12151c`, `#15251d`, …).
- The user supplied Enkia's Tokyo Night theme JSON and asked to retheme everything.
- pi theme roles are a fixed set; the mapping picks the closest semantic role from the VS Code theme.

## Decisions

1. **Foregrounds:** `text` `#c0caf5`, `muted` `#9aa5ce`, `dim` `#51597d`, `accent` `#bb9af7`, `success` `#9ece6a`, `error` `#f7768e`, `warning` `#e0af68`.
2. **Borders/selection:** `border` `#29355a`, `borderAccent` `#7aa2f7`, `borderMuted` `#363b54`, `selectedBg` `#202330`.
3. **Panels:** `userMessageBg` (also the input content) is the official editor line highlight `#1e202e`, replacing the custom `#241b3a`. `customMessageBg`/`toolPendingBg`/title bar use the panel `#16161e`. Tool success/error are solid 30% blends of the official diff tints (`#41a6b5`, `#db4b4b`) over `#1a1b26`: `#264551` and `#542931`.
4. **Title bar:** background `toolPendingBg` (`#16161e`, the official title/status bar background) instead of the custom blue selection color. Footer stats use `muted` for readability.
5. **Syntax:** comments `#51597d`, keywords `#bb9af7`, functions `#7aa2f7`, variables `#c0caf5`, strings `#9ece6a`, numbers `#ff9e64`, types `#2ac3de`, operators `#89ddff`, punctuation `#9abdf5`.
6. **Markdown:** heading `#89ddff`, link `#73daca`, inline code `#bb9af7`, fenced code `#89ddff`, list bullets `#9abdf5`; the user rail stays `mdQuoteBorder` `#bb9af7`.
7. **Thinking ramp:** official dim/blue/violet/red (`#363b54`, `#51597d`, `#6183bb`, `#7aa2f7`, `#bb9af7`, `#9d7cd8`, `#f7768e`); thinking text `#646e9c`.

## Non-goals

- Importing the VS Code theme file directly (pi's schema is role-based).
- A light variant.
- Rounded borders (still flat separators).

## Files

| File | Change |
|---|---|
| `~/.pi/agent/themes/opencode.json` | full palette rewrite |
| `~/.pi/agent/extensions/governance/footer.ts` | title bar panel token, footer stats `muted` |
| governance README, blocky README, plans 0005/0007, decisions | docs |

## Test plan

- [x] Theme JSON valid.
- [x] `node --experimental-strip-types --check footer.ts`; separator tests.
- [x] Fresh `pi -p` load with empty stderr.
- [ ] Manual: transcripts, input panel, title/status bars, tool boxes, diffs, markdown, and thinking all read as Tokyo Night.
- [ ] Manual: user messages and input share `#1e202e`; rail is `#bb9af7`.

## Risks

- The official palette has no saturated dark-violet panel; `#1e202e` is the closest official line highlight. The previous `#241b3a` is retired.
- Tool success/error backgrounds are derived blends, not literal VS Code tokens (those use alpha).
- The editor text itself is terminal default + bold; pi's custom editor has no per-text color.
