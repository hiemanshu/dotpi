# Governance extension

A permission gate that only stops to ask when a call reaches outside the
project or `~/.pi`, or is irreversible. Enforced with `tool_call` hooks.

## What it does

- Auto-allows `read`, `grep`, `find`, `ls` (anywhere) and **writes/edits inside the project or `~/.pi`** — the whole tree, source and config included. There is no docs-only rule any more.
- Auto-allows read-only bash (the minimal safe list below) and commands that provably stay inside the project or `~/.pi`: tests, package scripts, `git commit`, `mv`, `mkdir`, ordinary redirections. Harmless stdout/stderr redirections (`2>&1`, `>/dev/null`) are stripped first, and `>`, `>>`, `n>` redirects are fine when their target is inside a trusted root.
- Treats `cd` into a trusted root as safe, and tracks the directory it reaches so later segments of the same chain (`&&`, `||`, `;`, `|`, newline) resolve relative paths against it. `mkdir` and non-recursive `rm` follow the same rule; recursive `rm` is never auto-allowed.
- Prompts for every write/edit outside the project and `~/.pi`, for bash that reaches outside them (another directory, an absolute path elsewhere, `git` on another repo), and for network commands (`curl`, `wget`, `ssh`, …). Prompts offer:
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
- Always prompts (never allowlistable, even inside the project) for the irreversible operations: `sudo`, system power commands, disk formatting, `dd if=`, pipe-to-shell, force push (including `--force-with-lease`), `git reset --hard`, `git clean -fd`/`-fdx`, `git checkout .`/`git checkout -- .`, `git restore` (any form), `git branch -D`, `git filter-branch`/`git filter-repo`, package publish, fork bombs, `chmod 777 /`, and `rm -rf` **anywhere** (inside the project too). The user can authorize one run by running `/i-understand-the-danger` (prints a one-time passcode, 2 min, single use) and typing it into the prompt.
- Scopes subagent processes to `PI_SUBAGENT_ROOT` + `PI_SUBAGENT_ALLOW_PATHS` for writes, reads, and bash (`cd` / absolute path checks). Out-of-scope reads and writes fail closed because subprocesses have no UI to prompt.
- Hard-blocks `powershell` and any tool the gate does not know, in **both** the main session and subagent processes. `powershell` gets a message pointing at `bash`; unknown tools fail closed because there is no policy for them.

## Commands

| Command | Effect |
|---|---|
| `/permissions` | Show project and global allowlists |
| `/footer` | Toggle the governance footer vs pi's default |
| `/header` | Toggle the opencode-style title bar vs pi's default |
| `/user-rail` | Toggle the left rail on user messages |
| `/i-understand-the-danger` | Print a one-time passcode for an irreversible command |

## Files

- `<project>/.pi/permissions.local.json` — per-project allowlist (gitignore this)
- `<agent-dir>/permissions.json` — global allowlist
- `utils.ts` — classification, scoping, allowlist matching (no pi imports; testable)
- `cache.ts` — cache-hit summary for the footer (pure): session rate, last-call bucket, formatting.
- `throughput.ts` — live tok/s + TTFT tracker, footer segment text (`throughputParts`), and formatters (pure, injectable clock). The rate counts every generated token — text, thinking, and tool-call argument JSON — matching `usage.output` (D-0028); tool results and nested tool usage are excluded. An estimated rate gets `~`, and `≈` marks a rate that still includes startup.
- `index.ts` — the extension

## Allowlist format

```json
{
  "write": ["~/Downloads/work/", "/home/me/shared/notes/"],
  "bash": ["npm test", "git status *"],
  "read": ["~/other-repo/"]
}
```

- Write rules: exact file paths, or directories ending in `/`. Relative paths resolve from the project root. A leading `~` expands to the user's home directory; folder approvals saved as "everywhere" are stored home-relative when possible (for example `~/.pi/`).
- Read rules: extra directory roots that read-only bash may `cd` into. They extend `cd` trust only; no command is auto-approved just because its absolute paths sit under a read root. Same path forms as write rules; entries are always treated as roots (trailing `/` is conventional). Read rules never grant writes.
- Bash rules: exact commands after whitespace normalization, or prefix rules ending in ` *`.
- Hard-blocked commands cannot be configured here. The trusted roots (the project and `~/.pi`) are fixed in `utils.ts`, not configurable in these files; `write` rules only affect the prompt path for writes outside them, so an existing `~/.pi/` entry is inert for the main gate.

## TUI chrome

