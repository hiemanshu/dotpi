# blocky — single-pane, flat pi UI

An opencode-inspired, **single-column** TUI skin for pi. It replaces the input
editor with a flat panel — full-width top/bottom separator rules and a
dark-violet content block — and moves the streaming spinner into the top rule.
No splits, no extra panels, no theme changes, no rounded borders.

```
─ ⠋ message ──────────────────────────────────────────
 hello, can you review this diff?
─ enter send · / commands · esc abort ─────────────────
```

## What it does

- Flat panel: full-width top and bottom separator rules; no corners or side
  borders.
- Top rule: `message` (with a spinner while the agent streams).
- Content: full-width rows with the theme's `userMessageBg` (Tokyo Night line
  highlight `#1e202e`, shared with user messages), bold for visual weight.
- Bottom rule: key hints (`enter send · / commands · esc abort`).
- Context usage is not shown here — it lives in the governance session bar,
  along with the session title.
- Hides the separate working row (`ctx.ui.setWorkingVisible(false)`) so the
  spinner only lives in the top rule.
- Multi-line input grows vertically; there are no blank spacer rows.
- Preserves the editor's cursor marker, so IME candidate positioning keeps
  working.
- Autocomplete (slash commands and files) renders below the bottom rule.
- Labels truncate at narrow widths; the chrome never overflows the terminal.

## Toggle

```
/blocky
```

Toggles the flat editor off/on. Turning it off restores pi's default editor
**and** the separate working row. State is per process; nothing is persisted.

## Scope and limits

- **TUI only.** The extension does nothing in print, JSON, or RPC modes, so
  subagents and `pi -p` are unaffected.
- Built-in user/assistant messages cannot be bordered by the extension API.
  Only the editor, tool shells, and chrome are customizable.
- Tool calls are **not** wrapped by this extension. pi already draws them
  inside its default background shell (`toolPendingBg` / `toolSuccessBg` /
  `toolErrorBg`), so this extension leaves them alone.
- Input content lines are bold (`\x1b[1m`) so the prompt carries more weight
  than output and thinking; terminal font size itself is fixed.
- The content rows use the theme's `userMessageBg` (`#1e202e`, shared with
  user messages); the separator rules and autocomplete keep the terminal
  background. Hook-injected custom messages use `customMessageBg` (`#16161e`).
- Keeps the existing title bar and footer from the governance extension; it
  does not install a theme, footer, or header of its own.
- Very narrow terminals (< 8 columns) fall back to the plain editor rather
  than drawing clipped chrome.
- The editor's `↑ N more` / `↓ N more` scroll counters are replaced by the
  separator chrome. The input still scrolls; only the counter glyphs are gone.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Extension entry: install/uninstall editor, spinner state, `/blocky` |
| `boxed-editor.ts` | `CustomEditor` subclass that draws the flat panel |
| `separator.ts` | Pure `separatorLine()` width-safe flat rule helper |
| `separator.test.ts` | Width/label assertions for `separatorLine` |

## Tests

No build step, no dependencies (pi loads the extension through jiti). The
separator helper is pure TypeScript and can be checked directly with Node 24:

```sh
cd ~/.pi/agent/extensions/blocky
node --experimental-strip-types separator.test.ts
node --experimental-strip-types --check separator.ts
node --experimental-strip-types --check boxed-editor.ts
node --experimental-strip-types --check index.ts
```
