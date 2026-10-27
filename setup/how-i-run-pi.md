# Plan-first pi setup — bootstrap summary

A shareable overview of how this pi setup is configured. Built on **pi 1.2.x**. Everything lives in `~/.pi/`; no project code is modified.

## Design goals

1. **Plan first.** Every session starts read-only-ish: explore, ask questions, write a plan. Build only after approval.
2. **Build by delegation.** Source changes happen through subagents with explicit tool lists; the main session coordinates.
3. **Ask, don't assume.** Clarifying questions are batched with a `questionnaire` tool; the agent restates the task and waits.
4. **Durable memory.** Plans, decisions, and gotchas are files in the repo; setup notes live in `~/.pi/setup/`.
5. **Explicit consent.** Writes and non-read-only commands prompt. Approvals can be learned into allowlists. Truly dangerous commands need a human passcode.

## What's installed

```
~/.pi/agent/
├── AGENTS.md                      # global working agreement (loaded every session)
├── permissions.json               # global write allowlist (e.g. "~/.pi/")
├── extensions/
│   ├── governance/                # custom: plan mode, permission gate, scoping, TUI chrome
│   │   ├── index.ts               # tool_call gate, commands, lifecycle, prompts
│   │   ├── utils.ts               # command classifier, path scoping, allowlist matching
│   │   ├── footer.ts              # footer + working indicator
│   │   └── README.md
│   ├── subagent/                  # copied from pi examples + patched (see below)
│   │   ├── index.ts
│   │   └── agents.ts
│   └── questionnaire.ts           # copied from pi examples
├── agents/                        # subagent definitions (markdown + YAML frontmatter)
│   ├── scout.md  planner.md  reviewer.md
│   ├── worker.md  tester.md  documenter.md
└── prompts/                       # slash-command prompt templates
    ├── implement.md  scout-and-plan.md
    ├── implement-and-review.md  document.md
```

Per project:

```
<repo>/.pi/permissions.local.json  # project allowlist (gitignored)
<repo>/docs/plans/NNNN-slug.md     # plan files (project docs)
<repo>/docs/decisions.md           # decision log
<repo>/docs/notes/YYYY-MM-DD-*.md  # gotchas / lessons
```

Setup documentation about the agent itself goes in `~/.pi/setup/`, never in a project repo.

## Permission model (the `governance` extension)

Implemented with the `tool_call` hook: every tool call is classified before it runs.

### Main session — auto-allowed

- `read`, `grep`, `find`, `ls` — anywhere.
- **Writes only** in `<project>/docs/`, `~/.pi/setup/`, `/tmp`, and the OS temp dir. Writes anywhere else inside the project, and anywhere inside `~/.pi` outside `setup/`, are **hard-blocked** with a "delegate to `worker`" message (no passcode path).
- Read-only bash from a minimal safe list: `cat head tail grep ls eza pwd wc diff stat du df tree which whereis type printenv uname whoami id date ps jq`, `rg` (no `--pre`), `find`/`fd` (no `-exec/-delete/-fprint`), `git status|log|diff|show|branch --show-current|remote -v|config --get|ls-files|rev-parse|describe|blame|shortlog|stash list`, `npm list|view|info|search|outdated|audit`, `node|python3 --version`.
- `cd` into the project, `~/.pi`, the pi installation directory, `/tmp`, the OS temp dir, and configured `read` roots.
- Redirections whose target is a free-write root, `mkdir` into a free-write root, and non-recursive `rm` inside `/tmp` or the OS temp dir.
- The `questionnaire` tool.

`sed`, `awk`, `sort`, `uniq`, `curl`, `wget`, `less`, `file`, `echo`, and `printf` are **not** auto-allowed: each can write a file or execute code with a single flag or positional argument. They prompt; allowlist the specific form you trust.

### Main session — prompts

Every other write/edit, and every non-read-only command. Dialog offers: **allow once**, **remember this file/folder or exact command in the project**, **remember everywhere**, **deny**. Rules are stored in:

- `<project>/.pi/permissions.local.json` — project scope
- `~/.pi/agent/permissions.json` — global scope

Format:

```json
{
  "write": ["src/generated/", "/home/me/shared/notes/"],
  "bash": ["npm test", "git status *"],
  "read": ["~/other-repo/"]
}
```

