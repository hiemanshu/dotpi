---
description: Document the current work into docs/ via the documenter agent
---
Use the subagent tool with the documenter agent to capture this work: $@

Give the documenter everything it needs, since it cannot see this conversation:
- the goal and current status
- what changed (exact file paths) and what was verified
- key decisions, alternatives considered, and rationale
- gotchas or surprises worth remembering
- open questions

Ask it to update the relevant `docs/plans/` file status, append to `docs/decisions.md` where a decision was made, and write a note under `docs/notes/` for anything worth not rediscovering. Keep edits to docs/ only.
