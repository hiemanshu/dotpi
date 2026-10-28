# 0020 — Calibration examples and one merged check

- **Status:** done
- **Date:** 2026-10-28
- **Closes:** the examples gap left open in 0019

## Goal

Put three worked examples into the `writing-voice` skill — a personal hand-off, a
design-document excerpt, and a team-shareable call recap — and collapse the two
overlapping self-check lists into one.

## Context

0019 added the structure spines and left calibration as a single too-generic /
in-the-voice pair. The user supplied three candidates, explicitly described as
adaptations rather than verbatim quotations and not "approved" until reviewed.
They also supplied a six-part check (fidelity, reasoning, structure, polish,
length, unsupported additions) whose questions overlap the six-question check
already in the skill's final section — two lists asking for the same review in
different orders is worse than either alone, so they're merged, with the two
extra questions folded into the groups they belong to ("keep the because" into
reasoning, "invented facts" into unsupported additions).

The examples are recorded as what they are: polished adaptations from material
reviewed with the user, useful for the reasoning they show, not for reuse of
wording or shape.

## Non-goals

- Not verbatim source documents, and not presented as such.
- Not a template to copy section by section.
- No redaction pass on the names in the examples (see risks).

## Steps

1. Write this plan.
2. Rewrite `## Calibration` in the skill: an opening note on what the examples
   are, the original comparison pair, then each example under a short heading
   with a "what to take from it" line.
3. Replace `## Final check` with `## Check before returning the draft`: the
   teammate test, then the six ordered checks with the extra questions folded in.
4. Verify by reloading through pi's loader and listing headings.
5. Record the decision as `D-0036`.

## Files

- `agent/skills/writing-voice/SKILL.md`
- `setup/decisions.md` (D-0036)
- `setup/0020-calibration-examples.md` (this plan)

## Test plan

- `loadSkills(...)` returns `writing-voice` with `diagnostics: []`.
- Headings: one calibration section with three example subsections, one check
  section, no leftover `## Final check`.
- Read the two check lists the skill used to have and confirm nothing was lost.

## Risks

- **Names and internal products now live in the skill.** Tiffany, Sam, Alex,
  Vanta, ConfigCat, PostHog, AWS Bedrock, Azure OCR. The repo is private and the
  file is local, but if the guide is ever shared or published these identify real
  people and internal infrastructure. Flagged to the user; redaction is a
  one-line change per name if they want it.
- **Length.** The skill is now ~3,100 words. That is acceptable because it only
  loads when prose is being written, but it is the reason the AGENTS.md summary
  stays at five bullets and one strip of guidance.
- **Examples crowding out rules.** Three examples risk being copied as shapes.
  The opening note and the per-example "what to take from it" line are there to
  point at reasoning rather than wording.
