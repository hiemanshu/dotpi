# 0019 — Document structure guidance in the writing voice

- **Status:** done
- **Date:** 2026-10-28
- **Refines:** 0018 (writing voice), D-0034

## Goal

Extend `agent/skills/writing-voice/SKILL.md` so the skill covers *shape* as well
as voice: a default spine for design documents and for write-ups made from calls,
per-section guidance on what belongs in each and what to leave out, and the
structural preferences underneath both.

## Context

The voice guide said how to write a sentence and left the arrangement of a
document unaddressed. The source for this piece is an analysis of the design docs
and call transcripts that the user provided, which found one spine for design
documents (why → what → how → next steps, with scope boundaries and open
questions) and another for call-derived briefings (why we talked → what we
explored → where we landed → what's still open → what happens next), plus five
preferences underneath: lead with the user outcome, make scope boundaries
explanatory, treat the document as a record of conversations rather than a
proposal awaiting review, make changed plans visible, and don't impose a rule
about separate alternatives sections.

The user asked for this to be expanded rather than copied: per-section guidance
on what belongs there and what to leave out, not just the section names.

I have not seen the underlying documents, so the patterns are recorded as stated
preferences. The skill does not make claims about specific documents.

## Non-goals

- Not a template file or boilerplate headings an agent must reproduce.
- Not call-minutes. Speaker-by-speaker and timestamped summaries stay out.
- Doesn't change the voice rules or the AGENTS.md summary beyond one pointer.
- No retrofitting existing `~/.pi/` documents to the new spine.

## Steps

1. Write this plan.
2. Rename the skill's existing `## Structure` section to `## Formatting` (it is
   about paragraphs, bullets, and headings), then add `## Document structure`
   with: the shared principle, the design-document spine as a table of
   section / belongs there / leave out, the call-document spine in the same form,
   the preferences that apply to both, and the alternatives-inline-or-separate
   call.
3. Add one line to the `## Writing` section of `agent/AGENTS.md`: follow the
   reader's questions, with the two default spines named, deferring to the skill.
4. Record the decision as `D-0035`.
5. Verify by reloading the skill through pi's loader and checking the rendered
   section list has no duplicate or dangling headings.

## Files

- `agent/skills/writing-voice/SKILL.md`
- `agent/AGENTS.md`
- `setup/decisions.md` (D-0035)
- `setup/0019-document-structure.md` (this plan)

## Test plan

- `loadSkills(...)` returns `writing-voice` with `diagnostics: []`.
- The skill's heading list reads in a sensible order with no two sections
  covering the same ground (the old `## Structure` must be gone).
- Read the new section as prose: does it tell an agent what to *leave out*, which
  is the part that was missing?

Result (2026-10-28): one skill, zero diagnostics. Headings run Perspective →
Keep the reasoning → Make it concrete → Language → Formatting → Document
structure (design docs, call documents, shared preferences, alternatives) →
Tone → Avoid → Editing → Calibration → Final check; no duplicate `Structure`
section. Skill is 1420 words.

## Risks

- **Template creep.** A per-section table invites literal reproduction of the
  headings. The section opens and closes by saying the progression matters, not
  the names.
- **Contradicting the voice guide.** "Don't repeat the same point in three
  places" and "keep the reasoning" can pull against each other; the resolution is
  that reasoning stays with the topic it belongs to, not that it is repeated.
- **Two spines read as the only two document types.** The section is scoped to
  design docs and call write-ups; anything else falls back to the shared
  principle.

## Open questions

- Whether meeting prep and role definitions deserve their own spine later. Left
  out for now — the shared principle covers them.
