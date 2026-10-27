# 0012 — Live throughput + TTFT in the governance footer

- **Date:** 2026-10-27
- **Status:** in-review (fix slices A/B)
- **Owner:** hiemanshu

## Resolved open questions (approved 2026-10-27)

1. Placement: left group, after `↑in ↓out`.
2. Idle: last completed call's numbers stay, muted.
3. No persistence; in-memory, resets per process.

## Goal

Show, while a reply streams, the **generation rate** (output tokens ÷ time from first delta to last, i.e. TTFT excluded) and the **time to first token**, in the governance footer. When idle, keep the last completed call's numbers visible so a finished reply can still be read.

## Context

- pi persists `durationMs` and `usage` per assistant message, so retrospective tok/s is already computable (measured over 1,121 calls: deepseek-v4.1-flash median 110 tok/s, kimi-k3 median 61 tok/s) — but that is *effective* rate, TTFT included, and only available after the fact.
- Extensions receive `message_start`, `message_update` (cumulative `usage` + deltas), and `message_end`, so a live, TTFT-excluded rate is possible with no core changes.
- The governance extension already owns the footer (`footer.ts`, `installGovernanceFooter`) and is the only place the session card lives; the blocky extension draws the input panel and must stay untouched.
- Footer content today: `title · ctx % · ↑in ↓out` on the left, `⎇ branch · $cost` on the right, wrapped in top/bottom rules.

## Non-goals

- No `/tps` history command, no per-model aggregation, no writing throughput samples into session entries.
- No output in print / json / rpc modes (TUI chrome only).
- No change to the blocky input panel, title bar, or the working indicator.
- Not a benchmark harness: no provider-level comparison runs, no request fan-out.

## Design

