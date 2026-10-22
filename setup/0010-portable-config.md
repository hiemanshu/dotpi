# 0010 — Portable config repo + `~` write rules

- **Date:** 2026-10-22
- **Status:** done
- **Owner:** hiemanshu

## Goal

Keep the pi configuration in git safely across machines, and make global write allowlist rules portable.

## Context

- `~/.pi` was added as a git repo, but the initial commit tracked `agent/auth.json` (credentials), four session transcripts, `agent/models-store.json`, machine-specific `agent/permissions.json`, and the repo's project allowlist.
- There is no remote and only one commit, so the token was never pushed.
- Global write rules stored absolute paths like `/Users/hiemanshu/.pi/`, which do not work on another machine.

## Decisions

1. **`~/.pi` is the private config repo.** Track `agent/AGENTS.md`, `agent/extensions/`, `agent/agents/`, `agent/prompts/`, `agent/themes/`, `agent/settings.json`, `setup/`, and `.gitignore`. Ignore and untrack `agent/auth.json`, `agent/sessions/`, `agent/models-store.json`, `agent/permissions.json`, `agent/state/`, `agent/logs/`, and `.pi/permissions.local.json`.
2. **Rewrite the single local commit** to purge the committed auth token, then prune the old objects. No remote exists yet, so this is local-only. Auth is recreated per machine with `pi login`; sessions stay local.
3. **`~` expansion:** write rules accept a leading `~`; global folder approvals under `$HOME` are stored home-relative (for example `~/.pi/`). The local global permissions file now uses `~/.pi/` so it can be shared manually.
4. **Global permissions stay machine-local** and are ignored by git. Recreate the `~/.pi/` rule on each machine (or copy a portable file).
5. **Add a private remote after cleanup.** Never push this repo publicly.

## Files

| File | Change |
|---|---|
| `~/.pi/.gitignore` | secrets/runtime ignore list |
| `governance/utils.ts` | `expandHome`, `homeRelative`, `matchWriteRule` |
| `governance/index.ts` | store global folder/file rules home-relative |
| `governance/classifier.test.ts` | `~` rule tests |
| `governance/README.md` | allowlist format |
| `agent/permissions.json` (local) | `~/.pi/` write rule |
| `setup/decisions.md` | D-0025, D-0026 |
| `setup/how-i-run-pi.md` | git workflow section |

## Test plan

- [x] `node --experimental-strip-types --check` on utils/index; classifier tests including `~` cases.
- [x] Fresh `pi -p` load with empty stderr.
- [x] `git ls-files` contains no auth/sessions/models-store/machine permissions/project allowlist.
- [x] `agent/auth.json` still exists on disk; `git status` clean; old commit history with the token is pruned.
- [ ] Add a private remote and clone/pull on the second machine, then `pi login`.

## Risks

- Time Machine or other backups may retain the old auth blob; rotate the provider credentials if that matters.
- `permissions.json` is not synchronized; recreate the `~/.pi/` rule per machine.
- Sessions are intentionally local; syncing them needs a separate encrypted store.
- `/reload` is not involved; the extension changes apply to new sessions.
