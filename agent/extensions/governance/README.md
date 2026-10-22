# Governance extension

Plan-first mode with layered permissions, enforced with `tool_call` hooks.

## What it does

- Starts every session in plan mode (footer: `⏸ plan`).
- Auto-allows: read-only tools, allowlisted read-only bash, writes anywhere inside the current project, and bash commands whose absolute paths all live inside `~/.pi`. `~/.pi/` writes are allowed from any project via the global allowlist.
- Treats `cd` into the project directory and harmless stdout/stderr redirections (`2>&1`, `>/dev/null`) as safe.
- Prompts for every other `edit`/`write` and non-read-only `bash` command. Prompts offer:
  - allow once
  - remember the file/directory or command/pattern **in this project** (`.pi/permissions.local.json`)
  - remember the directory/pattern **everywhere** (`<agent-dir>/permissions.json`)
  - **type a custom rule** — opens a text input and accepts natural language:
    - `always allow git status everywhere` → global bash prefix rule `git status *`
    - `always allow this folder` → the folder being written to, project scope
    - `always allow ~/notes` → global write rule for that folder
    - `allow once` and `deny` also work
    - scope defaults to the project; `everywhere`, `global`, or `all projects` makes it global
  - deny
- Hard-blocks a never-allow list. The user can authorize one run by running `/i-understand-the-danger` (prints a one-time passcode, 2 min, single use) and typing it into the prompt.
- Scopes subagent processes to `PI_SUBAGENT_ROOT` + `PI_SUBAGENT_ALLOW_PATHS`. Out-of-scope reads and writes fail closed because subprocesses have no UI to prompt.

## Commands

| Command | Effect |
|---|---|
| `/plan` | Toggle plan-first instructions (gate stays active) |
| `/permissions` | Show project and global allowlists |
| `/footer` | Toggle the governance footer vs pi's default |
| `/header` | Toggle the opencode-style title bar vs pi's default |
| `/user-rail` | Toggle the left rail on user messages |
| `/i-understand-the-danger` | Print a one-time passcode for a hard-blocked command |

## Files

- `<project>/.pi/permissions.local.json` — per-project allowlist (gitignore this)
- `<agent-dir>/permissions.json` — global allowlist
- `utils.ts` — classification, scoping, allowlist matching (no pi imports; testable)
- `index.ts` — the extension

## Allowlist format

```json
{
  "write": ["src/server/", "~/.pi/", "package.json"],
  "bash": ["npm test", "git status *"]
}
```

- Write rules: exact file paths, or directories ending in `/`. Relative paths resolve from the project root. A leading `~` expands to the user's home directory; folder approvals saved as "everywhere" are stored home-relative when possible (for example `~/.pi/`).
- Bash rules: exact commands after whitespace normalization, or prefix rules ending in ` *`.
- Hard-blocked commands and `docs/` exemption cannot be configured here.

## TUI chrome

- **Title bar:** full-width dark bar (`π  <project>` left, `<mode> · <model>` right) with a dim rule underneath. `/header` restores the built-in header.
- **Footer:** full-width top/bottom separator rules with one content line: session title (fallback `session`), context %, and tokens on the left; branch and cost on the right. 🔑 appears while a passcode is live. No rounded border; mode and model are not repeated here. `/footer` restores pi's default footer.
- **Tool blocks:** all built-ins use pi's boxed shell. `edit` is forced back into it, and every result is clipped to a uniform collapsed height (4 content lines + a dim hint), expanding to the full result on click / ctrl+o.
- **Custom tools (subagent, questionnaire, unknown extensions):** the call row stays compact. Subagent collapsed rows show status + the last streamed text; expanding shows the task, child tool calls, full output, and usage. Tools without a call renderer show only the tool name; their argument JSON appears on expand.
- **Input:** the `blocky` extension's flat panel: top rule with the `message` label/spinner, dark-violet content rows (`userMessageBg`, shared with user messages), bottom rule with the key hints; no rounded border. Content is bold. `/blocky` restores the default editor.
- **User messages:** the same `userMessageBg` panel, a violet left rail, and bright text. The rail is a render-only Markdown blockquote; the stored transcript and model context are unchanged. `/user-rail` toggles it.
- **Thinking:** starts collapsed (`hideThinkingBlock: true`) with a "Thinking… click to show" label; click or `ctrl+t` expands the full block. The collapsed state is a one-line label, not a preview. Dim text and a muted thinking-border ramp; same cell size as everything else.
- **Theme:** `opencode` now carries the official Tokyo Night palette (editor `#1a1b26`, panels `#16161e`/`#1e202e`, blue `#7aa2f7`, violet `#bb9af7`, cyan `#89ddff`, green `#73daca`/`#9ece6a`) in `~/.pi/agent/themes/opencode.json`; brighter output/input, dim thinking; `editorPaddingX` is 2.
- **Working spinner:** warning-colored in plan mode, accent-colored in governed mode.
- **Consent prompts:** consistent `mode · action` header, the exact path/command on its own lines, and shorter allowlist options. Hard blocks use `⛔ HARD BLOCK · reason` with the passcode instruction inline.

## Known limits

- Bash scoping is best-effort: relative paths are checked via `cd` and absolute path arguments, but a determined command can still read outside the project. The read tools are enforced precisely.
- Compound commands (`&&`, `;`, `|`) can only be allowlisted exactly — prefix rules are offered only for single commands, so an approval cannot bless whatever is appended later.
- Classification is quote/escape-aware: a grep pattern containing `|` stays one command, and leading `FOO=bar` assignments are stripped. `sed -n` is safe; `sed -i` is not. `awk` is safe unless it calls `system(` or pipes.
- Safe commands with write/exec flags still prompt: `find -exec/-delete/-fprint`, `fd -x`, `sort -o`, `curl -o/-O/-T`, `git branch -d/-D`, `git remote add`, `npm audit fix`, `rg --pre`.
- Custom rules entered as free text are normalized to bash prefix rules (`<text> *`) unless they already end in `*`. Exact-match rules are still available from the menu.
- Regression tests: `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts` (53 cases).
- Hard-blocked commands cannot be authorized inside a subagent (no UI); the worker must report back.
- `--no-plan` (flag `plan: false`) forces plan mode off for one invocation.
