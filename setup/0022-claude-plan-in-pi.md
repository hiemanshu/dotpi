# 0022 — Spend the Claude Pro plan inside Pi

- **Status:** draft
- **Date:** 2026-11-05
- **Scope:** agent setup (`~/.pi/`)

## Goal

Use Opus through my Claude Pro subscription inside Pi, drawing on the plan's own
limits rather than the "extra usage" per-token ledger.

## Context

Pi's built-in Anthropic login (`/login anthropic`, "Anthropic (Claude Pro/Max)")
authenticates with the subscription, but its requests are billed as extra usage.
The Pi app already sends Claude Code's identity on OAuth requests — the system
prompt `You are Claude Code, Anthropic's official CLI for Claude.` and the betas
`claude-code-20250219` / `oauth-2025-04-20` (`pi.exe`, `buildParams` and
`getBetaFeatures`) — and it still warns that third-party harness usage bills per
token. The maintainer confirmed the position on 2026-07-23 in
[earendil-works/pi#6979](https://github.com/earendil-works/pi/issues/6979), closed
as not-planned: subscription use in third-party harnesses is only allowed via
extra credits.

So the route that actually reaches plan limits is not to imitate Claude Code's
HTTP calls but to *run* Claude Code. `pi-claude-bridge` registers Claude Code
(through Anthropic's own Agent SDK) as a Pi provider: Pi keeps its TUI, tools,
sessions and skills, and each model turn is executed by a real `claude`
subprocess. Anthropic's help center currently says third-party app and Agent SDK
usage still draws from subscription limits (June 15 2026 update on
`support.claude.com/en/articles/15036540`), which is what clients built on the
Agent SDK bill against.

Current machine state, checked before writing this:

- Pi 1.4.0; no packages installed (no `packages` key in `settings.json`).
- `~/.pi/agent/auth.json` has only `deepseek` (`api_key`).
- Anthropic OAuth is therefore **not** configured yet — the bridge reads Pi's
  credential, not Claude Code's login.
- `claude` 2.1.317 is on `PATH` via the mise shim
  (`~/AppData/Local/mise/shims/claude.exe`).
- No `ANTHROPIC_*` environment variables are set, so the bridge's known
  env-override failure (issue #107) does not apply. Keep it that way.

## Non-goals

- Not the `@adeildo/pi-providers` route that presents Pi to Anthropic as Claude
  Code while still speaking the raw Messages API. That is the thing Pi's own
  warning is about, and its ToS position is what the bridge avoids by running
  Anthropic's harness for real.
- Not enabling 1M-context models that bill extra usage. `longContextExtraUsage`
  stays `false`.
- Not a Claude Code feature port. `AskClaude`, Claude Code hooks, auto-memory and
  MCP passthrough stay at their defaults unless something needs them.
- Not touching the `deepseek` default; this adds a provider, it does not replace
  the default model.

## Steps

1. Write this plan.
2. Install `pi-claude-bridge` (0.9.1, elidickinson, MIT, ~74K downloads/month)
   with `pi install npm:pi-claude-bridge`.
3. `/login anthropic` in Pi, browser flow, with the Claude account that holds the
   Pro plan. This writes the OAuth credential the bridge consumes and refreshes.
4. Write `~/.pi/agent/claude-bridge.json` with `{"provider": {"plan": "pro"}}` so
   Opus 4.6 stays at 200K instead of advertising 1M it cannot serve on Pro.
5. Pick a model with `/model` (`claude-bridge/claude-opus-*`) and run one short
   session to prove the path works end to end.
6. Read `claude.ai/settings/usage` before and after that session: the plan's
   session/weekly window should move and extra usage should not. This is the
   measurement the whole plan turns on.
7. Record the outcome in `~/.pi/setup/decisions.md`, and a note if anything
   surprised us.

## Files

- `~/.pi/setup/0022-claude-plan-in-pi.md` (this plan)
- `~/.pi/agent/settings.json` — gains a `packages` entry from `pi install`
- `~/.pi/agent/auth.json` — gains an `anthropic` OAuth credential
- `~/.pi/agent/claude-bridge.json` — new, `provider.plan`

## Test plan

- `pi --list-models` shows `claude-bridge/*` models after the install.
- One interactive turn on Opus succeeds, with a tool call (a `read` or `ls`) to
  prove Pi's tools are bridged rather than Claude Code's own.
- `claude.ai/settings/usage`: plan window consumed, extra usage unchanged. If the
  opposite happens, the bridge is not reaching the plan on this account and the
  plan stops there rather than being worked around.
- Model list sanity: Opus 4.6 shows 200K, not 1M.

## Risks

- **Anthropic changes the billing rule.** They announced an Agent SDK billing
  change in April 2026, then paused it on June 15 2026. If they unpause, this
  bridge's traffic moves to extra usage. The usage page is the check, not the
  README.
- **Prompt-capture failures.** The bridge rebuilds Claude Code's system prompt
  from Pi's; other extensions that rewrite the system prompt can break it. There
  is a Windows 11 report on 0.9.1 (Pi 1.0.0, `gentle-pi`, `gentle-engram`, MCP
  extension) of exactly this. Our extension set is small — `blocky`,
  `governance`, `questionnaire`, `subagent` — but if turns start failing with a
  prompt mismatch, disable extensions one at a time rather than editing the
  bridge.
- **Cache misses cost plan quota.** A session rebuild re-sends the conversation
  and usually misses the prompt cache. On a Pro plan that eats the 5-hour window
  faster than Claude Code would; avoid abort-heavy sessions.
- **Windows executable resolution.** The Agent SDK bundles a native `claude.exe`;
  if it cannot find one, `pathToClaudeCodeExecutable` points at the mise shim.
- **Model coverage on Pro.** Fable is not included in Pro without extra usage.
  Opus 4.7/4.8/5 and Sonnet 5 are. Worth knowing before blaming the bridge for a
  refused model.

## Open questions

- Does the Pro plan we actually hold have extra usage enabled? If it does, extra
  usage is a silent fallback and the usage page will only show it after the fact.
- Are `blocky`/`subagent` rewriting the system prompt in a way that trips
  prompt-capture? Unknown until the first turns run.
