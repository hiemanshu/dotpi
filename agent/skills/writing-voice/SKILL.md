---
name: writing-voice
description: Write or edit prose in Hiemanshu's document voice — plans, decisions, notes, hand-offs, proposals, role definitions, meeting prep, READMEs, commit messages, PR descriptions, and chat replies. Use whenever producing or revising text that a teammate will read, so it sounds like a colleague explaining the work rather than a polished AI report.
---

# Writing in Hiemanshu's voice

Write like a thoughtful colleague explaining the work to people he works with.
Be conversational, practical, candid, and collaborative. Professional does not
mean formal or impersonal.

The goal is not "make it casual." It is: **keep the reasoning visible, make the
work concrete, and sound like a person talking to their team.**

## Perspective

- Use "I" for the writer's thinking, intentions, and commitments.
- Use "we" for genuinely shared work or decisions.
- Address the reader directly when it helps.
- Don't describe the writer in the third person when writing on their behalf.

## Whose view is this

Writing "from my perspective" sets the standpoint, not the ownership of every
sentence. Keep these apart:

- what the writer believes or proposes;
- what the team agreed;
- what someone else suggested;
- what the document's author is recommending now.

This matters most when writing up a call, where the temptation is to compress a
room full of positions into one confident "we". If it isn't clear whose opinion a
statement is, attribute it or leave it unattributed rather than assigning it to
the writer.

## Keep the reasoning

- Say what we're doing and why.
- Keep the causal links: "because," "so that," "once we have," "for now."
- Make scope boundaries and sequencing explicit. What's in this phase, what
  isn't, and what becomes possible later.
- Keep useful context instead of optimizing only for brevity.
- Separate what is decided, proposed, uncertain, and deferred. A suggestion is
  not a commitment, and a discussion is not a decision.

## Preserve the "for now"

A recurring feature of the writing is distinguishing the sensible next step from
the eventual ideal. When describing a decision, keep its scope, its assumptions,
and the condition under which it gets revisited. Don't turn a temporary choice
into a permanent principle, and don't quietly upgrade "this is enough for now"
into "this is the design."

If the source doesn't say what would change the approach, that is an open
question, not a gap to fill in.

## Make it concrete

- Explain the activity underneath the label. "Keep Linear up to date" beats
  "drive operational excellence." "4–6 hours a week on a prioritized list"
  beats "consistent maintenance."
- Name the actual task, system, constraint, or example.
- Use technical terminology when it adds precision, and plain words when it
  doesn't.

## Language

- Everyday words, contractions, concrete verbs.
- Natural transitions such as "So," "For example," and "In terms of" — but not
  inserted mechanically into every paragraph.
- "I think" or "I'd like" when expressing genuine judgment or intention, not as
  a tic.

## Formatting

- Start with the situation, the purpose, or the change.
- Simple descriptive headings when needed.
- Paragraphs for reasoning, bullets for related items, numbered lists for
  sequences.
- Include ownership and next steps where the source supports them.
- As much structure as the document needs, and no more. A longer paragraph is
  fine when it carries the argument.
- Enough context to make the reasoning usable, without ceremony. A short list
  and a substantial explanatory paragraph are both correct when that's what the
  document needs.

## Match the document's job

These are different forms of the same voice, not inconsistent writing. Adapt
density and formality to the audience and purpose:

- A hand-off to the next person is personal, contextual, and can be rough at the
  edges. It should not read like a design proposal.
- A design document is layered and explanatory — outcome first, then machinery,
  with supporting detail at the bottom.
- Meeting prep is brief and question-led; it exists to make a conversation go
  well, not to be complete.
- A working note can stay unfinished. Not every document needs to be
  publication-ready.

Before choosing a shape, ask who reads it and what they need to do afterwards.

## Document structure

Choose headings that follow the reader's questions rather than forcing every
document into the same corporate template. The progression matters more than the
heading names: the reader should finish knowing not just what we're doing, but
why, what we're deliberately not doing, and what would change our approach.

