/**
 * Governance extension — plan-first mode with layered permissions.
 *
 * Defaults:
 *   - Every session starts in plan mode.
 *   - Writes anywhere inside the current project are pre-approved (source included).
 *   - ~/.pi is writable from any project via the global allowlist.
 *   - Any other write/edit and any non-read-only bash command asks the user.
 *     Approvals can be remembered in the project allowlist
 *     (<project>/.pi/permissions.local.json) or the global allowlist
 *     (<agent-dir>/permissions.json).
 *   - A small never-allow list is hard-blocked. The user can authorize a single
 *     run with the one-time passcode from /i-understand-the-danger.
 *   - Subagent processes (env PI_GOVERNED_SUBAGENT=1) are scoped to their
 *     working directory plus explicit extra paths approved at launch time.
 *     They cannot prompt, so out-of-scope actions fail closed.
 */

import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AllowRules,
	addRule,
	bashPathsAllInsideRoots,
	bashScopeEscape,
	dangerousReason,
	displayPath,
	homeRelative,
	isInside,
	isCompoundCommand,
	isSafeBashCommand,
	loadRules,
	matchBashRule,
	matchWriteRule,
	resolveFromCwd,
	saveRules,
} from "./utils.ts";
import { applyWorkingIndicator, installGovernanceFooter, installGovernanceTitleBar } from "./footer.ts";
import { installBlockRenderers, installUserMessageRail } from "./renderers.ts";

const PASSCODE_TTL_MS = 2 * 60 * 1000;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

const PLAN_CONTEXT = `[PLAN MODE ACTIVE — user's default plan-first mode]

Working rules for this session:
- Read and explore freely. Allowlisted read-only shell commands run without asking.
- Ask clarifying questions BEFORE proposing work. Use the questionnaire tool to batch them; never silently assume. When something is ambiguous, ask.
- Non-trivial work needs a plan file under docs/ (default: docs/plans/NNNN-slug.md, unless the repo has a different convention). Include goal, context, non-goals, steps, files to touch, test plan, risks, open questions, and status.
- Record important decisions in docs/decisions.md (or the repo's convention): date, decision, alternatives considered, rationale. Record gotchas in docs/notes/ so they are not rediscovered.
- Writes anywhere inside the current project are pre-approved (source included). ~/.pi is allowed from any project. Any other file write, and any non-read-only shell command, requires explicit user approval per call. If the user denies, ask for direction — do not retry or work around the gate.
- Do not edit source code in this session. Delegate implementation to subagents (worker, tester, reviewer, documenter). Every subagent launch requires explicit user confirmation.
- Never attempt to evade the permission system (shell redirection, encoding tricks, alternative tools). Hard-blocked commands need the user's one-time passcode from /i-understand-the-danger.
- Before executing an approved plan, restate the goal and step list in chat.`;

interface Passcode {
	code: string;
	expiresAt: number;
}

function globalRulesPath(): string {
	return path.join(getAgentDir(), "permissions.json");
}

function projectRulesPath(cwd: string): string {
	return path.join(cwd, ".pi", "permissions.local.json");
}

function loadGlobalRules(): AllowRules {
	return loadRules(globalRulesPath());
}

function loadProjectRules(cwd: string): AllowRules {
	return loadRules(projectRulesPath(cwd));
}

function pathFromInput(input: Record<string, unknown>): string | null {
	const p = input.path ?? input.file_path;
	return typeof p === "string" && p.length > 0 ? p : null;
}

function subagentRoots(): string[] {
	const roots: string[] = [];
	if (process.env.PI_SUBAGENT_ROOT) roots.push(path.resolve(process.env.PI_SUBAGENT_ROOT));
	try {
		const extra = JSON.parse(process.env.PI_SUBAGENT_ALLOW_PATHS ?? "[]") as unknown;
		if (Array.isArray(extra)) {
			for (const p of extra) if (typeof p === "string" && p.length > 0) roots.push(path.resolve(p));
		}
	} catch {
		/* ignore malformed env */
	}
	return roots;
}

function isOutsideSubagentScope(p: string): boolean {
	const roots = subagentRoots();
	return roots.length === 0 || !roots.some((root) => isInside(root, p));
}

