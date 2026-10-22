# 0004 — Blocky tool boxes + user-message rail

- **Date:** 2026-10-16
- **Status:** done (manual visual check pending)
- **Owner:** hiemanshu

## Goal

Make tool/edit blocks read like the editor's text box, and give the user's own messages a left border like opencode so they are distinguishable from assistant messages.

## Context

- The built-in `edit` tool sets `renderShell: "self"`, which opts out of the default boxed shell; every other built-in uses the box.
- Built-in user messages have no per-role renderer, but `registerMarkdownTransformer` runs with `messageType: "user"` and affects **rendering only**.
- The theme controls box borders (`border`, `borderMuted`) and the Markdown quote rail (`mdQuoteBorder`).

## Decisions

1. **Box the edit tool:** register a tool renderer resolver that returns the existing edit renderers with `renderShell: "default"`. No execution change.
2. **User rail:** a Markdown transformer prefixes each user-message line with `> ` when `messageType === "user"`. This renders a Markdown blockquote, whose left rail uses `mdQuoteBorder`. It changes rendering only — the stored transcript and model context are untouched.
3. **Toggle:** `/user-rail` turns the transform on/off at runtime (existing messages re-render).
4. **Theme:** brighten `border`/`borderMuted` so boxes read, set `mdQuoteBorder` to the violet accent, and give `userMessageBg` a subtle violet tint.
5. **Uniform tool height:** a `registerToolRenderer` wrapper clips every built-in result to 4 content lines + a dim hint; expanding shows the full result. Clicking the box (or ctrl+o) toggles through pi's default shell. The wrapper keeps the built-in result component so streaming updates stay intact.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/extensions/governance/renderers.ts` | edit shell override, uniform tool-result wrapper, user rail transformer |
| `~/.pi/agent/extensions/governance/text.ts` | pure rail helper (tests) |
| `~/.pi/agent/extensions/governance/index.ts` | install renderers, `/user-rail` |
| `~/.pi/agent/themes/opencode.json` | brighter borders, violet rail, user-message tint |
| `~/.pi/agent/extensions/governance/README.md` | document the chrome |

## Test plan

- [x] `node --experimental-strip-types --check renderers.ts` and `index.ts`.
- [x] Unit-test the rail transform (multi-line, blank lines, empty, nested quote).
- [x] Fresh `pi -p` loads with no errors.
- [ ] Manual: edit block is boxed like other tools.
- [ ] Manual: user messages show a left rail; assistant messages do not.
- [ ] `/user-rail` toggles the rail without a reload.
- [ ] Manual: every collapsed tool box is the same height; click expands/collapses.

## Verification (2026-10-16)

- `railify` tests pass; theme JSON valid; extension syntax checks pass.
- Fresh `pi -p` exits 0 with empty stderr (renderer registration loads cleanly).
- Uniform wrapper + click hint added to every built-in tool result; blocky box suite (12 checks) passes.
- Renderer resolver now returns the existing renderers for non-boxed tools; this restores the subagent extension's streaming renderer, which had been dropped by returning `undefined`.
- Visual checks left to the user after `/reload`.

## Risks

- The user rail is a Markdown blockquote, so user-authored `>` quotes become nested; acceptable.
- Very large user messages get a per-line transform on each render; cheap but not free.
- The edit shell override depends on the renderer resolver API; if pi changes the renderers, `next()` still supplies them, so the override stays minimal.
