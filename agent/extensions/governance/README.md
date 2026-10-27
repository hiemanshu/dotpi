# Governance extension

Plan-first mode with layered permissions, enforced with `tool_call` hooks.

## What it does

- Starts every session in plan mode (footer: `⏸ plan`).
- Auto-allows: read-only tools, allowlisted read-only bash, writes inside `<project>/docs/`, `~/.pi/setup/`, `/tmp`, and `os.tmpdir()`, plus harmless stdout/stderr redirections (`2>&1`, `>/dev/null`) and `>`, `>>`, `n>` redirects whose target is inside a free-write root.
- Treats `cd` into those read roots as safe, and tracks the directory it reaches so later segments of the same chain (`&&`, `||`, `;`, `|`, newline) resolve relative paths against it. `mkdir [-p]` is safe when every path argument is inside a free-write root; non-recursive `rm` is safe only inside `/tmp` and `os.tmpdir()`. Recursive `rm` is never auto-allowed this way.
- Hard-blocks (no passcode path) source and config writes for the main session: anything inside the project outside `docs/`, and anything inside `~/.pi` outside `setup/`. The block reason points at the `worker` subagent.
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
- Scopes subagent processes to `PI_SUBAGENT_ROOT` + `PI_SUBAGENT_ALLOW_PATHS` for writes, reads, and bash (`cd` / absolute path checks). Out-of-scope reads and writes fail closed because subprocesses have no UI to prompt.
- Hard-blocks `powershell` and any tool the gate does not know, in **both** the main session and subagent processes. `powershell` gets a message pointing at `bash`; unknown tools fail closed because there is no policy for them.

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
- `throughput.ts` — live tok/s + TTFT tracker and formatters (pure, injectable clock)
- `index.ts` — the extension

## Allowlist format

```json
{
  "write": ["src/server/", "~/.pi/", "package.json"],
  "bash": ["npm test", "git status *"],
  "read": ["~/other-repo/"]
}
```

- Write rules: exact file paths, or directories ending in `/`. Relative paths resolve from the project root. A leading `~` expands to the user's home directory; folder approvals saved as "everywhere" are stored home-relative when possible (for example `~/.pi/`).
- Read rules: extra directory roots that read-only bash may `cd` into. They extend `cd` trust only; no command is auto-approved just because its absolute paths sit under a read root. Same path forms as write rules; entries are always treated as roots (trailing `/` is conventional). Read rules never grant writes.
- Bash rules: exact commands after whitespace normalization, or prefix rules ending in ` *`.
- Hard-blocked commands cannot be configured here. The main-session free-write roots (`docs/`, `~/.pi/setup/`, temp dirs) are fixed in `utils.ts` (`freeWriteRoots`), not configurable in these files. `write` rules only affect the prompt path for writes outside those roots, so an existing `~/.pi/` entry is inert for the main gate.

## TUI chrome

- **Title bar:** full-width dark bar (`π  <project>` left, `<mode> · <model>` right) with a dim rule underneath. `/header` restores the built-in header.
- **Footer:** full-width top/bottom separator rules with one content line: session title (fallback `session`), context %, tokens, and live throughput (`⚡142 tok/s · 0.9s ttft`) on the left; branch and cost on the right. The rate excludes time-to-first-token; while a reply streams the segment is accent-colored, when it ends the last completed call's numbers stay visible in muted color, and a rate estimated from streamed characters (providers that report usage only at the end) is prefixed `~`. `ttft` is dropped when no delta was seen, and the whole segment is hidden before the first measured call. 🔑 appears while a passcode is live. No rounded border; mode and model are not repeated here. `/footer` restores pi's default footer.
- **Tool blocks:** all built-ins use pi's boxed shell. `edit` is forced back into it, and every result is clipped to a uniform collapsed height (4 content lines + a dim hint), expanding to the full result on click / ctrl+o.
- **Custom tools (subagent, questionnaire, unknown extensions):** the call row stays compact. Subagent collapsed rows show status + the last streamed text; expanding shows the task, child tool calls, full output, and usage. Tools without a call renderer show only the tool name; their argument JSON appears on expand.
- **Input:** the `blocky` extension's flat panel: top rule with the `message` label/spinner, dark-violet content rows (`userMessageBg`, shared with user messages), bottom rule with the key hints; no rounded border. Content is bold. `/blocky` restores the default editor.
- **User messages:** the same `userMessageBg` panel, a violet left rail, and bright text. The rail is a render-only Markdown blockquote; the stored transcript and model context are unchanged. `/user-rail` toggles it.
- **Thinking:** starts collapsed (`hideThinkingBlock: true`) with a "Thinking… click to show" label; click or `ctrl+t` expands the full block. The collapsed state is a one-line label, not a preview. Dim text and a muted thinking-border ramp; same cell size as everything else.
- **Theme:** `opencode` now carries the official Tokyo Night palette (editor `#1a1b26`, panels `#16161e`/`#1e202e`, blue `#7aa2f7`, violet `#bb9af7`, cyan `#89ddff`, green `#73daca`/`#9ece6a`) in `~/.pi/agent/themes/opencode.json`; brighter output/input, dim thinking; `editorPaddingX` is 2.
- **Working spinner:** warning-colored in plan mode, accent-colored in governed mode.
- **Consent prompts:** consistent `mode · action` header, the exact path/command on its own lines, and shorter allowlist options. Hard blocks use `⛔ HARD BLOCK · reason` with the passcode instruction inline.

## Known limits

