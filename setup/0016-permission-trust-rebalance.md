# 0016 — Rebalance the permission gate: fewer false prompts, real install/publish gate

- **Date:** 2026-10-28
- **Status:** done
- **Decision:** D-0032
- **Refines:** D-0030 (gate prompts only where the answer carries information), D-0031 (temp dirs free)

## Goal

Make the main session prompt-free for ordinary project work, while prompting for
the things that genuinely deserve a human answer: installing new software,
publishing to a remote, and anything needing superuser rights.

## Context

Replaying all 124 unique bash commands from the clarke-flash sessions through
`mainBashVerdict` showed 83 would prompt. The distribution was not what the
policy intends:

| Count | Cause | Verdict |
|---|---|---|
| 26 | `backslash escape in double quotes` | **classifier bug** |
| ~28 | `cd ~/.local/share/opencode`, `/opt/pi-coding-agent/docs` | one-off outside reads |
| 13 | `python3 -c`, `python3 - <<EOF` | by design (keep) |
| 8 | `$(…)`, `${…}`, `$VAR` | by design |
| 8 | absolute paths outside roots | mostly the opencode reads |

The 26-bucket is real project work being blocked by quoting alone:

```
grep -n "exact@all\|exact_all\|answered\b" src/clarke/eval.py   → ask
grep -n "LIST_SLOTS\s*=" src/clarke/schema.py                  → ask
```

`unanalysableShell` rejects any `\` inside `"…"`. The scanner already tracks
double-quote state correctly, so only backslashes that could move a quote
boundary (`\"`, `\\`, backslash-newline, trailing `\`) actually matter.

The inverse problem: these run **unprompted** today, contradicting the user's
stated intent:

```
npm install   pip install numpy   uv add pandas   apt install jq
npm ci        git push origin main
```

So the gate both over-prompts (project work) and under-prompts (installs and
pushes).

## Decisions (user-approved)

1. **Fix the quoting false positive.** In `unanalysableShell`, allow a backslash
   inside double quotes unless the next character is `"`, `\`, a newline, or
   end-of-string. This can only ever become *more* conservative afterwards: the
   skipped character is not re-audited as an expansion, but `\$(`, `\``, `\$`
   are made literal by the backslash, which is the safe direction.
2. **Free bash *reads* anywhere.** `mainBashVerdict` allows a command outright
   when every segment is provably read-only (safe-list entry or a `cd`, no
   redirects other than the harmless `/dev/null`/`2>&1` forms, no unsafe flags).
   Writes stay scoped exactly as before — this mirrors the `read`/`grep`/`ls`
   tools, which are already free anywhere.
3. **Add an install/publish gate.** Package installs (npm/pnpm/yarn/bun, pip,
   uv, poetry, cargo, go, gem/bundle, brew, apt/dnf/yum/zypper/apk/conda/pacman/snap)
   and `git push`/`git clone` return **ask** — allowlistable, not hard-blocked.
   `sudo` and the existing hard-block list are unchanged.
4. **`python3 -c` / heredocs keep prompting.** Unchanged by choice: the payload
   is unauditable. The escape hatch is a committed script
   (`python3 scripts/x.py` is already free), not a policy change.
5. **Subagents are unchanged.** They stay scoped to `PI_SUBAGENT_ROOT` +
   `allowPaths`; the read-anywhere rule applies to the main session only.

## Non-goals

- Allowing `$(…)`, `${…}`, `$VAR`, or interpreter one-liners.
- Changing the hard-block (passcode) list.
- Making subagents trust reads anywhere.

## Steps

1. `utils.ts` — `unanalysableShell`: narrow the double-quote backslash rule.
2. `utils.ts` — new `isReadOnlyCommand(command)`; use it at the top of
   `mainBashVerdict`.
3. `utils.ts` — new exported `installOrPublishReason(command)`; return `ask`
   from `mainBashVerdict` before the allow paths.
4. `classifier.test.ts` — cases for quoted-backslash patterns, read-anywhere
   (`cat /etc/hostname`, `cd /etc && ls`), writes still scoped outside roots,
   and the install/publish matrix (`npm install` ask, `npm run test` allow,
   `git push` ask, `git status` allow).
5. Docs: `governance/README.md`, `setup/how-i-run-pi.md`, `agent/AGENTS.md`,
   `setup/decisions.md` (D-0032).

## Files to touch

- `~/.pi/agent/extensions/governance/utils.ts`
- `~/.pi/agent/extensions/governance/classifier.test.ts`
- `~/.pi/agent/extensions/governance/README.md`
- `~/.pi/agent/AGENTS.md`
- `~/.pi/setup/how-i-run-pi.md`
- `~/.pi/setup/decisions.md`

## Test plan

- `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts`
  green, count reported.
- `throughput.test.ts` and `cache.test.ts` still green.
- Replay the clarke-flash session commands and report the new ask count.

## Risks

- **Reads anywhere weakens the boundary.** A read-only command can now read
  `/etc/shadow`, browser profiles, SSH keys. Equivalent to the `read` tool,
  which was already free, but it is a real widening. The write scope is
  untouched, and `sudo`/hard blocks are untouched.
- **Install-gate regexes can misfire.** A false positive costs one prompt
  (allowlistable); a false negative silently installs. Err toward matching.
- **`git push` prompting** may feel noisy for routine pushes; allowlist the
  exact form per project if so.

## Open questions

- Should `git pull`/`git fetch` also ask? Left out: they do not publish.
- Should subagents inherit the install gate? Left out for now (a launch is
  already user-approved).