- **Title bar:** full-width dark bar (`π  <project>` left, `<model>` right) with a dim rule underneath. `/header` restores the built-in header.
- **Footer:** full-width top/bottom separator rules with one content line: session title (fallback `session`), context %, cache hit rate (`◐93.1% cache rate` — `ΣcacheRead ÷ Σ(cacheRead + input)` over the session's assistant messages; the glyph is the last call's bucket: `●` ≥90% cached, `◐` partial, `○` nothing cached), live throughput (`⚡142 tok/s · 0.9s ttft`), and tokens (`↑in ↓out`) on the left; branch and cost on the right. The rate counts text + thinking + tool-call JSON and excludes time-to-first-token; while a reply streams the segment is accent-colored, when it ends the last completed call's numbers stay visible in muted color. A rate estimated from streamed deltas (providers that report usage only at the end) is prefixed `~`, and `≈` marks a rate that still includes startup because no ttft was seen. At narrow widths the cache segment drops its label and decimal (`◐93%`) and the throughput segment falls back to `⚡142 · 0.9s`; both stay ahead of the token totals so they survive truncation; `ttft` is dropped when no delta was seen, and the whole segment is hidden before the first measured call. 🔑 appears while a passcode is live. No rounded border; the model is not repeated here. `/footer` restores pi's default footer.
- **Tool blocks:** all built-ins use pi's boxed shell. `edit` is forced back into it, and every result is clipped to a uniform collapsed height (4 content lines + a dim hint), expanding to the full result on click / ctrl+o.
- **Custom tools (subagent, questionnaire, unknown extensions):** the call row stays compact. Subagent collapsed rows show status + the last streamed text; expanding shows the task, child tool calls, full output, and usage. Tools without a call renderer show only the tool name; their argument JSON appears on expand.
- **Input:** the `blocky` extension's flat panel: top rule with the `message` label/spinner, dark-violet content rows (`userMessageBg`, shared with user messages), bottom rule with the key hints; no rounded border. Content is bold. `/blocky` restores the default editor.
- **User messages:** the same `userMessageBg` panel, a violet left rail, and bright text. The rail is a render-only Markdown blockquote; the stored transcript and model context are unchanged. `/user-rail` toggles it.
- **Thinking:** starts collapsed (`hideThinkingBlock: true`) with a "Thinking… click to show" label; click or `ctrl+t` expands the full block. The collapsed state is a one-line label, not a preview. Dim text and a muted thinking-border ramp; same cell size as everything else.
- **Theme:** `opencode` now carries the official Tokyo Night palette (editor `#1a1b26`, panels `#16161e`/`#1e202e`, blue `#7aa2f7`, violet `#bb9af7`, cyan `#89ddff`, green `#73daca`/`#9ece6a`) in `~/.pi/agent/themes/opencode.json`; brighter output/input, dim thinking; `editorPaddingX` is 2.
- **Working spinner:** accent-colored always (there is no mode to signal any more).
- **Consent prompts:** consistent `action` header, the exact path/command on its own lines, and shorter allowlist options. Hard blocks use `⛔ HARD BLOCK · reason` with the passcode instruction inline.

## Known limits

