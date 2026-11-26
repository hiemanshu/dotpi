# 0024 — Ponytail in pi

- **Date:** 2026-11-08
- **Status:** done
- **Scope:** agent setup (`~/.pi/`)
- **Touches:** `agent/settings.json` (via `pi install`), `~/.config/ponytail/config.json`, `setup/how-i-run-pi.md`, `setup/decisions.md`

## Goal

The same laziness ruleset that runs in Claude Code runs in pi, at the same level (`full`), installed the way pi expects packages to be installed so it updates and uninstalls with one command.

## Context

Ponytail is a minimalism skill: the smallest change that fully solves the task, an explicit list of what was skipped, and a check that new non-trivial logic ships with a test. [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail), MIT.

It is already part of how this machine works — Claude Code has it at 5.3.3 with `~/.claude/.ponytail-active` = `full`, and `~/.config/ponytail/band/` holds the cost band's state. pi has no trace of it: no skill under `~/.pi/agent/skills/` or `~/.agents/skills/`, no `packages` key in `settings.json`, no `PONYTAIL_DEFAULT_MODE`. So the rules apply in one harness and not the other, which is why prompts written here come back slower than they should.

pi is a first-class host for it: the repo ships a pi adapter (its README lists pi in the skill-capable hosts, and `omp` runs the pi extension unchanged). The install is one command per its `INSTALL.md`, and uninstall is `pi uninstall ponytail`.

## Non-goals

- Not the skills-CLI route (`npx skills add`) or copying `SKILL.md` by hand. Those put files in a skills folder with no update path; `pi install` writes a `packages` entry that `pi update --extensions` reconciles.
- Not turning ponytail on for the writing-voice documents. Ponytail governs code and coding replies; `writing-voice` governs prose. Where they overlap — a hand-off paragraph after a code change — the voice wins for the prose, ponytail for the code.
- Not the band statusline. It is a Claude Code feature and pi's footer is already custom.
- Not a level of `ultra`. Match what Claude Code actually runs: `full`.

## Steps

1. Add the `pi install` recognition to the governance gate first (plan 0023 step 3), so this install is a prompt rather than a silent clone — it does clone and execute third-party extension code.
2. `pi install git:github.com/DietrichGebert/ponytail`. Then `pi list` to see the entry, and read the installed copy's pi adapter before trusting it: what it injects, how often, whether it runs hooks.
3. Check where the pi adapter reads its default level from — `%APPDATA%\ponytail\config.json` per the docs, but the band state on this machine is at `~/.config/ponytail/`, so read the source rather than assume. Write `defaultMode: "full"` where it actually reads.
4. New session: confirm the six skills are listed and `/ponytail` reports `full`.
5. Prove it changes behaviour on a real task: give it a small over-buildable job and check the reply names what it skipped and adds the test for the non-trivial branch. The reply shape is the evidence, not the skill listing.
6. Docs: `how-i-run-pi.md` (skills section: what is installed, where from, how to update and remove), `decisions.md` (D-0038 — why a package install rather than copied skill files, and the writing-voice precedence).

## Files

- `agent/settings.json` — gains a `packages` entry (`pi install` writes it)
- `~/.config/ponytail/config.json` or `%APPDATA%\ponytail\config.json` — `defaultMode`, path decided by reading the adapter
- `setup/how-i-run-pi.md`, `setup/decisions.md`

## Test plan

- `pi list` shows the package after install; `pi uninstall ponytail` is available as the documented reversal.
- A new session lists the ponytail skills and `/ponytail` reports the level.
- One real task, where the evidence is the reply: it names the skipped work and the risk, and the new branch has a test.
- Confirm the governance marker still reads correctly with the ruleset injected — the extension parses turns, not prompts, so nothing should change, but that is a one-line check in the same session.

## Risks and honest limits

- **Third-party extension code.** A pi package can run code with this user's permissions. This is the reason step 2 reads the adapter before relying on it rather than after something looks odd. The repo is MIT, actively maintained, and already trusted in Claude Code on this machine — which is evidence of the author's intent, not a review of the pi-specific file, so the file gets read.
- **Every-turn injection costs context.** The pi adapter injects the ruleset each turn at the active level. That is the mechanism working as designed, but it is tokens on every request; if it shows up in the footer's context percentage as a meaningful jump, that is worth recording rather than tolerating.
- **Two always-on rule sets can collide.** `AGENTS.md` already says "restate before starting, write the plan file, ask before acting". Ponytail says "smallest change, say what you skipped". They agree on the code and disagree on prose length, which is why the precedence is written down in step 6 rather than left to whichever loaded last.
- **The level can drift.** Matching Claude Code's `full` today does not keep them matched; if one is changed, this doc is where the other gets changed too.

## Result

Installed: `pi list` shows `git:github.com/DietrichGebert/ponytail`, `settings.json` carries it under `packages`, and the checkout is at `~/.pi/agent/git/github.com/DietrichGebert/ponytail/` (5.3.3, MIT).

The adapter was read before relying on it: `pi-extension/index.js` is 254 lines, starts no subprocess and installs no hooks, and injects its ruleset as `systemPromptOptions.sections.ponytail` on `before_agent_start` — the structured form, so the cached prompt prefix is not thrown away on every turn. Mode is per-session, appended to the session as a `ponytail-mode` entry, falling back to the config default.

Config path was not the one the docs suggested: `hooks/ponytail-config.js` resolves `%APPDATA%\ponytail\config.json` on Windows (the `~/.config/ponytail/` present on this machine is the band's state, written by the other client), so that is where `{"defaultMode": "full"}` went — matching `~/.claude/.ponytail-active` = `full`.

| Check | Evidence |
|---|---|
| Package installed | `pi list` → one user package, that path |
| Ruleset injected at runtime | print session: "(1) full level. (2) ponytail, ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review." — nothing in that scratch dir mentioned ponytail |
| Changes reply shape on a real task | asked for `split_tags()` + test: came back as a one-line function, a plain-script test, and six named omissions (dedupe, non-string input, whitespace, quoting, trim choice, pytest config) |
| Reversible | `pi uninstall ponytail` |

**One thing the plan got wrong:** step 1 assumed the `pi install` gate change would make this install prompt. It did not, because this session was still running the pre-change extension in memory — the old classifier has no `pi` pattern. That is exactly the gap D-0037 closes, and it is proven by test rather than by the install itself: `trust.test.ts` asserts `pi install`, `pi update`, `pi uninstall` and `pi remove` are installs while `pi list` and `pi --version` stay free. The real check comes in the next fresh session.

**Open questions, decided:** the ponytail test rule applies to this setup's own extension code too — `trust.test.ts` is why 0023 shipped with 34 cases rather than a manual pass. And no house rule was added to `AGENTS.md`: ponytail already injects its ruleset every turn, so a duplicate there would be a second copy to keep in sync.
