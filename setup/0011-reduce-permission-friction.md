# 0011 — Reduce permission friction; enforce docs-only main-session writes

- **Date:** 2026-10-27
- **Status:** done
- **Completed:** 2026-10-27
- **Owner:** hiemanshu
- **Decision:** D-0029
- **Supersedes:** D-0009 (whole-project write trust); refines D-0002

## Goal

Make the main session prompt-free for the work it is supposed to do (writing
documentation, exploring the filesystem read-only, scratching in `/tmp`) while
mechanically enforcing that source edits go through a subagent.

## Context

The current gate (`~/.pi/agent/extensions/governance/`) already allows writes
anywhere inside `ctx.cwd`, so plain `write`/`edit` calls to `docs/` do not
prompt. The prompts users actually hit come from `bash`:

- `cd ~/.pi/...` and `cd /opt/homebrew/...` (only `cd` into the project is
  classified safe), which makes reading agent config or pi's own docs prompt.
- `python3 - <<EOF`, `mkdir`, and any redirect (`echo x > /tmp/f`) because
  `hasUnsafeShellSyntax` rejects every `<`/`>`.
- Writes to `/tmp` used as scratch space are treated like any other outside
  write.

Separately, D-0009 trusts the whole project for writes, contradicting the
working agreement ("source writes happen through subagents"). The plan-mode
context text and `AGENTS.md` repeat both rules, so the agent is told to
delegate while the gate silently permits direct source edits.

## Decisions

See `~/.pi/setup/decisions.md` → D-0029 (supersedes D-0009 and D-0013). Summary:

1. Main-session write roots (free, no prompt): `<cwd>/docs/`, `~/.pi/setup/`,
   `/tmp/`, `os.tmpdir()`.
2. Everything else inside `<cwd>` and inside `~/.pi/` outside `setup/` is
   **hard-blocked** with a "delegate to worker" message. No passcode path.
3. Writes outside all of those still prompt (unchanged).
4. Read-only bash may `cd` into: the project, `~/.pi`, the pi installation
   directory, `/tmp`, `os.tmpdir()`, plus any configured `read` allowlist
   entries.
5. Bash redirects, `mkdir`, and non-recursive `rm` are safe when every target
   is inside a free-write root.
6. Subagent bash scoping honors `allowPaths` (`PI_SUBAGENT_ALLOW_PATHS`), not
   just `PI_SUBAGENT_ROOT`.

## Non-goals

- Sandboxing or OS-level isolation.
- Fixing the classifier for arbitrary interpreters (`python3 -`, `node -`).
  Those still prompt by design.
- Changing the subagent launch confirmation (one per launch stays).
- Changing hard-block (passcode) list semantics.

## Steps

1. `utils.ts`
   - Add `read` to `AllowRules` (`{ write, bash, read }`), load/save defaults to
     `[]`.
   - Add `WriteScope` + `mainWriteVerdict(absPath, scope)` returning
     `"allow" | "block-source" | "ask"`.
   - Add `stripHarmlessRedirects(command, root[])` that removes `>`, `>>`,
     `n>` redirects whose target resolves inside given roots.
   - Change `isSafeBashCommand(command, projectRoot, readRoots?)` and
     `isSafeCdSegment` to accept a list of trusted read roots (default
     `[projectRoot]`).
   - Add safe handling for `mkdir [-p] …` and `rm` (non-recursive) when every
     path argument is inside the free-write roots.
   - Keep `dangerousReason` / `bashScopeEscape` behavior; pass trusted roots
     through from the caller.
2. `index.ts`
   - Compute `freeWriteRoots(cwd)`, `readRoots(cwd)`, and `piInstallRoots()`
     (derive from `realpathSync(process.argv[1])`: walk up to the
     `pi-coding-agent` package dir and include it and its parent).
   - `handleMainCall` write branch: use `mainWriteVerdict`; `block-source`
     returns a block reason naming the `worker` subagent. `ask` keeps the
     existing prompt.
   - `handleMainCall` bash branch: pass `readRoots(cwd)` to
     `isSafeBashCommand`; keep `dangerousReason` with `[~/.pi]` as the only
     extra trusted root. Do not trust arbitrary absolute paths.
   - `handleSubagentCall`: build roots from `subagentRoots()` for the bash
     scope check (`bashScopeEscape`); `dangerousReason` gets `cwd` only.
   - Update `PLAN_CONTEXT` to state docs-only writes + delegation.
   - Update `/permissions` output to include `read`.
   - `extensions/subagent/index.ts`: subagents keep their `PI_GOVERNED_SUBAGENT=1`
     env; the extension skips plan-context injection for them (pi 1.2.0 rejects
     `--no-plan`, verified in `dist/cli/args.js`) and sets `planMode = false`
     in their process.
