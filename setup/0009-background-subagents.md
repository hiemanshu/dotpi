# 0009 — Background subagent jobs

- **Date:** 2026-10-22
- **Status:** done (manual TUI check pending)
- **Owner:** hiemanshu

## Goal

Let the user keep chatting while subagents run. A background launch returns immediately, a persistent widget tracks running/queued jobs, and the result posts automatically when the job finishes.

## Context

- The existing `subagent` tool awaits `runSingleAgent`; the parent turn stays busy until the child exits.
- `runSingleAgent` already handles spawn, streaming callbacks, output parsing, and abort signals. Background mode can reuse it without refactoring the child process.
- User choices: result + auto-turn; one job per agent name (worker, reviewer, tester, scout, planner, documenter can run together); persistent widget; kill children on quit.

## Decisions

1. **New `background: true` parameter** on the `subagent` tool. Single-agent mode only (`agent` + `task`); parallel/chain stay foreground.
2. **One job per agent name, with a queue.** Different agents run concurrently; a second job for a busy agent waits in its queue and starts when the slot frees.
3. **Persistence:** the tool returns `Started background <agent> job #N` (or `Queued …`) immediately. The child keeps the governance scope and headless permission behavior.
4. **Widget:** a persistent `aboveEditor` widget shows up to five jobs: `⚙ agent #id mm:ss · last streamed line`, or `⏳ agent #id queued`. A one-second ticker refreshes elapsed time.
5. **Completion:** the extension injects a `subagent-result` custom message with the final output (capped at 50 KiB) and calls `sendMessage(..., { triggerTurn: true })` so the main agent summarizes/continues automatically.
6. **Cancellation:** `/jobs` lists jobs; `/jobs cancel <id|all>` aborts a running child or drops a queued job. `/jobs` is also the escape hatch if the widget is hidden.
7. **Lifecycle:** `session_shutdown` aborts every child and clears queues/state. Results can only be delivered while the parent pi process is alive.
8. **Last streamed line:** the widget updates from the child's `onUpdate` callback; the transcript does not duplicate the child's streaming output.

## Files

| File | Change |
|---|---|
| `~/.pi/agent/extensions/subagent/index.ts` | background param, job map/queues, widget, result injection, `/jobs` |
| `~/.pi/agent/extensions/subagent/README.md` | background usage and limits |
| `setup/0009-background-subagents.md` | this plan |
| `setup/decisions.md` | D-0024 |

## Test plan

- [x] `node --experimental-strip-types --check subagent/index.ts`.
- [x] Fresh `pi -p` load with empty stderr.
- [ ] Manual: `subagent({ agent: "worker", task: "...", background: true })` returns immediately; the widget appears.
- [ ] Manual: chat and run another read-only agent while the worker runs.
- [ ] Manual: launch a second worker; it queues and starts after the first.
- [ ] Manual: on completion, the result message appears and the main agent gets an automatic turn.
- [ ] Manual: `/jobs` lists; `/jobs cancel <id>` stops a running child.
- [ ] Manual: `/quit` while a job runs; the child is killed.

## Risks

- **Only while pi runs:** closing the process loses pending results; children are killed intentionally.
- **File conflicts:** different job types can still touch overlapping files (e.g. a worker and documenter editing docs). The launch confirmation shows the task; avoid overlapping scopes.
- **Auto-turn cost:** every completed job triggers a model turn. This is the user's choice; use `/jobs cancel` for unwanted work.
- **Reloads:** a `/reload` replaces the extension runtime; in-flight jobs from the old runtime may be aborted by session shutdown, but this is not guaranteed. Quit/restart if jobs look orphaned.
- **One per agent, not one total:** six different agents can run together. The per-agent slot is the safety cap because only one `worker` edits code at a time.