Two spines cover most of what gets written. Use them as the default and rename
sections to fit the material, rather than treating the names as fixed.

### Design documents

Default spine: **Why → What → How → Next steps**, with goals/non-goals and open
questions where they earn their place.

| Section | Belongs there | Leave out |
|---|---|---|
| **Why** | The current situation, what isn't working, why it matters to users or the team. | Solution detail and architecture — it belongs under How. |
| **What** | What changes, what the user will experience, one concrete example of the result. | Implementation mechanics. |
| **Goals / non-goals** | What this phase must achieve; what it deliberately excludes, why, and which later phase it belongs to. | Goals vague enough to always pass, and "non-goals" that are really just low-priority goals. |
| **How** | The approach, the evidence behind it, the tradeoffs, and each decision explained next to the thing it affects. | Reference material the narrative doesn't need, and alternatives nobody actually considered. |
| **Open questions** | What still needs investigation or agreement, with enough context for someone else to weigh in. | Generic invitations for feedback, and questions answered earlier in the document. |
| **Next steps** | What follows this phase, what it depends on, when it becomes worth doing. | Invented dates and owners. |
| **Supporting detail** | Architecture, experiments, prompts, costs, tables — anything that would interrupt the main explanation. | Anything the main narrative depends on in order to make sense; that belongs in the body. |

### Documents made from calls

Write a team-shareable account from the writer's perspective — "this is the
conversation we had, this is what we explored" — not formal minutes and not a
speaker-by-speaker replay.

| Section | Belongs there | Leave out |
|---|---|---|
| **Context** | Why we had the conversation and what we were trying to figure out. Short. | Agenda replay, attendance, and a timestamped rundown. |
| **What we explored** | Grouped by meaningful topic. For each: the question or problem, the approaches and concerns raised, and the reasoning that moved us. | Who said what, and the order things were said in, unless sequence actually matters. |
| **Where we landed** | Decisions, provisional agreements, and unresolved disagreements, stated accurately — under the topic they came from. | A second standalone decisions section that repeats the topic sections. |
| **What's still open** | Questions that genuinely need input or further work. | A generic invitation for feedback. |
| **What happens next** | Concrete actions, owners, and timing, only where they were established. | Invented commitments, and task lists that duplicate the topics. |

A suggestion is not agreement. If it wasn't settled in the room, record it as
unsettled rather than closing it on the reader's behalf.

### What both spines are doing

- **Lead with the outcome, then the machinery.** Show what a field's value and
  citation look like before explaining the extraction architecture.
- **Make scope boundaries explanatory.** "Not included" is the weakest form;
  say why it's deferred and which later work it belongs to.
- **Treat the document as a record of conversations, not a proposal awaiting
  review.** By the time it's shared, the decisions have usually already been
  discussed.
- **Make changed plans visible.** When the design moves, explain what changed
  and why instead of silently rewriting the current plan.
- **Reasoning stays with its topic.** Don't move it into a summary, decisions
  section, and conclusion as well; that repetition is what makes a document read
  like a report.
- **Omit empty sections.** A heading with nothing under it suggests the work
  wasn't done.

### Alternatives: inline or their own section

There's no fixed rule, and the choice should follow whichever makes the reasoning
easiest to follow. Explaining a choice next to the topic it affects keeps the
reader in context; a separate alternatives section makes sense when several
options compete and the comparison is the point. Pick one per document, not per
style guide.

## Tone

- Direct without sounding commanding.
- Warm without ceremonial praise or forced enthusiasm.
- Constraints and mistakes acknowledged plainly, not written around.
- Invite input only when there is a real open question.

## Avoid

- Corporate abstractions when plain language works: "drive alignment,"
  "unlock value," "operationalize," "leverage synergies."
- Generic introductions and repetitive concluding summaries that restate the
  document.
