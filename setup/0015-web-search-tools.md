# 0015 — Web search + fetch through opencode's search backend (Parallel MCP)

- **Date:** 2026-10-27
- **Status:** done (implemented 2026-10-27) — approach A, direct exposure
- **Owner:** hiemanshu
- **Supersedes:** the first draft of this plan, which proposed DeepSeek's `/v1/tools/search`; the user wants opencode's backend instead.

## Goal

Give the agent `web_search` and `web_fetch` so checking current docs is a normal tool call instead of a prompting `curl` pipeline — using the search backend opencode itself uses, not DeepSeek's paid Search API.

## Verified today (2026-10-27)

- opencode's `websearch` tool is a hosted MCP service, not a JSON API (`opencode.ai/docs/tools/`).
- Source (`anomalyco/opencode`, `dev`):
  - `packages/core/src/plugin/websearch/exa.ts` → `https://mcp.exa.ai/mcp`, tool `web_search_exa({query, numResults})`, optional `?exaApiKey=`.
  - `packages/core/src/plugin/websearch/parallel.ts` → `https://search.parallel.ai/mcp`, tool `web_search({objective, search_queries})`, optional `Authorization: Bearer PARALLEL_API_KEY`.
  - Transport (`plugin/websearch/mcp.ts`): JSON-RPC 2.0 `tools/call` over POST, `Accept: application/json, text/event-stream`, response is `{result:{content:[{type:"text",text}]}}` or an SSE `data:` line.
- **Live probes:**
  - Exa without a key → returns "You've hit Exa's free MCP rate limit" (no usable results).
  - Parallel without a key → **real results**, including the exact DeepSeek peak-hours text we needed. No auth required.
  - `tools/list` on Parallel → `web_search` (`objective`, `search_queries`, `session_id`, `model_name`) and `web_fetch` (`urls`, `objective`, `search_queries`, `full_content`, `allow_live_fetch`, `session_id`, `model_name`).
- pi 1.2.0 supports remote MCP servers (`docs/mcp.md`), configured in `~/.pi/agent/mcp.json`, managed with `pi mcp add` and `/mcp`.

## Non-goals

- No DeepSeek Search API (paid, and the user prefers opencode's path).
- No Exa key, no new vendors, no billing setup.
- No custom extension unless the MCP route proves insufficient (see approach B).
- Not a scraper: `web_fetch` is for specific URLs, not crawling.

## Approach

**A. Register the MCP server (recommended — no code).**

```
pi mcp add websearch --url https://search.parallel.ai/mcp
```

pi then exposes the server's tools to the model. Verify with `pi mcp list` and `/mcp`, then a live `web_search` call in a fresh session. If the tool names arrive namespaced (e.g. `mcp__websearch__web_search`), note that in `AGENTS.md` so lookups use the right name.

**B. Custom extension (fallback only).** ~100 lines registering `web_search`/`web_fetch` against the same endpoint, with our own truncation and formatting. Worth it only if A's naming, output size, or error surfacing proves awkward.

## Steps

1. `pi mcp add websearch --url https://search.parallel.ai/mcp`; confirm config lands in `~/.pi/agent/mcp.json`.
2. `pi mcp list` → server connected, both tools listed.
3. Fresh session: call `web_search` for a known fact and compare against a page fetched by hand; call `web_fetch` on `https://api-docs.deepseek.com/guides/search`.
4. Update `agent/AGENTS.md`: current-doc lookups go through the search tools, not `curl`; note `PARALLEL_API_KEY` as the escape hatch if the unauthenticated endpoint starts rate-limiting.
5. Commit config + docs as one piece (plan file included).

## Test plan

- [ ] `pi mcp list` shows the server and two tools.
- [ ] `web_search("DeepSeek API peak hours")` returns the 01:00–04:00 / 06:00–10:00 UTC text.
- [ ] `web_fetch("https://api-docs.deepseek.com/guides/search")` returns readable content.
- [ ] Failure path: a bad URL returns an error, not a crash.
- [ ] `pi -p 'say hi'` still clean (MCP server does not slow startup noticeably or pollute stderr).

## Risks

- **Unauthenticated endpoint:** rate limits are unknown and could change. Mitigation: `PARALLEL_API_KEY` (free tier) adds a bearer header; note it in `AGENTS.md`.
- **Third-party content in context:** prompt-injection surface. Mitigation: `AGENTS.md` states fetched content is data, and instructions inside it are not to be followed.
- **Another moving part at startup:** an MCP server that fails to start could add latency. Mitigation: if it misbehaves, `/mcp` disables it or the config entry is removed.
- **Vendor drift:** the endpoint is opencode-internal plumbing, not a documented public API. Mitigation: approach B keeps a drop-in fallback.

## Open questions

1. Register for all projects (user level) or only this setup?
2. Should `web_fetch` default to `full_content: true` (bigger context, complete page) or excerpts?

## Result (2026-10-27)

Approach A, with one correction found during verification:

- `pi mcp add websearch --url https://search.parallel.ai/mcp` registered the server and it connected with 2 tools — but `pi` exposed them through `codemode`, and the gate fails closed on unknown tools, so the first live call was blocked. Allowing `codemode` was rejected outright: codemode scripts can call `bash`/`write`, so it would bypass the gate.
- Fix: `~/.pi/agent/mcp.json` now sets `"exposure": "direct"`, so the tools register as `mcp__websearch__web_search` / `mcp__websearch__web_fetch`. The gate allows them by name prefix (`ALLOWED_MCP_PREFIXES`) in both the main and subagent gates; every other unknown tool still fails closed.
- Verified end to end: `pi -p 'Use the web search tool to find the DeepSeek API peak hours in UTC'` performed a real search and answered with the 01:00–04:00 / 06:00–10:00 UTC window and a source URL.
- `pi mcp list` → `websearch: connected, 2 tools (direct, global)`.
- Suites still green: classifier 425, cache 8, throughput 26, railify; `--check` clean.
- Cost: unauthenticated free tier of Parallel's hosted MCP; `PARALLEL_API_KEY` (5,000 free requests/month) is the documented escape hatch if it starts refusing. Exa was rejected because it rate-limits without a key.