1. **New pure module** `~/.pi/agent/extensions/governance/throughput.ts`
   - `createThroughputTracker(clock = () => performance.now())` with:
     - `start()` — called on assistant `message_start`; records the request start time and clears the in-flight sample.
     - `update(usage)` — called on `message_update`; on the first call with `output > 0` records `firstDeltaAt` (⇒ TTFT), then returns a live sample `{ output, ttftMs, genMs, tokensPerSecond }`. `genMs` is clamped (min 50 ms) to avoid absurd values on the first delta.
     - `end(message)` — called on assistant `message_end`; finalizes `{ output, ttftMs, genMs = durationMs - ttftMs, tokensPerSecond }` and stores it as `last`.
     - `snapshot()` — returns `{ live: boolean, sample: ThroughputSample | null }`, `live` only while a stream is in flight.
   - Fallback: if the provider never reports `usage.output` mid-stream (some APIs only send usage in the final chunk), estimate tokens from streamed delta characters (÷4, done in `index.ts`'s handler since deltas live there) and mark the sample as estimated; the footer then renders `~142 tok/s`.
2. **Wiring** in `~/.pi/agent/extensions/governance/index.ts`
   - Instantiate one tracker per process; register `message_start` / `message_update` / `message_end` handlers. On `message_update`, count delta characters for the fallback and throttle `tui.requestRender()` to ~10 Hz (footer re-render only; no extra timers).
   - Extend `FooterState` with `throughput: () => ThroughputSnapshot` so `footer.ts` stays a pure renderer; the footer factory hands back its `tui` so the handlers can request renders.
   - `message_end` forces one un-throttled render so the final numbers settle.
3. **Footer rendering** (`footer.ts`)
   - Append to the left group: `⚡<rate> tok/s` in accent while streaming (muted when it is the last completed call) plus `ttft <s>s`. Estimated values get a `~` prefix.
   - Idle: show the last completed call instead of nothing, muted, so a finished reply's rate stays readable until the next stream starts.
   - Formatting rules: rate `< 10` → one decimal; `ttft < 1000 ms` → `0.9s` (one decimal), else `1.2s`; hide the segment entirely before the first measured call and hide `ttft` when it is unknown (no streamed deltas).
   - Existing truncation path (`truncateToWidth` + gap) already keeps the line inside the terminal; verify at 60/80/120 columns.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/extensions/governance/throughput.ts` | new: tracker + formatting helpers (pure, injectable clock) |
| `~/.pi/agent/extensions/governance/throughput.test.ts` | new: unit tests |
| `~/.pi/agent/extensions/governance/footer.ts` | `FooterState.throughput`, render the `⚡ tok/s · ttft` segment |
| `~/.pi/agent/extensions/governance/index.ts` | tracker lifecycle + `message_*` handlers + throttled render |
| `~/.pi/agent/extensions/governance/README.md` | document the new footer segment |
| `~/.pi/setup/0012-footer-live-throughput.md` | this plan; status updates |

## Test plan

- [x] `node --experimental-strip-types throughput.test.ts` — TTFT = start→first delta; rate excludes TTFT; zero/missing usage doesn't divide by zero; per-message reset; `end()` uses `durationMs - ttftMs`; formatting (`1.0`/`0.9s`/estimate prefix).
- [x] `node --experimental-strip-types --check footer.ts index.ts throughput.ts` (syntax/parse check).
- [ ] Manual TUI check: long reply shows a rising rate, TTFT appears once, numbers settle and stay muted after the reply ends; short replies show a low rate and high TTFT (expected); 60/80/120-column terminals do not overflow; `/footer` off still restores pi's default footer.
- [x] Non-TUI sanity: `pi -p 'say hi'` produces no stdout/stderr noise from the new handlers.

Verified 2026-10-27: `throughput.test.ts` (11 cases) passes, `--check` is clean on the three files, and `pi -p 'say hi'` ran clean. The manual TUI check (live rate, muted idle, 60/80/120 columns) still needs a human at a terminal.

## Review outcome → two fix slices (2026-10-27)

Automated checks passed, but review found five must-fix issues. Rather than patching them in one pile, they are two small slices.

**Slice A — tracker semantics (`throughput.ts` + `throughput.test.ts` only; uncontested files, unit-testable).**
1. `start(at?: number)` accepts the real request-start timestamp.
2. `update()` records the first delta on the first `message_update` even while `usage.output` is still 0; `end()` keeps that TTFT when the count only arrives at the end.
3. `end()` applies `MIN_GEN_MS` to the final window (no 60 → 3000 tok/s snap) and never overwrites `last` with a zero/aborted sample.
4. `estimated` is true only when the final count really is an estimate.
5. New `effective` flag when no TTFT exists (non-streaming providers), so a TTFT-inclusive rate is never shown as a generation rate.
6. `formatRate` boundary: `9.96` renders `10`, not `10.0`.

**Slice B — wiring and rendering (`index.ts`, `footer.ts`, README), deferred until plan 0011 (permission friction) is committed** because both touch `index.ts`:
1. Anchor TTFT at `before_provider_request`, pass that timestamp into `start()`.
2. Count thinking text and tool-call argument JSON in the delta fallback (code points, not UTF-16 units) so thinking-heavy and tool-call-only messages show a live number instead of staying blank until `message_end`; reset `lastRenderAt` per stream.
3. Render `≈` for `effective` samples; abbreviate to `⚡142 · 1.2s` and move the segment ahead of `↑in ↓out` at narrow widths.

**Scope (resolved, D-0028):** the rate counts text + thinking + tool-call JSON, matching `usage.output` exactly; tool results (input-side) and nested tool usage are excluded; display stays per assistant message (live = streaming, idle = last completed), so a tool-heavy turn may leave a small tool-call rate on screen.

**Commit rule:** one commit per slice, landed only after hiemanshu tests it, and never mixed with the permission-friction work sharing the tree.

**Slice A status:** confirmed by hiemanshu (2026-10-27) after the 20-case suite and the `/tmp/slice-a-demo.ts` black-box output. Commit held until plan 0011 (permission friction) lands its own commit; the slice A commit stages exactly `agent/extensions/governance/throughput.ts` and `throughput.test.ts`.

## Risks

- **Mid-stream usage may be missing** for some providers → mitigated by the character-count fallback and the `~` prefix; if it is wrong, the number is labelled as an estimate rather than silently trusted.
- **Footer churn** on every delta can cost CPU on slow terminals → 10 Hz throttle, and no render at all when the footer is disabled or the mode is not TUI.
- **Multiple assistant messages per turn** (tool calls) → each message gets its own sample; the footer shows the current one so the last tool-call reply is what remains.
- **Rate spikes early in a stream** → 50 ms minimum generation window plus the `output > 0` guard.

## Open questions

None — resolved above; see D-0027 in `setup/decisions.md`.