Write rules are exact files or directories ending in `/`; relative paths resolve from the project root. `read` rules only extend bash `cd` trust (they never grant writes). Bash rules are exact commands or prefix rules ending in ` *`. Compound commands (`&&`, `;`, `|`) can only be remembered exactly, so an approval can't bless whatever is appended.

### Hard blocks

Never auto-approved, regardless of allowlists: `sudo`, shutdown/reboot, disk formatting, `dd if=`, pipe-to-shell, force push, `git reset --hard`, `git clean -fd`, package publish, fork bombs, `chmod 777 /`, and `rm -rf` targeting anything outside the project. Quoted forms are normalised first, so `git push "--force"` is still caught.

To allow one run, the user runs `/i-understand-the-danger`; it prints a one-time passcode (2 minutes, single use) that must be typed into the confirmation dialog. The model never sees the passcode.

### Subagents

Every launch requires one interactive confirmation showing agents, tool lists, tasks, and scope. The child process gets:

```
PI_GOVERNED_SUBAGENT=1
PI_SUBAGENT_ROOT=<the subagent's working directory>
PI_SUBAGENT_ALLOW_PATHS=["/explicit/extra/paths"]
```

The same extension runs inside the child and:

- allows reads/writes only inside that scope (`PI_SUBAGENT_ROOT` + `allowPaths`),
- blocks everything outside — **including reads** — and reports back,
- applies a persistent `bash` scope check: absolute paths, quoted paths, `cd` (including `cd --`), relative `../` paths, `--opt=value`, attached short-flag values, interpreters, and shell `-c` payloads are audited; unanalysable quoting fails closed,
- blocks dangerous commands outright (no UI to authorize them),
- cannot launch nested subagents,
- does **not** get the main-session plan-first text injected and runs with plan mode off, so a worker edits rather than delegates.

Bash scoping is best-effort, not a security boundary: stdin payloads into an interpreter (`… | bash`), unlisted executors, and absolute paths embedded inside a payload string are not audited. The precise gates are the `read`/`write`/`edit` tools. A determined command can still reach outside the scope; keep subagent launches explicit because every launch is a user-approved, project-scoped process.

If a task genuinely needs an outside path, the child reports it; the main session asks the user and re-launches with `allowPaths`, which is shown in the confirmation.

### Modes and commands

| Command | Effect |
|---|---|
| `/plan` | Toggle plan-first instructions (the gate stays active) |
| `/permissions` | Show project and global allowlists |
| `/footer` | Toggle the governance footer vs pi's default |
| `/i-understand-the-danger` | One-time passcode for one hard-blocked command |

Plan mode is on by default for every new session. The mode is persisted in the session transcript so resume keeps it.

## Workflow

1. **Clarify.** Batch questions with `questionnaire`; restate goal/scope/non-goals.
2. **Plan.** Write `docs/plans/NNNN-slug.md`: goal, context, non-goals, steps, files, test plan, risks, open questions, status (`draft` → `approved` → `in-progress` → `done`).
3. **Approve.** The user reviews and approves the plan file.
4. **Delegate.** `worker` implements → `tester` runs the suite → `reviewer` reviews the diff → `worker` fixes findings → `documenter` records outcomes.
5. **Record.** Decisions in `docs/decisions.md` (date, decision, alternatives, rationale); gotchas in `docs/notes/`.
6. **Verify.** Never skip tests; update the plan's status honestly.

The prompt templates `/implement`, `/scout-and-plan`, `/implement-and-review`, and `/document` wrap common chains.

## Agent roster

| Agent | Tools | Use for |
|---|---|---|
| `scout` | read, grep, find, ls, bash | fast recon, compressed context |
| `planner` | read, grep, find, ls | implementation plan from context |
| `reviewer` | read, grep, find, ls, bash | bugs/security review |
| `worker` | read, grep, find, ls, bash, edit, write | implementation and fixes |
| `tester` | read, grep, find, ls, bash | run tests/checks, report only |
| `documenter` | read, grep, find, ls, edit, write | plans/decisions/notes, never source |

Agent definitions omit `model`, so they inherit the session model. Explicit `tools` lists are important: subagents are launched with `--tools`, and a plain list replaces the default set (so `worker` must list `edit,write`).

## Replicating it

