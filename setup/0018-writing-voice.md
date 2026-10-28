# 0018 — Writing-voice instructions for agents

- **Status:** done
- **Date:** 2026-10-28
- **Scope:** agent setup (`~/.pi/`)

## Goal

Give every agent a durable, readable description of how Hiemanshu writes, so
generated documents sound like a colleague explaining the work rather than an AI
producing a polished report.

## Context

The source is a style analysis of ten sample documents (proposals, hand-offs,
role definitions, meeting prep, technical docs), weighted toward personal prose
and away from generated meeting summaries and templates. It names five traits —
writing *to* someone, preserving reasoning, turning labels into concrete work,
being opinionated without pretending certainty, and structuring for the
conversation — and turns them into a spec with perspective, reasoning, language,
structure, tone, an avoid list, an editing standard, and a final check.

Two placement decisions came from the user up front:

1. **Skill + full inline summary in AGENTS.md.** The full guide loads on demand;
   a condensed version is always in context so the voice applies even when an
   agent does not think to load the skill.
2. **Scope is all prose**, not just `docs/` documents: plans, decisions, notes,
   READMEs, hand-offs, proposals, role definitions, meeting prep, commit
   messages, PR descriptions, and chat replies where the voice matters.

## Non-goals

- Not a template or a rigid format. The voice is about reasoning and
  specificity, not a house outline.
- Not a lint rule and not enforced by the governance gate.
- No rewriting of existing documents in `~/.pi/` to match it.
- Does not cover code comments or code style.

## Steps

1. Write the plan (this file).
2. Add `agent/skills/writing-voice/SKILL.md` — the full spec, portable
   Agent Skills frontmatter, a routing description that matches "write or edit
   prose", and the too-generic / closer-to-voice pair as a calibration example.
3. Add a **Writing** section to `agent/AGENTS.md`: the non-negotiables in a few
   lines, with a pointer to the full skill.
4. Add `agent/skills/` to the `README.md` path table and a line to the session
   behaviour summary.
5. Record the decision as `D-0034` in `setup/decisions.md`.
6. Verify: load the skill through pi's own `loadSkills` and confirm no
   diagnostics; check the advertised name/description; re-read the AGENTS.md
   section for tone.

## Files

- `agent/skills/writing-voice/SKILL.md` (new)
- `agent/AGENTS.md` (new "Writing" section)
- `README.md` (path table, summary)
- `setup/decisions.md` (D-0034)
- `setup/0018-writing-voice.md` (this plan)

## Test plan

- `node -e` against the installed pi build: `loadSkills({ includeDefaults: true,
  agentDir: '/Users/hiemanshu/.pi/agent', cwd: '/Users/hiemanshu/.pi' })` must
  return the skill with `diagnostics: []`.
- `formatSkillsForPrompt` output must include `writing-voice` with the intended
  description and an absolute `SKILL.md` path — that is exactly what the model
  sees at startup.
- Manual: read the AGENTS.md section and confirm it is a summary, not a
  duplicate of the skill.

Result (2026-10-28): `loadSkills({ includeDefaults: true })` returns exactly one
skill, `writing-voice`, with `diagnostics: []`, and
`formatSkillsForPrompt` advertises it with the intended description and the
absolute path `/Users/hiemanshu/.pi/agent/skills/writing-voice/SKILL.md`.

## Risks

- **Duplicate guidance drifting apart.** The AGENTS.md summary is deliberately
  short and defers to the skill; the skill is the source of truth. If the two
  disagree later, fix the skill first.
- **Voice applied where it does not belong** (e.g. machine-generated summaries,
  changelogs). The skill's scope says all prose the user writes; pull requests
  and docs, not log output.
- **Over-correction into casual.** The guide is explicit that the point is
  visible reasoning and concrete work, not informality.

## Open questions

- Whether the voice should extend to email drafts and external-facing writing.
  Left out for now; add if it comes up.
