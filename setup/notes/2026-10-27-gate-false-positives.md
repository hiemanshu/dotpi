# The danger gate reads prose, not just argv

- **Date:** 2026-10-27
- **Found while:** committing plan 0013 (removal of plan mode)

## What happened

Committing went through `git commit -m "…gate blocks hard resets, forced cleans, recursive deletes…"`. The gate answered:

```
⛔ HARD BLOCK · git reset --hard
```

Nothing in the command executed a hard reset. `dangerousReason()` scans the whole command string, so the literal command names inside the `-m` message matched. The same applies to any plan, note, `.md` file content passed on a command line, or a commit message that documents the blocked list — the gate cannot be described in its own commit.

## Why it matters

- It blocks legitimate work (documentation, plan files, commit messages), and the only escape is a passcode, which trains the user to reach for the passcode for false positives.
- A passcode spent on a false positive is a passcode not available for the operation it was designed to protect.
- It reads as a gate bug rather than a policy decision, which erodes trust in the real blocks.

## Fix (queued, not yet done)

`dangerousReason()` should classify the words a shell would execute, not metadata payloads:

1. Strip quoted `-m`/`--message`/`--body`/`-F`/`--file` arguments before matching, for `git commit`, `git tag`, `gh`, and similar message-carrying commands.
2. Keep the check on the executable words: command name plus non-message arguments.
3. Add regression cases: `git commit -m "rm -rf /"` → allow, `git commit -m "git reset --hard"` → allow, while `git reset --hard` and `rm -rf x` still block; `git tag -m "force push"` → allow; `bash -c "git reset --hard"` → block.

## Related

The same class of false positive applies to `git commit` messages written by the agent while summarising this work, so expect it again until the fix lands.
