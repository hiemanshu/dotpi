# 0017 — Bash allow-by-default

- **Date:** 2026-10-28
- **Status:** done
- **Decision:** D-0033
- **Supersedes:** the allowlist bash model of D-0029/D-0030; folds in D-0032

## Goal

Stop prompting for local work. Keep prompts only where a human's answer changes
the outcome: installing something, reaching another machine, writing outside the
workspace, destroying work.

## Context

Plan `0016` fixed the quoting false positive and added the install gate, but
replaying the clarke-flash history still left 43 project-only prompts out of 196,
33 of them `python3 -c`/heredoc and the rest `$(…)`/`$VAR`.

The decisive observation: **arbitrary code execution was already free.**

```
write scripts/x.py          → allow
python3 scripts/x.py        → allow
python3 -c "…same code…"    → ask
```

Blocking the inline spelling of an already-permitted action is friction, not a
boundary. The gate was spending its prompts on the wrong side of that line.

## Decisions (user-approved)

1. Invert `mainBashVerdict` to allow by default.
2. Ask on exactly four categories: installs/publishes, network, writes outside
   the trusted roots, destructive local forms.
3. Hard-block list and the `edit`/`write` gate unchanged.
4. Heredoc bodies are data, not shell syntax.

## Implementation

- `mainBashVerdict`: heredoc stripping → install → network → destructive →
  read-only fast path → outside-write check → allow.
- `installOrPublishReason`: package managers' install/add/ci, `git push`/`clone`.
- `destructiveAskReason`: `find -delete`/`-exec`/`-execdir`/`-ok`/`-fprint*` plus
  recursive removal.
- `writesOutsideRoots`: `redirectTargetsOutside` (quote-aware scanner,
  `$HOME`/`$TMPDIR` expanded, other `$VAR` judged by static prefix),
  `outputFlagTargetOutside` (`sed -i`, `sort -o`, `tree -o`, `less -o`,
  `uniq in out`, `git --output`), and a `WRITE_COMMANDS` list with `DEST_LAST`
  handling so `cp /etc/hosts ./x` reads outside but writes inside.
- `stripHeredocBodies`: without it a Python payload containing `>` read as a
  redirect, and a body line starting with `rm` read as a command.

## Test plan

- Classifier suite green: **494 cases** (was 462).
- New `allowByDefaultCases` block: local execution, heredoc bodies,
  `$HOME` redirects, write-flag targets inside vs outside, `find` delete/exec.
- Differential against HEAD on 56 risky commands, every change reviewed.
- Replay 257 real session commands.

## Result

| | ask | allow | hard-block |
|---|---|---|---|
| before D-0032 | 106 | 54 | 0 |
| after D-0032 | 90 | 70 | 0 |
| after D-0033 | **0** | **256** | 1 |

Project-only commands still asking: **0** (was 53).

## Risks and honest limits

- **The bash gate is no longer a boundary for a determined actor.** An allowed
  `python3 -c` can write anywhere, read anything, and reach the network. The
  write-scope check catches the *accidental* `> ~/.bashrc`, not a deliberate
  one. Stated in `governance/README.md` and `how-i-run-pi.md`.
- **Install-gate regexes can misfire**; a false positive costs one allowlistable
  prompt.
- **`$VAR` write targets are best-effort.** `> $HOME/x` is caught;
  `> $UNKNOWN/x` is not.