- Bash scoping is best-effort, not a security boundary: relative paths are checked via `cd` and absolute path words (quoted ones included), but a determined command can still read or write outside the project. The precise enforcement is the `edit`/`write` gate and the `read` tools. The scope check fails closed on words it cannot vouch for: any unanalysable quoting or expansion (`$'…'`, `$"…"`, a backslash outside single quotes, `$(…)`, `${…}`, backticks), an interpreter one-liner (`bash -c`, `node -e`, `node -p`, `perl -E`, `php -R`, …), a `$`-expanded word, a command word that is a path (`/tmp/x.sh`, `../x.sh`), `--opt=value` values, path-like attached short-flag tails (`git -C..`, `sort -o/tmp/x`), and bare `.`/`..`.
- The interpreter control is a **name + flag allowlist**, not a payload audit. When a known interpreter name appears in a subagent command — including versioned/real names such as `python3.12`, `nodejs18`, `perl5.36`, `lua5.4`, `tclsh`, `Rscript`, `tsx`, `ts-node`, plus the shells, `osascript`, `bun`, `deno`, and `npx` — its flags must be one of `--version`, `-v`, `--help`, `-h`, `--experimental-strip-types`, `--check`, `--no-warnings`, `--enable-source-maps`; every other flag (short or long, `--opt=value` included) is an escape, and a non-flag word after it is audited as a script path inside the roots. `npx …` is always an escape, as are `deno eval`, `bun eval`, `bun x`, and an interpreter with no following script word (a stdin payload such as `echo x | bash`). This is best-effort: **stdin payloads, executors not on the name list, and absolute paths embedded inside payload strings are not audited.** A new binary or an allowlist entry is the way around it.
- Bash classification is also best-effort in the main session: `&` splits like `;` (except `&&`, `&>`, and `2>&1`), but obfuscated commands (variables, `eval`, interpreter one-liners) are not fully analysed. Treat a prompt-free command as convenience, not a guarantee. Quoting the classifier cannot analyse always prompts: `$'…'`, `$"…"`, a backslash outside single quotes (so `grep -n "a\|b"` prompts while `grep -n 'a\|b'` stays safe), `$(…)`, `${…}`, and backticks.
- Redirect stripping covers only plain `>`, `>>`, and `n>` with literal (optionally quoted) targets inside a free-write root. Targets containing whitespace or glob characters (`*?[{`), `$VAR`, command substitution, `<`, `&>`, and `>&` fall through to `unanalysableShell` and prompt. Relative targets resolve against the directory reached so far in the chain (after any safe `cd`).
- A free-write root is only trusted when it is a real child directory: if `<project>/docs` or `<piRoot>/setup` is a symlink pointing elsewhere, that root is dropped and writes fall back to the prompt (`/tmp` and `os.tmpdir()` are exempt because `/tmp` is a symlink on macOS).
- Only `rm` without `-r`/`-R` is auto-allowed, and only inside `/tmp`/`os.tmpdir()`. Globs are rejected in `mkdir`/`rm` targets and redirect targets. Recursive removal always prompts (or hard-blocks when outside trusted roots). `cp`/`mv` into free-write roots still prompt; there is no generic absolute-path shortcut.
- Source/config writes in the main session are blocked with no passcode path; an emergency edit needs a `worker` launch. Subagent writes are scoped to `PI_SUBAGENT_ROOT` + `PI_SUBAGENT_ALLOW_PATHS`.
- Compound commands (`&&`, `&`, `;`, `|`, newlines) can only be allowlisted exactly — prefix rules are offered only for single commands, so an approval cannot bless whatever is appended later. Newlines are top-level separators, so a second line cannot hide behind a safe first one.
- Classification is quote/escape-aware: a grep pattern containing `|` stays one command, and leading `FOO=bar` assignments are stripped. `sed` and `awk` are not on the safe list at all because they can write or execute (`sed -i`, `w`/`r`/`e`, `s///e`, `awk system(`, `print > "file"`); use `head`/`tail`/`grep`/`jq`, or allowlist a specific form.
- The safe list is a minimal read-only core, and everything else prompts. Safe: `cat head tail grep ls eza pwd wc diff stat du df tree which whereis type printenv uname whoami id date ps jq`, `rg`/`find`/`fd`, the read-only `git` subcommands (`status log diff show branch --show-current remote -v config --get ls-files rev-parse describe blame shortlog stash list ls-*`), the read-only `npm` ones (`list ls view info search outdated audit`), and `node|python3|bun|deno --version`. A single flag turns most commands into a write or an exec, so those flags still block too: `sort -o`, `uniq in out`, `curl -D`, `less -o`, `git log --output`, `git branch -f`, `tree -o`, `find -exec/-delete/-fprint`, `fd -x`, `rg --pre`, `npm audit fix`, `git branch -d/-D`, `git remote add`.
- Removed from the safe list on purpose (`sort uniq echo printf curl wget less more top htop bat env free uptime cal file`, and `yarn`/`pnpm`): use the read-only forms above, or allowlist the exact command you want.
- Custom rules entered as free text are normalized to bash prefix rules (`<text> *`) unless they already end in `*`. Exact-match rules are still available from the menu.
- Regression tests: `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts` (366 cases, including the `mainWriteVerdict` tri-state, symlinked-root rejection, the cd/redirect/mkdir/rm matrix, the minimal-read-only-core rule, unanalysable-quoting rejection, and `bashScopeEscape` quote/relative-path/`-c`/`--eval`/`--opt=value`/attached-flag/versioned-interpreter/stdin-payload handling) and `.../throughput.test.ts` (20 cases).
- Hard-blocked commands cannot be authorized inside a subagent (no UI); the worker must report back. Subagent `rm -rf` has no trusted roots, so it stays hard-blocked even inside an `allowPaths` grant.
- Subagent processes (`PI_GOVERNED_SUBAGENT=1`) force non-plan mode: they never get the plan-first text injected and start with `planMode = false`, so the badge/working indicator do not claim plan mode. `pi 1.2.0` rejects `--no-plan`, so do not pass it when spawning subagents.