1. Install pi 1.2.x. Back up any existing `~/.pi`.
2. Copy `examples/extensions/questionnaire.ts` and `examples/extensions/subagent/` from pi's package into `~/.pi/agent/extensions/`. **Copy, don't symlink** into Homebrew's Cellar — that path changes on upgrade.
3. Patch `subagent/index.ts` in three places:
   - always confirm the launch when `ctx.hasUI`; block when there is no UI,
   - add an `allowPaths` array parameter and show it in the confirmation,
   - spawn with the `PI_GOVERNED_*` env vars above.
4. Add the `governance/` extension (the actual implementation; self-contained TypeScript using pi's extension API + `@earendil-works/pi-tui`).
5. Add `agents/`, `prompts/`, and `AGENTS.md`.
6. Create the allowlist files (empty is fine) and gitignore `.pi/permissions.local.json`.
7. Run `/reload` (or restart pi) and test:
   - write outside the project → blocked/prompted,
   - read-only `ls` → no prompt,
   - `sudo ...` → hard block; `/i-understand-the-danger` + passcode → allowed once,
   - subagent launch → confirmation with scope,
   - subagent reading outside the project → blocked.

The governance extension is the only non-trivial code (~500 lines across `index.ts`, `utils.ts`, `footer.ts`); the rest is configuration and markdown.

## Gotchas worth knowing

- **`cd` needs context.** A naive command classifier flags `cd <project>` as "unknown". Pass the project root into the classifier and treat `cd` into it as safe.
- **`2>&1` is not a write.** Strip stderr/stdout redirects before checking for output redirection, or every command fails safe.
- **Compound-command prefix rules are a footgun.** If `grep foo` is remembered as a prefix and the model runs `grep foo; rm ...`, the whole thing is allowed. Offer exact-match only for compound commands.
- **Subprocesses have no UI.** Any gate inside a subagent must fail closed. Pass scope explicitly via env; the parent is the only place a human can approve.
- **`--tools` replaces defaults.** Write-capable agents must list `edit,write` in their frontmatter.
- **Reload is required** after changing extensions, `AGENTS.md`, or resources. Allowlist files are re-read per call.
- **Tool path args vary:** handle both `path` and `file_path` for read/edit/write.
- **Keep the option strings in `ctx.ui.select` unique** — the code branches on the selected label.
- **Extension imports resolve** through pi's bundled modules; no local `package.json` needed.
- **Setup docs don't belong in repos** if the setup is global; keep one home (`~/.pi/setup/`).

## Security notes / known limits

- Bash scoping is best-effort: file tools are enforced precisely, but absolute paths and `cd` are heuristics. A determined command can still read outside the project.
- Trusting `~/.pi` means the agent can edit its own allowlists and extensions. That is intentional for a personal setup; remove the rule if you don't want it.
- Once a write-capable subagent is approved, it can modify anything inside the project without further prompts.
- There is no OS-level sandbox (pi's `sandbox` example exists but was not used).
- Hard-blocked commands can never be authorized from inside a subagent.

## Tuning knobs

- Hard-block list and read-only command patterns → `governance/utils.ts`.
- Trusted scopes → `isInside(cwd, abs)` check in `governance/index.ts`; global `~/.pi` rule → `~/.pi/agent/permissions.json`.
- Prompt copy / dialog options → `askWritePermission`, `askBashPermission`, `handleHardBlock` in `governance/index.ts`.
- Footer on/off → `/footer`; layout → `governance/footer.ts`.
- Plan-mode instructions → `PLAN_CONTEXT` in `governance/index.ts` and `~/.pi/agent/AGENTS.md`.
- Agent models → add a `model:` field to any agent file (currently omitted to inherit).

## Keeping the config in git

`~/.pi` is a private config repo. Track the portable config (`agent/AGENTS.md`, extensions, agents, prompts, themes, `settings.json`, `setup/`, `.gitignore`); **ignore and untrack** `agent/auth.json`, `agent/sessions/`, `agent/models-store.json`, `agent/permissions.json`, `agent/state/`, `agent/logs/`, and `.pi/permissions.local.json`. Auth is recreated per machine with `pi login`; sessions stay local.

On a new machine, clone the repo to `~/.pi` before pi creates it, then run `pi login`. Write allowlist rules accept a leading `~`, so a portable global rule can be `~/.pi/`; `permissions.json` itself stays local. Add a **private** remote only after the ignore list is in place — never push auth, sessions, or machine-local permissions.
