# 0014 — Cache-hit counter in the footer

- **Date:** 2026-10-27
- **Status:** implemented, awaiting TUI check
- **Owner:** hiemanshu

## Goal

Show whether the conversation is actually being served from the prompt cache: a running hit rate for the current session plus a marker for the last call, in the footer next to the throughput segment.

## Context

- Every assistant message persists `usage.input`, `usage.cacheRead`, `usage.cacheWrite`, `usage.output`, so this is arithmetic over the session branch — no new plumbing, no new API surface.
- The footer already walks the same entries for `↑in ↓out` and `$cost`; the cache segment slots into the same render pass.
- Motivation: at DeepSeek's prices a 90% → 60% cache rate is a 6× difference on input cost, so the hit rate is a first-class number, not a curiosity. Current logs show 96.4% cache share over 1,476 calls.
- DeepSeek reports `cacheWrite = 0` (cache is implicit); other providers charge writes, so the maths must not assume it is always zero.

## Non-goals

- No history across sessions, no exported reports, no per-model breakdown (a `/cache all` reader over the session logs is a separate idea).
- No change to the throughput tracker, the pricing discussion, or the gate.
- No new commands in this piece.

## Design

**Definitions** (documented in the code and README):

- `prompt = input + cacheRead` per message; `cached = cacheRead`.
- Session rate = `Σcached ÷ Σprompt` over every assistant message in the branch (tool-result nested usage excluded, as elsewhere).
- Per-call bucket from that message's `cachedFrac = cacheRead ÷ (input + cacheRead)`:
  - **miss** — `cacheRead = 0` (nothing came from cache)
  - **partial** — `0 < cachedFrac < 0.9`
  - **hit** — `cachedFrac ≥ 0.9`
  - the 0.9 cut is a named constant so it is easy to tune.

**Rendering:** one footer segment, before the throughput segment so the rate survives truncation:

```
◐96.3%          full form (glyph = last call's bucket, number = session rate)
```
- glyphs: `●` hit, `◐` partial, `○` miss; no glyph before the first call.
- colour: `success` for hit, `warning` for partial/miss (theme names already used by the extension).
- compact form at narrow widths: `◐96%`.
- hidden when the session has no assistant usage yet.

**Modules**

- `cache.ts` (new, pure): `summarizeCache(entries)` → `{ cachedTokens, promptTokens, rate, lastBucket }`, `bucketFor(cachedFrac)`, `formatCacheRate(rate)`. Injectable data, no pi imports, unit-tested.
- `footer.ts`: render the segment from `summarizeCache(ctx.sessionManager.getBranch())`, reusing the existing width/compact logic.
- No `index.ts` changes: the footer already re-renders on every streamed delta and on branch changes.

## Files

| File | Change |
|---|---|
| `agent/extensions/governance/cache.ts` | new: summary, buckets, formatting |
| `agent/extensions/governance/cache.test.ts` | new: unit tests |
| `agent/extensions/governance/footer.ts` | render the `⌁`/glyph segment |
| `agent/extensions/governance/README.md` | document the segment and the bucket rule |
| `setup/0014-cache-hit-footer.md` | this plan |

## Test plan

- [ ] Unit: rate = ΣcacheRead ÷ Σ(cacheRead + input); zero-prompt session → hidden; single miss → `0.0%`; all-hit → `100%`; buckets at 0, 0.5, 0.9 boundaries; formatting (`96.3%`, `100%`, `0.0%`).
- [ ] `--check` on the touched files, existing suites still green.
- [ ] Live: a real reply shows a plausible number (logs say ~96%); the glyph tracks the last call; narrow terminal falls back to the compact form without wrapping.
- [ ] Live: a fresh session with no calls shows no segment until the first reply lands.

## Risks

- **Misleading on compaction or model switch:** the session rate mixes calls from different models/contexts. Mitigation: it is labelled as a session number; per-model breakdown is explicitly out of scope.
- **Provider differences:** providers that report `cacheWrite` costs make "cacheRead only" an incomplete picture of cache economics. Mitigation: document that the segment measures *read* hits, and keep `cacheWrite` out of the rate.
- **The 90% hit cut is arbitrary.** Mitigation: named constant plus a single place to change it.

## Open questions

1. Does the last-call glyph belong in the footer, or is a bare session rate enough?
2. Should `cacheWrite > 0` providers get a `W:` marker, or stay invisible for now?

## Implementation notes (2026-10-27)

- `cache.ts` + `cache.test.ts` (8 cases): `summarizeCache()`, `bucketFor()`, `HIT_THRESHOLD = 0.9`, `formatCacheRate()` / `formatCacheRateCompact()`, `CACHE_GLYPH`.
- `footer.ts` accumulates `{ input, cacheRead }` in the existing branch loop and renders `◐96.3%` before the throughput segment; compact `◐96%` when the left group overflows.
- Calls with `input + cacheRead === 0` are skipped, so a failed request cannot drag the rate down; the last bucket follows the most recent call with usage.
- Verified: cache 8, classifier 425, throughput 26, railify, `--check` clean. TUI check still needed (glyph colour, narrow fallback, number matching the ~96% expectation).