- Bash scoping is best-effort, not a security boundary: relative paths are checked via `cd` and absolute path words (quoted ones included), but a determined command can still read or write outside the project. The precise enforcement is the `edit`/`write` gate and the `read` tools. The scope check fails closed on words it cannot vouch for: any unanalysable quoting or expansion (`$'…'`, `$"…"`, a backslash outside single quotes, `$(…)`, `${…}`, backticks), an interpreter one-liner (`bash -c`, `node -e`, `node -p`, `perl -E`, `php -R`, …), a `$`-expanded word, a command word that is a path (`/tmp/x.sh`, `../x.sh`), `--opt=value` values, path-like attached short-flag tails (`git -C..`, `sort -o/tmp/x`), and bare `.`/`..`.
- The interpreter control is a **name + flag allowlist**, not a payload audit. When a known interpreter name appears in a subagent command — including versioned/real names such as `python3.12`, `nodejs18`, `perl5.36`, `lua5.4`, `tclsh`, `Rscript`, `tsx`, `ts-node`, plus the shells, `osascript`, `bun`, `deno`, and `npx` — its flags must be one of `--version`, `-v`, `--help`, `-h`, `--experimental-strip-types`, `--check`, `--no-warnings`, `--enable-source-maps`; every other flag (short or long, `--opt=value` included) is an escape, and a non-flag word after it is audited as a script path inside the roots. `npx …` is always an escape, as are `deno eval`, `bun eval`, `bun x`, and an interpreter with no following script word (a stdin payload such as `echo x | bash`). This is best-effort: **stdin payloads, executors not on the name list, and absolute paths embedded inside payload strings are not audited.** A new binary or an allowlist entry is the way around it.
- Bash classification is also best-effort in the main session: `&` splits like `;` (except `&&`, `&>`, and `2>&1`), but obfuscated commands (variables, `eval`, interpreter one-liners) are not fully analysed. Treat a prompt-free command as convenience, not a guarantee. Quoting the classifier cannot analyse always prompts: `$'…'`, `$"…"`, a backslash outside single quotes (so `grep -n "a\|b"` prompts while `grep -n 'a\|b'` stays safe), `$(…)`, `${…}`, and backticks.
- Redirect stripping covers only plain `>`, `>>`, and `n>` with literal (optionally quoted) targets inside a trusted root. Targets containing whitespace or glob characters (`*?[{`), `$VAR`, command substitution, `<`, `&>`, and `>&` fall through to `unanalysableShell` and prompt. Relative targets resolve against the directory reached so far in the chain (after any safe `cd`).
- Trust is resolved, not textual: a symlinked `<project>/docs` or `~/.pi/setup` that points elsewhere resolves outside its root, so writes through it prompt like any other outside write.
- Recursive `rm` is never auto-allowed: `rm -r` asks, and `rm -rf` is on the always-prompt list anywhere, the project included. Globs are rejected in `mkdir`/`rm` targets and redirect targets. Non-recursive `rm` inside the project or `~/.pi` is ordinary scoped work.
- Writes in the main session are free inside the project and `~/.pi` (extensions, agents, settings, docs, source); everything else prompts and can be remembered. Subagent writes stay scoped to `PI_SUBAGENT_ROOT` + `PI_SUBAGENT_ALLOW_PATHS`.
- Compound commands (`&&`, `&`, `;`, `|`, newlines) can only be allowlisted exactly — prefix rules are offered only for single commands, so an approval cannot bless whatever is appended later. Newlines are top-level separators, so a second line cannot hide behind a safe first one.
- Classification is quote/escape-aware: a grep pattern containing `|` stays one command, and leading `FOO=bar` assignments are stripped. `sed` and `awk` are not on the safe list at all because they can write or execute (`sed -i`, `w`/`r`/`e`, `s///e`, `awk system(`, `print > "file"`); use `head`/`tail`/`grep`/`jq`, or allowlist a specific form.
- The safe list is a hint, not the whole policy: a command off the list still runs when every path in it stays inside a trusted root (`git commit`, `npm test`, `mv`, `mkdir`, editors, …). Safe read-only forms: `cat head tail grep ls eza echo printf pwd wc diff stat du df tree which whereis type printenv uname whoami id date ps jq`, `rg`/`find`/`fd`, the read-only `git` subcommands (`status log diff show branch --show-current remote -v config --get ls-files rev-parse describe blame shortlog stash list ls-*`), the read-only `npm` ones (`list ls view info search outdated audit`), and `node|python3|bun|deno --version`. `echo`/`printf` are safe without a redirect: a redirect is stripped first when its target is inside a trusted root and prompts otherwise, and quoted operators such as `echo "x > y"` are data. A single flag can turn a safe command into a write or an exec, so those flags still block it: `sort -o`, `uniq in out`, `curl -D`, `less -o`, `git log --output`, `git branch -f`, `tree -o`, `find -exec/-delete/-fprint`, `fd -x`, `rg --pre`, `npm audit fix`, `git branch -d/-D`, `git remote add`.
- Network commands (`curl`, `wget`, `ssh`, `scp`, `sftp`, `rsync`, `ftp`, `telnet`, `nc`, `ncat`, `nmap`, …) always prompt: they have no path argument the gate could scope. Allowlist the exact form if it becomes routine.
- Removed from the safe list on purpose (`sort uniq curl wget less more top htop bat env free uptime cal file`, and `yarn`/`pnpm`): use the read-only forms above, or allowlist the exact command you want. `sed` and `awk` stay off the list too (see above).
- Custom rules entered as free text are normalized to bash prefix rules (`<text> *`) unless they already end in `*`. Exact-match rules are still available from the menu.
- Regression tests: `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts` (425 cases, including the `mainWriteVerdict` allow/ask matrix, symlink resolution, the `mainBashVerdict` scope/ask matrix, every always-prompt entry, the cd/redirect/mkdir/rm matrix, the minimal-read-only-core rule, unanalysable-quoting rejection, the echo/printf redirect matrix, and `bashScopeEscape` quote/relative-path/`-c`/`--eval`/`--opt=value`/attached-flag/versioned-interpreter/stdin-payload handling) and `.../throughput.test.ts` (26 cases); `.../cache.test.ts` (8 cases) covers the rate, the bucket boundaries, and formatting.
- Hard-blocked commands cannot be authorized inside a subagent (no UI); the worker must report back. Subagent `rm -rf` is hard-blocked there too, even inside an `allowPaths` grant.
- Subagent processes (`PI_GOVERNED_SUBAGENT=1`) are implementation processes: they get no main-session context injection, cannot launch nested subagents, and fail closed when a call leaves their scope.