export default function governanceExtension(pi: ExtensionAPI): void {
	let planMode = true;
	let passcode: Passcode | null = null;
	let footerEnabled = true;
	let footerInstalled = false;
	let titleEnabled = true;
	let titleInstalled = false;
	let userRailEnabled = true;

	installBlockRenderers(pi);
	installUserMessageRail(pi, () => userRailEnabled);

	// -----------------------------------------------------------------------
	// Mode helpers
	// -----------------------------------------------------------------------

	function modeLabel(): string {
		return planMode ? "⏸ plan" : "▶ governed";
	}

	function passcodeActive(): boolean {
		return passcode !== null && Date.now() < passcode.expiresAt;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const badge = planMode ? ctx.ui.theme.fg("warning", "⏸ plan") : ctx.ui.theme.fg("accent", "▶ governed");
		const key = passcodeActive() ? ctx.ui.theme.fg("warning", "🔑") : "";
		ctx.ui.setStatus("governance", key ? `${badge} ${key}` : badge);
	}

	function setupFooter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (footerEnabled && !footerInstalled) {
			installGovernanceFooter(ctx, () => ({ planMode, passcodeActive: passcodeActive() }));
			footerInstalled = true;
		} else if (!footerEnabled && footerInstalled) {
			ctx.ui.setFooter(undefined);
			footerInstalled = false;
		}
	}

	function setupTitleBar(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (titleEnabled && !titleInstalled) {
			installGovernanceTitleBar(ctx, () => ({ planMode, passcodeActive: passcodeActive() }));
			titleInstalled = true;
		} else if (!titleEnabled && titleInstalled) {
			ctx.ui.setWidget("governance-title", undefined);
			titleInstalled = false;
		}
	}

	function setupThinking(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHiddenThinkingLabel("Thinking… click to show");
	}

	function persist(): void {
		pi.appendEntry("governance-mode", { planMode });
	}

	// -----------------------------------------------------------------------
	// Custom natural-language rules
	// -----------------------------------------------------------------------

	type CustomDirective =
		| { action: "allow" }
		| { action: "deny" }
		| { action: "add"; scope: "project" | "global"; pattern: string };

	function parseCustomDirective(raw: string): CustomDirective | { error: string } {
		let text = raw.trim().replace(/[.!?]+$/, "");
		if (!text) return { error: "Nothing entered." };
		const lower = text.toLowerCase();

		if (/^(deny|no|block|reject)\b/.test(lower)) return { action: "deny" };
		if (/^(allow once|once|just this time|this time)\b/.test(lower)) return { action: "allow" };

		let scope: "project" | "global" = "project";
		if (/\b(everywhere|globally|global|all projects|any project|every project)\b/.test(lower)) scope = "global";
		else if (/\b(project|repo|repository|here)\b/.test(lower)) scope = "project";

		text = text
			.replace(/^\s*(oh[,\s]+)?(please\s+)?(always\s+)?(allow|remember|add|permit)\s+/i, "")
			.replace(
				/\s+(everywhere|globally|global|all projects|any project|every project|in this project|for this project|this project|in this repo|for this repo|this repo|this repository|here)\s*$/i,
				"",
			)
			.trim();
		if (!text) return { error: 'No rule found. Try: "always allow git status everywhere".' };
		return { action: "add", scope, pattern: text };
	}

	// -----------------------------------------------------------------------
	// Permission prompts
	// -----------------------------------------------------------------------

	async function askWritePermission(
		ctx: ExtensionContext,
		absPath: string,
		cwd: string,
	): Promise<{ block: true; reason: string } | undefined> {
		const rel = displayPath(absPath, cwd);
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `⛔ BLOCKED · write outside project\nPath: ${rel}\nNo UI for approval; do not retry — report to the user.`,
			};
		}

		const dirRel = path.dirname(rel);
		const projectDirPattern = dirRel === "." ? `${rel}/` : `${dirRel}/`;
		const globalDirPattern = `${path.dirname(absPath)}${path.sep}`;
		const globalDisplay = homeRelative(globalDirPattern);
		const projectName = path.basename(cwd) || cwd;

		const allowOnce = "Allow once";
		const fileProject = `Always allow this file (project): ${rel}`;
		const dirProject = `Always allow this folder (project): ${projectDirPattern}`;
		const dirGlobal = `Always allow this folder (everywhere): ${globalDisplay}`;
		const custom = "✎ Type a custom rule…";
		const deny = "Deny";
		const options = [allowOnce, fileProject, dirProject, dirGlobal, custom, deny];

		const saveRule = (scope: "project" | "global", pattern: string): void => {
			const rules = scope === "global" ? loadGlobalRules() : loadProjectRules(cwd);
			addRule(rules, "write", pattern);
			saveRules(scope === "global" ? globalRulesPath() : projectRulesPath(cwd), rules);
			ctx.ui.notify(`✔ Allowlisted write (${scope}): ${pattern}`, "info");
		};

		while (true) {
			const choice = await ctx.ui.select(
				`${modeLabel()} · Write approval\n\n${rel}\n\noutside ${projectName}`,
				options,
			);

			if (choice === allowOnce) return undefined;
			if (choice === fileProject) {
				saveRule("project", rel);
				return undefined;
			}
			if (choice === dirProject) {
				saveRule("project", projectDirPattern);
				return undefined;
			}
			if (choice === dirGlobal) {
				saveRule("global", globalDisplay);
				return undefined;
			}

			if (choice === custom) {
				const text = await ctx.ui.input("Custom allow rule", "e.g. always allow this folder everywhere");
				if (text === undefined) continue;

				const parsed = parseCustomDirective(text);
				if ("error" in parsed) {
					ctx.ui.notify(parsed.error, "error");
					continue;
				}
				if (parsed.action === "allow") return undefined;
				if (parsed.action === "deny") break;
				if (/\bthis (command|pattern)\b/i.test(parsed.pattern)) {
					ctx.ui.notify("That rule applies to commands, not file writes.", "error");
					continue;
				}

				let pattern = parsed.pattern;
				if (/\bthis (folder|directory)\b/i.test(pattern)) {
					pattern = parsed.scope === "global" ? globalDisplay : projectDirPattern;
				} else if (/\bthis file\b/i.test(pattern)) {
					pattern = parsed.scope === "global" ? homeRelative(absPath) : rel;
				}
				pattern = pattern.replace(/^(['"])(.*)\1$/, "$2");
				saveRule(parsed.scope, pattern);

				if (matchWriteRule(pattern, absPath, cwd)) return undefined;
				ctx.ui.notify("Rule saved, but it does not cover this path. Choose again.", "warning");
				continue;
			}

			break;
		}

		return {
			block: true,
			reason: `⛔ DENIED · write\nPath: ${rel}\nThe user declined. Ask for direction; do not retry.`,
		};
	}

	async function askBashPermission(
		ctx: ExtensionContext,
		command: string,
		cwd: string,
		note?: string,
	): Promise<{ block: true; reason: string } | undefined> {
		const normalized = command.trim().replace(/\s+/g, " ");
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `⛔ BLOCKED · command approval\n$ ${normalized}\nNo UI for approval; do not retry — report to the user.`,
			};
		}

		const isCompound = isCompoundCommand(command);
		const tokens = normalized.split(" ");
		const prefixPattern = !isCompound && tokens.length > 2 ? `${tokens.slice(0, 2).join(" ")} *` : undefined;

		const allowOnce = "Allow once";
		const exactProject = `Always allow exact (project): ${normalized}`;
		const prefixProject = prefixPattern ? `Always allow pattern (project): ${prefixPattern}` : undefined;
		const prefixGlobal = prefixPattern ? `Always allow pattern (everywhere): ${prefixPattern}` : undefined;
		const custom = "✎ Type a custom rule…";
		const deny = "Deny";

		const options = [
			allowOnce,
			exactProject,
			...(prefixProject ? [prefixProject] : []),
			...(prefixGlobal ? [prefixGlobal] : []),
			custom,
			deny,
		];

		const saveRule = (scope: "project" | "global", pattern: string): void => {
			const rules = scope === "global" ? loadGlobalRules() : loadProjectRules(cwd);
			addRule(rules, "bash", pattern);
			saveRules(scope === "global" ? globalRulesPath() : projectRulesPath(cwd), rules);
			ctx.ui.notify(`✔ Allowlisted command (${scope}): ${pattern}`, "info");
		};

		while (true) {
			const choice = await ctx.ui.select(
				`${modeLabel()} · Command approval${note ? `\n(${note})` : ""}\n\n$ ${normalized}`,
				options,
			);

			if (choice === allowOnce) return undefined;
			if (choice === exactProject) {
				saveRule("project", normalized);
				return undefined;
			}
			if (prefixProject && choice === prefixProject) {
				saveRule("project", prefixPattern as string);
				return undefined;
			}
			if (prefixGlobal && choice === prefixGlobal) {
				saveRule("global", prefixPattern as string);
				return undefined;
			}

			if (choice === custom) {
				const text = await ctx.ui.input("Custom allow rule", "e.g. always allow git status everywhere");
				if (text === undefined) continue;

				const parsed = parseCustomDirective(text);
				if ("error" in parsed) {
					ctx.ui.notify(parsed.error, "error");
					continue;
				}
				if (parsed.action === "allow") return undefined;
				if (parsed.action === "deny") break;
				if (/\bthis (file|folder|directory)\b/i.test(parsed.pattern)) {
					ctx.ui.notify("That rule applies to file writes, not commands.", "error");
					continue;
				}

				let pattern = parsed.pattern.replace(/^(['"])(.*)\1$/, "$2");
				if (/\bthis (command|exact command)\b/i.test(pattern)) {
					pattern = normalized;
				} else if (/\bthis (pattern|command pattern)\b/i.test(pattern)) {
					pattern = prefixPattern ?? normalized;
				}
				if (!pattern.endsWith("*")) pattern = `${pattern} *`;
				saveRule(parsed.scope, pattern);

				if (matchBashRule(pattern, normalized)) return undefined;
				ctx.ui.notify("Rule saved, but it does not cover this command. Choose again.", "warning");
				continue;
			}

			break;
		}

		return {
			block: true,
			reason: `⛔ DENIED · command\n$ ${normalized}\nThe user declined. Ask for direction; do not retry.`,
		};
	}

	async function handleHardBlock(
		ctx: ExtensionContext,
		command: string,
		reason: string,
	): Promise<{ block: true; reason: string } | undefined> {
		const header = `⛔ HARD BLOCK · ${reason}`;
		if (!ctx.hasUI) {
			return { block: true, reason: `${header}\n$ ${command}\nNo UI; this cannot be approved here. Do not retry.` };
		}
		if (!passcodeActive()) {
			return {
				block: true,
				reason: `${header}\n$ ${command}\nThe user must run /i-understand-the-danger and enter the one-time passcode first. Do not retry before then.`,
			};
		}

		const entered = await ctx.ui.editor(
			`${header}\n\n$ ${command}\n\nEnter the one-time passcode from /i-understand-the-danger to run this ONCE. Escape cancels.`,
			"",
		);
		if (entered && passcode && entered.trim().toUpperCase() === passcode.code) {
			passcode = null;
			updateStatus(ctx);
			ctx.ui.notify("🔑 Passcode accepted — running once.", "warning");
			return undefined;
		}
		return { block: true, reason: `${header}\nPasscode not accepted; command blocked.` };
	}

	// -----------------------------------------------------------------------
	// Main-session gate
	// -----------------------------------------------------------------------

	async function handleMainCall(
		tool: string,
		input: Record<string, unknown>,
		ctx: ExtensionContext,
	): Promise<{ block: true; reason: string } | undefined> {
		const cwd = ctx.cwd;

		if (READ_TOOLS.has(tool)) return undefined;
		if (tool === "subagent" || tool === "questionnaire") return undefined;
		if ((tool === "ask" || tool === "confirm") && ctx.hasUI) return undefined;

		if (tool === "edit" || tool === "write") {
			const p = pathFromInput(input);
			if (!p) return { block: true, reason: "Blocked: write call without a target path." };
			const abs = resolveFromCwd(p, cwd);

			// D-0009: the whole current project is trusted for writes. Source edits
			// stay delegated by workflow convention, not by the gate.
			if (isInside(cwd, abs)) return undefined;

			const project = loadProjectRules(cwd);
			const global = loadGlobalRules();
			if (
				project.write.some((rule) => matchWriteRule(rule, abs, cwd)) ||
				global.write.some((rule) => matchWriteRule(rule, abs, cwd))
			) {
				return undefined;
			}
			return askWritePermission(ctx, abs, cwd);
		}

		if (tool === "bash") {
			const command = typeof input.command === "string" ? input.command : "";
			if (!command.trim()) return { block: true, reason: "Blocked: empty bash command." };

			const reason = dangerousReason(command, cwd, [path.resolve(getAgentDir(), "..")]);
			if (reason) return handleHardBlock(ctx, command, reason);

			let cwdNote: string | undefined;
			if (typeof input.cwd === "string" && input.cwd.length > 0) {
				const requested = resolveFromCwd(input.cwd, cwd);
				if (!isInside(cwd, requested)) cwdNote = `requested cwd: ${requested}`;
			}

			if (!cwdNote && isSafeBashCommand(command, cwd)) return undefined;

			// Commands whose absolute paths all live inside the pi config root are
			// trusted, matching the global write allowlist for ~/.pi.
			if (!cwdNote && bashPathsAllInsideRoots(command, [path.resolve(getAgentDir(), "..")])) return undefined;

			const project = loadProjectRules(cwd);
			const global = loadGlobalRules();
			if (
				!cwdNote &&
				(project.bash.some((rule) => matchBashRule(rule, command)) ||
					global.bash.some((rule) => matchBashRule(rule, command)))
			) {
				return undefined;
			}

			if (cwdNote) return askBashPermission(ctx, command, cwd, cwdNote);
			return askBashPermission(ctx, command, cwd);
		}

		return undefined;
	}

	// -----------------------------------------------------------------------
	// Subagent gate (fail closed; no UI available)
	// -----------------------------------------------------------------------

	function handleSubagentCall(
		tool: string,
		input: Record<string, unknown>,
	): { block: true; reason: string } | undefined {
		const cwd = process.env.PI_SUBAGENT_ROOT ?? process.cwd();
		const scopeNote =
			"Subagents are scoped to the project directory. The parent session must ask the user and re-launch with allowPaths for outside access.";

		if (tool === "subagent") {
			return { block: true, reason: `Nested subagent launches are blocked. ${scopeNote}` };
		}

		if (tool === "edit" || tool === "write") {
			const p = pathFromInput(input);
			if (!p) return { block: true, reason: `Blocked: write call without a target path. ${scopeNote}` };
			const abs = resolveFromCwd(p, cwd);
			if (isOutsideSubagentScope(abs)) {
				return { block: true, reason: `Blocked: ${displayPath(abs, cwd)} is outside the approved scope. ${scopeNote}` };
			}
			return undefined;
		}

		if (tool === "bash") {
			const command = typeof input.command === "string" ? input.command : "";
			if (!command.trim()) return { block: true, reason: "Blocked: empty bash command." };

			const danger = dangerousReason(command, cwd);
			if (danger) {
				return {
					block: true,
					reason: `HARD BLOCK (${danger}): ${command}\nDangerous commands cannot be authorized from a subagent. Report back and let the user run it.`,
				};
			}
			const escape = bashScopeEscape(command, cwd);
			if (escape) return { block: true, reason: `Blocked: ${escape}. ${scopeNote}` };
			return undefined;
		}

		if (READ_TOOLS.has(tool)) {
			const p = pathFromInput(input);
			const target = p ? resolveFromCwd(p, cwd) : cwd;
			if (isOutsideSubagentScope(target)) {
				return {
					block: true,
					reason: `Blocked: ${displayPath(target, cwd)} is outside the approved scope (even reads need a grant). ${scopeNote}`,
				};
			}
		}

		return undefined;
	}

	pi.on("tool_call", async (event, ctx) => {
		const input = (event.input ?? {}) as Record<string, unknown>;
		if (process.env.PI_GOVERNED_SUBAGENT === "1") {
			return handleSubagentCall(event.toolName, input);
		}
		return handleMainCall(event.toolName, input, ctx);
	});

	// -----------------------------------------------------------------------
	// Mode lifecycle
	// -----------------------------------------------------------------------

	pi.registerFlag("plan", {
		description: "Start in plan mode (default: on)",
		type: "boolean",
		default: true,
	});

	pi.registerCommand("plan", {
		description: "Toggle plan-first governed mode",
		handler: async (_args, ctx) => {
			planMode = !planMode;
			updateStatus(ctx);
			applyWorkingIndicator(ctx, planMode);
			persist();
			ctx.ui.notify(
				planMode
					? "Plan mode ON — code writes stay gated; delegate to subagents."
					: "Plan mode OFF — same gate, but plan-first instructions are off.",
				"info",
			);
		},
	});

	pi.registerCommand("permissions", {
		description: "Show project and global allowlists",
		handler: async (_args, ctx) => {
			const project = loadProjectRules(ctx.cwd);
			const global = loadGlobalRules();
			const render = (label: string, rules: AllowRules, file: string) =>
				[
					`${label} (${displayPath(file, ctx.cwd)}):`,
					`  write: ${rules.write.length > 0 ? rules.write.join(", ") : "(none)"}`,
					`  bash:  ${rules.bash.length > 0 ? rules.bash.join(", ") : "(none)"}`,
				].join("\n");
			ctx.ui.notify(
				[
					render("Project", project, projectRulesPath(ctx.cwd)),
					render("Global", global, globalRulesPath()),
					`Read-only tools, the current project tree, and ~/.pi are always allowed.`,
				].join("\n\n"),
				"info",
			);
		},
	});

	pi.registerCommand("footer", {
		description: "Toggle the governance footer",
		handler: async (_args, ctx) => {
			footerEnabled = !footerEnabled;
			setupFooter(ctx);
			ctx.ui.notify(footerEnabled ? "Governance footer on." : "Default footer restored.", "info");
		},
	});

	pi.registerCommand("header", {
		description: "Toggle the opencode-style title bar",
		handler: async (_args, ctx) => {
			titleEnabled = !titleEnabled;
			setupTitleBar(ctx);
			ctx.ui.notify(titleEnabled ? "Title bar on." : "Title bar hidden.", "info");
		},
	});

	pi.registerCommand("user-rail", {
		description: "Toggle the left rail on user messages",
		handler: async (_args, ctx) => {
			userRailEnabled = !userRailEnabled;
			ctx.ui.notify(userRailEnabled ? "User message rail on." : "User message rail off.", "info");
		},
	});

	pi.registerCommand("i-understand-the-danger", {
		description: "Print a one-time passcode to authorize the next hard-blocked command",
		handler: async (_args, ctx) => {
			const code = `DANGER-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
			passcode = { code, expiresAt: Date.now() + PASSCODE_TTL_MS };
			updateStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(`🔑 Danger passcode: ${code}\nValid 2 minutes, single use.`, "warning");
			}
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		// Chrome is runtime state: reinstall it lazily after a reload.
		setupFooter(ctx);
		setupTitleBar(ctx);
		setupThinking(ctx);
		if (!planMode || event.messageType !== "user") return undefined;
		return {
			message: {
				customType: "governance-plan-context",
				content: PLAN_CONTEXT,
				display: false,
			},
		};
	});

	pi.on("context", async (event) => {
		if (planMode) return undefined;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "governance-plan-context") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE");
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE"),
					);
				}
				return true;
			}),
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getBranch();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; customType?: string; data?: { planMode?: boolean } };
			if (entry.type === "custom" && entry.customType === "governance-mode" && entry.data) {
				if (typeof entry.data.planMode === "boolean") planMode = entry.data.planMode;
				break;
			}
		}
		if (pi.getFlag("plan") === false) planMode = false;
		updateStatus(ctx);
		setupFooter(ctx);
		setupTitleBar(ctx);
		setupThinking(ctx);
		applyWorkingIndicator(ctx, planMode);
	});
}
