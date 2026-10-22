# 0003 — opencode-style restyle of pi's TUI

- **Date:** 2026-10-16
- **Status:** done (manual TUI check pending)
- **Owner:** hiemanshu

## Goal

Drop the tmux split (rejected in plan 0002) and make pi's own TUI wear the opencode/VS Code-inspired look: near-black panels, violet/cyan accents, soft borders, a slim title bar, a status-bar footer, and more padding.

## Context

- The user rejected the tmux split but liked the aesthetic.
- pi's extension API has no persistent side-by-side layout, so the aesthetic is applied natively: theme + header + footer + padding.
- `setHeader`/`setFooter` replace the built-in chrome; both are TUI-only and can be toggled.

## Decisions

1. **Remove the split entirely:** `pi-split`, `preview-watch.py`, the `preview` extension, and its state are deleted. Plan 0002 is marked rejected.
2. **Theme:** `~/.pi/agent/themes/opencode.json`, a fixed dark theme (Tokyo-night-ish) — near-black panels, `#bb9af7` violet accent, `#7dcfff` cyan links, soft gray borders. `theme: "opencode"`.
3. **Title bar:** replaces the built-in header. Full-width dark bar: `π  <project>` left, `<mode>  ·  <model>` right, dim rule underneath. `/header` restores the built-in header.
4. **Status bar:** the existing governance footer gets a dim rule, `│` separators, and 2-space margins. `/footer` toggles it.
5. **Spacing:** `editorPaddingX: 2`, `outputPad: 1`.
6. No new tool/message renderers in this pass; the theme's panels do the heavy lifting.

## Non-goals

- Persistent split view or preview pane.
- Custom tool renderers with boxes/line numbers (possible follow-up).
- Light-mode variant; this is a fixed dark theme.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/themes/opencode.json` | new theme |
| `~/.pi/agent/settings.json` | theme, padding |
| `~/.pi/agent/extensions/governance/footer.ts` | title bar + restyled footer |
| `~/.pi/agent/extensions/governance/index.ts` | install header, `/header` toggle |
| `~/.pi/agent/extensions/governance/README.md` | document the chrome |
| removed: `extensions/preview/`, `bin/pi-split`, `bin/preview-watch.py`, state dirs |

## Test plan

- [x] `jq .` on the theme file (valid JSON, complete color set copied from dark.json).
- [x] `node --experimental-strip-types --check` on the extension files.
- [x] Fresh `pi -p` loads with no theme/extension errors.
- [ ] Manual TUI: title bar at startup, status bar at the bottom, padding visible.
- [ ] `/header` restores the built-in header; `/header` again restores the title bar.
- [ ] `/footer` still toggles the status bar.
- [ ] Plan mode toggle updates the mode text in both header and footer.

## Verification (2026-10-16)

- Theme JSON valid; 53 classifier tests pass; both extension files syntax-check.
- Fresh `pi -p` run exits 0 with empty stderr.
- tmux/preview artifacts removed (`extensions/preview`, `bin/pi-split`, `bin/preview-watch.py`, state dirs). Remaining extensions: governance, questionnaire, subagent.
- Visual TUI check left to the user after `/reload`.

## Risks

- Fixed dark palette on a light terminal will look wrong; `system` remains available.
- Replacing the header hides pi's built-in keybinding hints; `/hotkeys` still works.
- Header/footer are TUI-only, so print/json modes are unchanged.
- The header title bar uses the theme's `selectedBg`; if that token changes, the bar changes with it.

## Open questions

- Add a light/open variant? Not unless requested.
- Custom edit/write panels with borders and line numbers? Candidate for 0004.
