# Plan 0017 — first-use prompts for MCP tools

**Status:** implemented; step 4 (manual end-to-end) pending a pi restart
**Date:** 2026-10-31
**Depends on:** `0001-pi-agent-governance-setup.md`, `0016-permission-trust-rebalance.md`

**Changes in revision 2:** the requirement is now stated plainly — this is for every MCP server you add from here on, not for REA. The design was already server-agnostic; section "Why this is generic" makes that a constraint rather than a side effect, and adds the one place where generic parsing gets ambiguous (server names containing `__`).

## Progress log

- **Step 1 done.** `utils.ts`: `AllowRules` gained `mcp`, carried through `EMPTY_RULES`, `loadRules`, `saveRules` and `addRule`; new `matchMcpRule`, `mcpServerOf`, `mcpServerRule`, `MCP_TOOL_PREFIX`. A rule that doesn't start with `mcp__` never matches, so a stray `*` can't become a catch-all.
- **Step 1 verified.** New `mcp.test.ts` — 24 cases, all passing: exact vs server-wide matching, sibling and cross-server non-matches, the `mcp__rea__*` vs `mcp__reach__*` prefix collision, server derivation, name mangling, and the round-trip proving a later bash-rule save preserves `mcp` rules. `cache.test.ts` (8), `throughput.test.ts` (26) and `renderers.test.ts` still pass.
- **Pre-existing failure found, not caused here.** `classifier.test.ts` fails at its `isSafeBashCommand` case for `cd <path> && grep -n "x|y" src`. Reproduced against `HEAD` in a clean `git archive` checkout, so it predates this work. Recorded in the README rather than fixed quietly inside an unrelated piece.
- **Step 2 done.** `index.ts`: `askMcpPermission` (six options, server-wide first, argument preview, project/global scope), the `mcp__` branch in `handleMainCall` sitting between the allow check and the fail-closed block, and `tool_search` added to `MAIN_ALLOWED_TOOLS`. `codemode` deliberately stays blocked. Syntax verified by loading `index.ts` under `--experimental-strip-types` against stubs of the pi packages: the default export loads as a function.
- **Step 3 done.** `/permissions` renders an `mcp:` line per scope and names the rule forms; `README.md` documents the rule kind, the prompt behavior, and the new test file.

## Why

REA is installed and registered with pi, but it is unreachable. Two reasons, both in the governance extension:

1. `tool_search` — the only way to discover a `deferred` MCP server's tools — isn't in `MAIN_ALLOWED_TOOLS`, so it fails closed (`index.ts:586-595`).
2. Every `mcp__rea__*` call hits the same fail-closed branch, because `ALLOWED_MCP_PREFIXES` only lists `mcp__websearch__` (`index.ts:65`). The gate has no notion of prompting for MCP tools at all.

We can't fix this by prefix-allowing `mcp__rea__` the way websearch is allowed. That comment justifies itself with "read-only by construction" (`index.ts:60-64`), and REA is not: `execute_rizin_command` and `cutter_command` run arbitrary third-party commands in the REA process's security context, `push_adb_file`/`install_adb_package` write to attached devices, `start_frida_session`/`instrument_with_frida` instrument live processes, and `export_environment_bundle`/`extract_firmware` write files. Prefix-allowing the server would hand all of that an ungated path.

So the fix is what you asked for: **prompt on first use, then remember the answer** — per tool, or for a whole server, at project or global scope.

## Why this is generic

You'll add more MCP servers, and you don't want to hand-write a rule for each tool they bring. So the design must not name REA anywhere:

- The gate branches on `mcp__` as a prefix, derives the server from the tool name, and knows nothing about what a given server offers. Adding a server to `mcp.json` is enough to get prompts for it.
- No new hardcoded prefix entries. `mcp__websearch__` stays the only pre-approved server, and a future read-only server that deserves that treatment gets its own reviewed line rather than joining a catch-all.
- "Always allow all tools from `<server>`" is the escape hatch that stops a 229-tool server from interrupting you 229 times. One click, at project or global scope, and that server is quiet until you add another.
- Rules are stored as tool names, not as code, so a new server costs you zero file edits — at most one dialog.

**The one ambiguity:** pi builds tool names as `mcp__<server>__<tool>` with non-alphanumerics replaced by `_` (`pi/docs/mcp.md`), and tool names themselves contain underscores. So the server is taken as everything up to the second `__`, which is right for `mcp__rea__inspect_artifact` → `rea` and `mcp__dev_radius__tool_x` → `dev_radius`, but would mis-derive a server whose own name contains a double underscore. The saved rule is still a string prefix, so matching stays correct even then; only the dialog text and the suggested pattern could be wrong. I'd rather note that than guess at pi's internal server metadata.

### Prompt order

The dialog lists them roughly in order of usefulness, "allow once" first because it's the cautious default, then the server-wide grants — which is the option that makes a new server painless — then the single-tool grants.

## What changes

### 1. Rules learn about MCP tools (`utils.ts`)

`AllowRules` currently holds `write`, `bash`, `read` (`utils.ts:13-17`). Add `mcp: string[]`, carried through `EMPTY_RULES`, `loadRules` and `saveRules`. Rule forms:

- `mcp__rea__inspect_artifact` — that one tool.
- `mcp__rea__*` — every tool from the `rea` server.

New pure function `matchMcpRule(rule, tool)`: exact equality, or trailing-`*` prefix match. It lives in `utils.ts` beside `matchBashRule` so it's testable without pi.