3. Seed `~/.pi/agent/permissions.json` with `"read": []` (keep existing
   `write`/`bash` entries; `"~/.pi/"` may stay, the gate no longer consults it
   for main-session writes).
4. `classifier.test.ts`: add cases for the new classification and the
   `mainWriteVerdict` tri-state.
5. Update `~/.pi/agent/AGENTS.md` write-policy bullet(s) and
   `extensions/governance/README.md` (auto-allow list, allowlist format,
   known limits, the stale "docs/ exemption cannot be configured here" line).
6. Update `~/.pi/setup/how-i-run-pi.md` permission-model section and add
   D-0011 to `~/.pi/setup/decisions.md`.

## Files to touch

- `~/.pi/agent/extensions/governance/utils.ts`
- `~/.pi/agent/extensions/governance/index.ts`
- `~/.pi/agent/extensions/governance/classifier.test.ts`
- `~/.pi/agent/extensions/subagent/index.ts` (`--no-plan` only)
- `~/.pi/agent/extensions/governance/README.md`
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/permissions.json`
- `~/.pi/setup/how-i-run-pi.md`
- `~/.pi/setup/decisions.md`

No Cabinet project files change.

## Execution note

The implementation chain runs with `cwd = ~/.pi` because the current subagent
bash scope ignores `allowPaths`, so a worker rooted at the project could not run
the classifier test against `~/.pi` files. That scoping bug is fixed in step 2,
but the fix only applies to later processes.

## Revision after review (2026-10-27, pass 2)

The first implementation introduced bypasses. Fix these, in this order:

- **F1 — remove the bash path-trust shortcut.** `bashPathsAllInsideRoots(command, readRoots)`
  in `handleMainCall` auto-approves any command whose *absolute* words land in
  the roots (cwd and `/tmp` are in that list), so `cp /tmp/x agent/y.ts`,
  `mv`, `python3 /tmp/x.py`, and `cmd > /tmp/log` run unprompted. Delete the
  call (and the helper + tests) instead of narrowing it. Do not replace it
  with another generic shortcut. `read` rules only extend `cd` trust now.
- **F2 — newlines separate commands.** `splitShellSegments` must treat `\n`
  and `\r` like `;`, or `isSafeBashCommand` must reject commands containing
  them. Add tests for both.
- **F3 — `dangerousReason` roots.** Main session: `[piRootPath()]` only (no
  `/tmp`, no `os.tmpdir()`). Subagent: `dangerousReason(command, cwd)` with no
  `approvedRoots`, so `rm -rf` stays hard-blocked even inside an `allowPaths`
  grant.
- **F4 — free-write roots must not be symlinks.** In `mainWriteVerdict`,
  `realPathForScope(<project>/docs)` must equal
  `join(realPathForScope(projectRoot), "docs")`; same for `<piRoot>/setup`.
  If it does not, drop that root (the write then prompts). `/tmp` and
  `os.tmpdir()` stay as-is (`/tmp` is a symlink on macOS). Add a symlink test.
- **F5 — reject globs in free-write paths.** `mkdir`/`rm` path words and
  redirect targets containing `*?[{` are not safe. Remove the space from
  `LITERAL_REDIRECT_TARGET` (it only makes quoted targets harder to audit).
- **F6 — track `cd` across a chain.** Redirect stripping and
  `isSafeFreeWriteCommand` must resolve relative targets against the current
  directory after each `cd`, not always the project root. Make
  `isSafeSegment` return the resolved `cd` target and have
  `isSafeBashCommand` carry `base`. `cd /etc && mkdir docs` must be unsafe;
  `cd /tmp && rm -f x` must be safe.
- **F7 — expand `~` for write targets.** In `handleMainCall`, resolve
  `expandHome(raw)` before `resolveFromCwd`, matching the write/read rule
  behavior. Add a `resolveWritePath` helper in `utils.ts` and test it.
- **F8 — unknown tools fail closed.** After the `edit`/`write`/`bash`
  branches, any tool not in the explicit allow set
  (`read,grep,find,ls,subagent,questionnaire,ask,confirm`) returns a block.
- **F9 — subagent base dir.** Use `cwd` as the base for
  `dangerousReason`/`bashScopeEscape` and pass `[cwd, ...approvedRoots]` to
  `bashScopeEscape`.
- **F10 — subagent plan mode.** Keep the `PI_GOVERNED_SUBAGENT=1` injection
  guard (pi 1.2.0 genuinely rejects `--no-plan`: its arg parser reports
  "Unknown option"), and also set `planMode = false` in `session_start` for
  subagents so the badge/working indicator do not claim plan mode.
- **F11 — AGENTS.md worker note.** The file is global, so add a
  "Subagent sessions" subsection stating that the docs-only rule applies to
  the main session; workers edit source inside their approved scope.
- **F12 — tests.** Drop the removed shortcut cases; add newline, glob,
  symlinked-docs, `cd`-relative, `~`-expansion, and exact-string redirect
  cases. Keep the suite green and report the new count.
- **F13 — docs.** Remove the README sentence about absolute paths in read
  roots being trusted for commands; keep the accurate `--no-plan` note.

Do not touch `throughput.ts`, `throughput.test.ts`, `footer.ts`, `setup/0012*`
or the footer/throughput code already in `index.ts` — that is unrelated
uncommitted work from another session.

## Revision after review (pass 3)

The pass-2 review found two more real bypasses plus honesty gaps. Fix:

- **G1 — split on a single `&`.** `splitShellSegments` only splits `&&`, so
  `echo hi & rm -rf src` classifies as safe (the `echo` pattern wins) and
  `dangerousReason` never sees the `rm`. Split on `&` unless it is `&&`, part
  of `&>` (next char `>`), or fd duplication (`2>&1`, previous char `>`).
  Add tests, including `echo x & rm -rf src` and `ls 2>&1 & cat f`.
- **G2 — `bashScopeEscape` must be word/quote aware.** Replace the regex
  absolute-path scan with `splitShellSegments` + `shellWords`: any word that
  is absolute or starts with `~/` must be inside a root (quoted paths
  included). Handle `cd` per segment: skip `--`, use the first non-flag word,
  resolve relative to the first root, treat `cd -`/bare `cd`/multiple
  arguments/`pushd`/`popd` as escapes unless provably inside. Newline-
  separated `cd` must be caught too. Add regression tests at the pure-helper
  level (quoted `cp "/tmp/x" y`, `echo pwn > "/tmp/out"`, `cd -- ..`,
  `cd ..` after a newline).
- **G3 — close the `sed`/`awk` write holes.** Extend `UNSAFE_FLAGS`: `sed`
  whose script uses `w`, `e`, or `r` commands, and `awk` whose program
  contains `>`/`>>` (including `print > "file"`). Keep `sed -n '1,2p'` and
  `awk '{print $1}'` safe.
- **G4 — `powershell`.** Not supported by this setup: block it explicitly with
  a message pointing at `bash` rather than silently treating it as an unknown
  tool.
- **G5 — expand `~` in the subagent write branch too.** Use
  `resolveWritePath` for both main and subagent `edit`/`write` targets.
- **G6 — soften the claims.** Bash classification is best-effort, not a
  security boundary; the precise enforcement is the `edit`/`write` gate. Fix
  `AGENTS.md` ("Nothing outside that approved scope is reachable" is too
  strong) and the README known-limits wording (a determined command can read
  *or write* outside).
- **G7 — test hygiene.** Derive `ROOT` from `fs.mkdtempSync` and the pi install
  root from the same logic `index.ts` uses (or skip the case when absent), so
  the suite does not depend on this machine. Use `assert.notEqual` for the
  symlink verdict. Remove the stray double comma in `SAFE_COMMAND_PATTERNS`
  (`/^\s*file\b/,,`).
- **G8 — `isSafeBashCommand` defaults.** Default `writeRoots` to `[]` (not the
  permissive `freeWriteRoots(projectRoot)`) and update the tests that need
  redirect/mkdir/rm trust to pass the roots explicitly.
- **G9 — decision record.** The plan references D-0028; the parent records it
  and marks D-0009 superseded. Do not edit `setup/decisions.md`.

## Revision after review (pass 4)

The pass-3 review found one remaining critical class (sed/awk script escapes)
and two cheap fail-open paths. Fix:

- **H1 — sed/awk scripts.** Stop skipping the script after `--` and stop
  accepting `-f`/`--file` (reject them: a file-supplied script cannot be
  audited). Mark unsafe when the sed script has a `w`, `W`, `e`, or `r`
  command in command position, or a substitution with a `w`/`e`/`W` flag
  (`s///e`). Mark awk unsafe when the program has an output redirect
  (`print … > file`, `> "file"`, `printf … >> file`) or `| "cmd"`/`system(`.
  Keep `sed -n '1,2p'` and `awk '{print $1}'` safe but accept extra prompts
  when in doubt. Tests for `s///e`, `1W out`, `--`, `-f`.
- **H2 — one `cd` parser.** Share the argument parsing between the main
  session's `resolveSafeCdTarget` and `bashScopeEscape`. Reject bare `cd`,
  `cd -`, `cd -- <target>` where the target is not provably inside, multiple
  arguments, globs in the target, `pushd`, `popd`. `cd -- /etc && ls` must
  prompt.
- **H3 — subagent tools fail closed.** In `handleSubagentCall`, after the
  read-tool branch, block every tool not in `{edit,write,bash,read,grep,find,ls}`
  (including `powershell`, which gets an explicit message pointing at bash).
- **H4 — subagent relative paths.** In `bashScopeEscape`, any non-flag word
  containing `/` that is not absolute or `~/` (e.g. `../x`, `sub/../../x`, and
  the value of `X=/abs/path`) resolves against the first root and must stay
  inside. Quoted script text like `s/a/b/` resolves harmlessly inside.
- **H5 — dedupe.** Export `uniqueResolved` from utils and use it in index.ts;
  delete the duplicate `uniquePaths`. Drop the unused `extraWriteRoots`
  plumbing or test it.
- **H6 — docs + tests.** README: add the `powershell`/unknown-tool hard-block;
  add `isCompoundCommand("ls 2>&1 & cat f")` and a dangerous `&` tail test.

## Revision after review (pass 5 — simplification, supersedes H1/H4)

The sed/awk script audit keeps losing: `sed -n -i`, `s///e`, `1W`, `$'…'`,
backslash-escaped whitespace, letter delimiters, `-f`. Patching each one is an
arms race. Remove the surface instead:

- **P1 — no `sed`/`awk` auto-allow.** Delete them from `SAFE_COMMAND_PATTERNS`
  and delete the whole sed/awk script audit (SED_UNSAFE_SCRIPT,
  hasUnsafeSubstitutionFlag, scriptArguments, the awk flags). `sed -n '1,2p'`
  and `awk '{print $1}'` now prompt; `head`/`tail`/`grep`/`jq`/`cat` remain
  safe, and the user can allowlist a specific form if they want. Update the
  tests (expect false) and the README known-limits line.
- **P2 — un-analysable quoting prompts.** `isSafeBashCommand` and
  `bashScopeEscape` both return unsafe/escape on: `$'`, `$"`, any backslash
  outside single quotes, and (already) `$(`, `${`, backticks. This closes
  `cd \/etc`, `sed -n $'1w out'`, and future quoting tricks in one rule.
- **P3 — subagent scope is fail-closed on unanalysable words.** In
  `bashScopeEscape`: `bash|sh|zsh|dash|ksh -c <payload>` is an escape (no
  payload audit); check the command word itself when it is absolute or
  contains `/` (so `/tmp/evil.sh` and `../evil.sh` escape); split
  `--opt=value` and check the value; treat bare `.`/`..` words as paths;
  treat `$`-expanded words as escapes unless they resolve inside. Quoted
  script text like `s/a/b/` may still resolve harmlessly inside.
- **P4 — tests + docs** for P1-P3, including the `cd \/etc`, `$'…'`, `/tmp/evil.sh`,
  `bash -c "cat /etc/passwd"`, `git -C ..`, and `--opt=/outside` cases.

After P1-P3 the remaining subagent gaps (exotic expansions, PATH tricks) are
the documented best-effort limits, not one-flag bypasses.

## Revision after review (pass 6 — minimal safe set, supersedes P1)

Every auto-allowed command with an output flag is a potential one-flag write
(`uniq in out`, `git log --output=…`, `curl -D`, `less -o`, `sort -o`,
`file -C -m`). Keep only commands that cannot write:

**Keep safe:** `cat head tail grep ls eza pwd wc diff stat du df tree which
whereis type printenv uname whoami id date ps jq batch`, `rg` (no `--pre`),
`find`/`fd` (no `-exec/-execdir/-ok/-delete/-fprint*/-fls`), `git status|log|
diff|show|branch --show-current|remote -v|config --get|ls-files|rev-parse|
describe|blame|shortlog|stash list|ls-*`, `npm list|ls|view|info|search|
outdated|audit` (no `fix`), and `node|python3|bun|deno --version`.

**Remove from safe:** `sed awk sort uniq echo printf curl wget less more top
htop bat env free uptime cal file npm` (the ones that can write or execute).
`echo`/`printf` without a redirect are harmless, but dropping them keeps the
list one-purpose; redirect-only writes are handled by the free-write-root
redirect rule anyway, so keep `echo`/`printf` only if the tests rely on them.
Also add `UNSAFE_FLAGS`: `git … --output`, `git branch -f`.

**P7 — attached short-flag values in `bashScopeEscape`.** For a word starting
with `-` but not `--`, if its tail after the first two chars is path-like
(`/`, `~`, `.`, `..`, or contains `/`), run it through the same inside-root
check. `git -C..`, `git -C/etc`, `sort -o/tmp/x`, `less -o/tmp/x` must be
escapes.

After this, remaining findings are exotic (PATH tricks, eval, symlink races)
and explicitly out of scope — the docs already say bash is best-effort and the
write/edit tool is the precise boundary.

## Revision after review (pass 7 — final)

- **Q1 — quoted flags.** `UNSAFE_FLAGS` currently tests the raw segment, so
  `git log "--output=src/x"`, `find . "-delete"`, `npm audit "fix"` slip
  through. Run the unsafe-flag test against unquoted words
  (`shellWords(segment).join(" ")`) so the flag content is preserved and
  visible.
- **Q2 — interpreters anywhere.** `bashScopeEscape` must treat any word that
  is a shell/interpreter followed by a code-exec flag as an escape, at any
  position (covers `env bash -c`, `exec`, `nohup`, `timeout`, `xargs`), and
  include `csh tcsh fish elvish`, plus `node -e`, `python3 -c`, `perl -e`,
  `ruby -e`, `php -r`, `osascript -e`.
- **Q3 — attached output flags.** Use `\s-o` (no `\b`) for `tree`, matching
  `tree -oout`.
- **Q4 — quoted never-allow.** `dangerousReason` must test the quote-stripped
  string for the git push/reset/clean and package-publish patterns so
  `git push "--force"` is still hard-blocked (keep the existing dequote for
  the pipe-to-shell segment check so `grep "curl | sh"` stays safe).

Anything found after this that needs exotic shell (PATH tricks, eval via a
non-listed interpreter, symlink races, unicode) is an accepted best-effort
limit, documented in AGENTS.md and the README.

## Revision after review (pass 8 — interpreter flags, final)

`node --eval`, `node -p`, `perl -E`, `php -R` still escape the subagent scope
because the code-exec rule only matches short flags. Make the rule a whitelist:

- In `bashScopeEscape`, when any word is a known interpreter
  (`bash sh zsh dash ksh csh tcsh fish elvish node python3? perl ruby php
  osascript bun deno`):
  - a flag word is only allowed when it is in the read-only set
    `--version, -v, --help, -h, --experimental-strip-types, --check,
    --no-warnings, --enable-source-maps`;
  - every other flag word (short or long, any case, `--opt=value` or not) is
    an escape;
  - a non-flag word is the script path: audit it with the normal inside-root
    check (a worker may run a test inside the project).
  This closes `--eval`, `--print`, `-p`, `-E`, `-R`, `--require`, `--import`
  and any future flag by default.
- Narrow the main-session `--version` pattern to an exact
  `node|python3 --version` (no trailing tokens).
- Add tests for `node --eval=1`, `node --print 2`, `perl -E x`, `php -R x`
  (escapes) and `node --experimental-strip-types sub/t.ts` (inside root, ok).

## Revision after review (pass 9 — interpreter names, ship)

- **R1** widen `CODE_INTERPRETER` to versioned/real names:
  `python3?(\.[0-9]+)*`, `perl[0-9.]*`, `ruby[0-9.]*`, `php[0-9.]*`,
  `node(js)?[0-9.]*`, plus `tclsh`, `lua[0-9.]*`, `Rscript`, `tsx`, `ts-node`.
- **R2** an interpreter with no following script word (stdin payload, e.g.
  `… | bash`) is an escape.
- **R3** `deno eval`, `bun eval`, `bun x`, `npx …` are escapes.
- **R4** README honesty: interpreter control is a name+flag allowlist; stdin
  payloads, unlisted executors, and paths embedded inside payload strings are
  not audited. Fix the stale test count.
- **R5** tests for `python3.12 -c`, `bash` via stdin, `deno eval`.

After R1-R5, ship. Any remaining gap requires an unlisted binary or an
allowlist entry; that is the documented best-effort boundary.

## Outcome (2026-10-27)

Implemented and reviewed over nine passes. `classifier.test.ts` passes 366
cases; `throughput.test.ts` (unrelated 0012 work) passes 20. The extension
loads cleanly (`pi --help` reports no load failure). Delivered:

- main-session free writes limited to `docs/`, `~/.pi/setup/`, temp dirs, with
  a delegation block for source/config;
- symlinked docs/setup roots rejected;
- minimal read-only bash safe list, `cd` into project/`~/.pi`/pi install/temp/
  `read` roots, free-write redirects + `mkdir`, non-recursive `rm` in temp;
- subagent bash scope honours `allowPaths` and audits quoted paths, `cd --`,
  relative paths, `--opt=value`, attached short flags, and interpreter
  code-exec flags; unanalysable quoting fails closed;
- subagents no longer receive the plan-first text and run with plan mode off;
- `AGENTS.md`, `README.md`, `how-i-run-pi.md`, D-0029 updated.

Accepted best-effort limits (documented): stdin payloads into an interpreter
(`… | bash`), unlisted executors, absolute paths embedded inside a payload
string, PATH tricks, and allowlist entries the user adds. One known
over-block: an interpreter name as the last word of a subagent command
(`which node`) is treated as a stdin payload and escapes; narrow R2 to command
position if it becomes annoying.

## Test plan

- `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts`
  (all existing 53 cases plus new ones).
- New cases: `cd ~/.pi/agent && ls` safe; `cd /opt/homebrew/Cellar/pi-coding-agent && ls` safe;
  `cd ~/secrets && ls` unsafe; `echo hi > /tmp/x` safe; `echo hi > docs/note.md` safe;
  `echo hi > src/a.ts` unsafe; `mkdir -p docs/plans` safe; `mkdir -p src/x` unsafe;
  `rm /tmp/x` safe; `rm src/x` unsafe; `cat docs/x > /tmp/y` safe;
  `cat src/x > src/y` unsafe.
- `mainWriteVerdict`: `docs/`, `~/.pi/setup/`, `/tmp/` → allow; `src/x`,
  `~/.pi/agent/x` → block-source; `~/other/x` → ask.
- Non-interactive smoke: `pi -p` session writing `docs/ok.md` succeeds and
  `src/ok.md` is blocked with the delegation message.
- Interactive smoke (user): a docs write and a `cd ~/.pi` read show no prompt.

## Risks

- The pi install-dir derivation may miss non-Cellar layouts; the `read`
  allowlist is the escape hatch.
- Redirect stripping is the riskiest change: only strip when the target is
  inside a free-write root, and keep `hasUnsafeShellSyntax` for everything
  else. Add tests for `>>`, `2>`, and quoted paths.
- Blocking `~/.pi/agent` writes for the main session means emergency config
  fixes need a worker launch; accepted, matches the working agreement.
- `permissions.json` `write` entries become inert for the main gate; leaving
  them is harmless but the README must say so.

## Open questions

- Should another repo's `docs/` be free-write when the session runs elsewhere?
  Not in this change; it stays a prompt.
- Should `cp`/`mv` into a free-write root be auto-allowed? Deferred.