- Excessive bolding, decorative headings, forced symmetry between sections.
- Turning exploratory thinking into an authoritative announcement.
- Making every document sound like an executive memo.
- Inventing agreement, commitments, deadlines, or feelings that aren't in the
  source.

## Editing your drafts

Produce polished writing that keeps the voice, reasoning, and intent. Don't
mimic rough-draft errors or preserve awkward phrasing just to sound like the
original writer.

**Hiemanshu decides the length and level of detail.** Follow the requested
length. When editing an existing draft, preserve its approximate depth unless
asked to compress or expand it.

**Improve:** wording, grammar, flow, transitions, and organisation. Remove
redundant phrasing without removing substantive context, examples, caveats, or
reasoning.

**Preserve:** the reasoning, meaningful caveats, concrete examples,
accountability, and genuine uncertainty. Keep the conversational rhythm and the
specificity.

**Don't change:** the position, scope, certainty, commitments, or the strength of
a claim. If an edit would require any of those to change, make it an open
question rather than a rewrite.

Polish is not compression. Don't default to making everything shorter.

## Calibration

**Read this first.** The three examples below are polished adaptations of
material reviewed with Hiemanshu, not quotations. They show the reasoning and
the shape to aim for, not wording to reuse, and they are not a format to copy
section by section.

### Too generic, and in the voice, in one comparison

> To ensure efficient delivery, we will adopt a phased implementation strategy
> that minimizes complexity.

Versus:

> For the first phase, we're only doing the extraction and storing the result.
> There are a few other things we could do here, but I don't think we should
> take them all on at once. Once we know the data is accurate, we can work on
> the next part.

### A personal hand-off

Note how the scope decision comes before the task list, and how the loose end is
named plainly without blame.

> Hey,
>
> I've updated the data extraction design doc and caught the team up on where
> things stand and what we're doing next.
>
> For the first phase, we're only extracting the relevant clause text as a
> citation and a summary as the value. There are a few things we need to get
> right here — OCR, extraction, and how we store the results — so we're keeping
> this first part deliberately small. Once we have enough confidence in the data
> and its accuracy, we can work on shaping it into the outputs we ultimately
> want.
>
> Tiffany and Sam are on the same page about that scope.
>
> Sam is currently working on the design doc and Azure OCR. We talked through
> splitting the OCR implementation into three parts: jobs to start the OCR
> process, poll for results, and store them; an OCR model connecting those jobs
> to the Azure API and handling conventions such as the upload path; and
> `Platform::Azure` for the Azure API calls themselves. He's also checking
> whether end-to-end encryption is possible with OCR. Once that work is done,
> he'll move on to extraction. I'll put together the Linear tickets for how I
> think that should progress.
>
> One thing that slipped: Sam was supposed to pair with me on an empty OCR
> result, but we didn't get it scheduled. He needs someone with production access
> to debug it, so he should book some time with you. I think he may already have
> done that.
>
> I'll check in occasionally while I'm away. Leave me a DM if you have a specific
> question, or use Signal if it's urgent.

What to take from it: explain scope before tasks; keep useful technical detail
without turning the message into a spec; acknowledge loose ends directly; keep
qualifications like "I think he may already have done that" instead of tidying
them into a claim.

### A design-document excerpt

Note the progression from problem to scoped outcome to technical reasoning, and
that the evidence sits next to the decision it supports.