**Careful detail:** `saveRules` normalizes to exactly `{write, bash, read}` today (`utils.ts:1231-1239`). Every save path must carry `mcp` or a later bash-rule save silently erases MCP grants. That's the highest-risk line in this plan and the reason step 1 is a separate tested piece.

### 2. The prompt (`index.ts`)

Add `askMcpPermission`, modelled on `askBashPermission` (`index.ts:395-460`), offering:

- Allow once
- Always allow all tools from `<server>` — global
- Always allow all tools from `<server>` — project
- Always allow this tool — global
- Always allow this tool — project
- Deny

The server-wide options sit above the single-tool ones on purpose: prompting 229 times is what makes people click "allow all" blindly, so the cheap way out should be the prominent one. The single-tool grants stay available for servers where one dangerous tool (`execute_rizin_command`) shouldn't drag the rest along.

The dialog title shows the tool name and a truncated preview of its input, so "allow" is an informed click rather than a blind one. Choices persist through the existing `saveRules(...)` path, visible afterwards in `/permissions`.

In `handleMainCall`, after the `powershell` branch and **before** the fail-closed check: if the tool name starts with `mcp__`, run the MCP flow — hardcoded prefixes (websearch) → project/global `mcp` rules → prompt → deny. No UI (`ctx.hasUI` false, e.g. subagents) means block with the existing remediation text, never allow.

### 3. `tool_search` becomes allowlisted

One line: add `tool_search` to `MAIN_ALLOWED_TOOLS`. It only loads deferred tool metadata for the next model call, which is read-only, and it's the gate's own suggested remedy for this class of block. **`codemode` stays blocked** — the extension deliberately excludes it because scripts can reach `bash`/`write` (`index.ts:60-64`), and that reasoning still holds.

### 4. Visibility and docs

`/permissions` renders a `mcp:` line per scope (`index.ts:742-750`), and `README.md` documents the new rule kind beside the bash/write examples.

## Non-goals

- Changing how websearch is allowed — it stays prefix-allowed, no prompts.
- Allowing `codemode`, or any automatic allow-if-the-server-is-known fallback. Default remains deny.
- Per-project MCP *server enablement* (that's `.pi/mcp.json`'s job, not the gate's).
- Touching the subagent gate: subagents can't prompt, so they stay fail-closed on MCP tools.
- Auditing what an allowed REA tool then does internally. `execute_rizin_command` remains a single approved call that can reach files and network — the prompt says so in its preview, but the gate won't decompose it.

## Steps

Each step ends with its own check.

1. **`utils.ts`: rule kind + matcher + tests.** Add `mcp` to `AllowRules`/`loadRules`/`saveRules`/`EMPTY_RULES`, add `matchMcpRule`, extend `classifier.test.ts` with: exact match, server-wide match, sibling-tool non-match, cross-server non-match (`mcp__rea__*` must not allow `mcp__other__x`), and a save-round-trip proving a bash-rule save preserves an existing `mcp` rule.
   **Check:** `node --experimental-strip-types ~/.pi/agent/extensions/governance/classifier.test.ts` passes, including the new cases.
2. **`index.ts`: prompt + branch + `tool_search`.** Add `askMcpPermission`, the `mcp__` branch in `handleMainCall`, and the allowlist line.
   **Check:** restart pi, trigger one read-only REA tool, see the prompt, choose "this tool — global", confirm the second call doesn't prompt and `permissions.json` gained the exact rule.
3. **Visibility.** `/permissions` shows `mcp:` rules; README documents them.
   **Check:** `/permissions` lists the rule created in step 2.
4. **End-to-end against a real target.** Call a read-only REA tool (e.g. `inspect_artifact`) on a PE copy, then attempt a non-granted command-shaped tool (`execute_rizin_command`) and confirm it still prompts.
   **Check:** first call runs, second prompts, and neither "allow all" choice leaks to a different server.

## Risks

- **Failure mode is over-permission, not friction.** A matcher bug that returns true too easily silently defeats the gate. Mitigation: matcher stays a pure function with tests on the exact boundaries, and there is no catch-all allow path.
- **The generic path is the trusting path.** Because the gate no longer knows what any given server does, "allow all from this server" is a genuine standing grant over tools nobody has reviewed. That's the price of not hand-writing rules per tool, and it's the right trade for your workflow — but it means the dialog's server-wide option should be chosen deliberately, not reflexively, for servers that can write or execute.
- **Rule-kind erosion.** `saveRules` rewriting the file is the one place an MCP grant can be lost or, if the merge is wrong, fabricated. Step 1 tests the round-trip explicitly.
- **A granted tool is a standing capability.** "Always allow `execute_rizin_command`" means arbitrary command execution without further prompts. The dialog must make the tool name and input visible; if that reads too broad, the narrow answer is to grant only `inspect_*` tools and leave the rest prompting.
- Requires a pi restart, not just `/reload`, since extensions load at startup.

## Open questions

1. **Decided: `tool_search` is allowlisted.** It only loads deferred tool metadata, and without it a `deferred` server cannot be reached at all.
2. **Decided: denials are not remembered.** A repeated block stays visible; a silent permanent one would not.
3. **Open after step 4:** whether the argument preview is enough to judge a destructive tool. `execute_rizin_command` shows its command string, but a long argument truncates at 240 characters. If that reads too thin in practice, raise the budget.