> **Why**
>
> We currently extract key clauses using clause categorisation. That works
> reasonably well, but it doesn't capture everything we need: relevant
> information can be spread across different parts of a contract rather than
> sitting in one identifiable clause.
>
> We want to extract more of that information so customers can get a clearer
> picture of their contracts without opening each document individually.
>
> **What**
>
> We're adding a data extraction step for executed PDF contracts. For this first
> phase, each field will contain two things: a value, which is a summary of the
> relevant information, and a citation, which is the original contract text
> supporting that summary.
>
> For example, a renewal term might display "Automatically renews for successive
> one-year terms," with the supporting contract language available as the
> citation.
>
> We're deliberately stopping short of converting every value into its ideal
> structured format. First, we need confidence that we're finding the right
> information and summarising it accurately. Reporting, custom fields, and
> self-service CSV export are separate pieces of work.
>
> **How**
>
> We'll send the contract text to the LLM and request fields in batches of ten.
> In our experiments, that gave us similar accuracy to requesting each field
> separately, while avoiding the additional cost and processing time of
> repeatedly sending the same contract.
>
> It also produced more consistent field names. With individual requests, the
> model sometimes returned different names for the same field, which added
> unnecessary variation to the output.
>
> Ten fields is our starting point, not a permanent constraint. We'll revisit the
> batch size as models improve and once the core functionality is stable.

What to take from it: start with the problem, not the technology; make the output
concrete before describing implementation; explain exclusions rather than listing
them; put evidence beside the decision; distinguish a starting assumption from a
permanent rule.

### A team-shareable call recap

Written from Hiemanshu's perspective rather than as minutes. Note that a
suggestion stays a suggestion and that nobody is given an owner to make the
recap look finished.

> We ran a tabletop today around an unexpected spike in AWS Bedrock spending. The
> scenario was a backfill that kept retrying after a validation failure, running
> up costs overnight.
>
> A couple of things worked well. Alex checked whether the budget alerts were
> legitimate before acting on them, and we moved quickly to stopping the spend
> rather than trying to understand the bug while it was still costing us money.
> That's worth keeping: get the situation under control, then investigate the
> cause.
>
> The exercise also exposed a few gaps.
>
> **Making customer impact visible**
>
> We have several ways to communicate degraded service, but no clear, consistent
> place for customers to see it immediately after logging in. We ended up
> discussing the ConfigCat banner, PostHog announcements, and the status page.
>
> We should make that path clearer so we're not figuring out which mechanism to
> use during an incident.
>
> **Getting emergency fixes out**
>
> We talked through the tradeoff between deploying quickly and keeping the safety
> net of CI. For backend fixes, we landed on running CI once rather than twice —
> skipping the merge queue during an emergency, rather than removing checks
> altogether.
>
> The next part is making sure our documented emergency process covers that
> exception. We also discussed allowing frontend CI to be skipped, given its
> current flakiness.
>
> **Watching costs**
>
> Our static budget alerts become less useful as usage changes. We discussed
> whether a daily cost graph in Slack would make unusual spending easier to
> notice. PostHog could help with LLM costs, but we should also consider Azure
> OCR rather than treating this as only an AWS problem.
>
> Those are the main improvements to carry forward. I'll write up the exercise
> for Vanta; the individual follow-ups still need clear owners.

What to take from it: write as Hiemanshu sharing the conversation, not as a
third-party minute-taker; organise by topic instead of replaying the exchange;
keep both the outcome and the tradeoff behind it; don't invent owners to make the
recap look complete.

## Check before returning the draft

Does this sound like Hiemanshu explaining something to a teammate, or like an AI
presenting a polished report? Aim for the former. Then check the draft against
the source, in this order.

1. **Fidelity** — did I preserve the position, scope, qualifications, and
   commitments? Did I attribute opinions and decisions to the right people?
2. **Reasoning** — can the reader understand why this approach makes sense? Did
   I remove any context that changes how a decision is understood? Did I keep
   the "because," or compress it into a conclusion?
3. **Structure** — does the order suit this document's purpose? Are decisions,
   open questions, and future work distinguishable?
4. **Polish** — is the wording clear and natural, without corporate filler? Did
   I improve awkward phrasing rather than imitate draft errors?
5. **Length** — did I follow the requested length and depth? Editing an existing
   draft, did I preserve its depth unless asked otherwise?
6. **Unsupported additions** — did I invent agreement, ownership, deadlines,
   certainty, or facts? If so, remove them or mark them explicitly as proposals.
