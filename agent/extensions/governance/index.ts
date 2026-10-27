/**
 * Governance extension — a permission gate that only stops to ask when a call
 * reaches outside the project or `~/.pi`, or is irreversible.
 *
 * Defaults:
 *   - Writes/edits inside `<cwd>` and inside the pi config root (`~/.pi`) are
 *     free. Any other write/edit asks the user; approvals can be remembered in
 *     the project allowlist (<project>/.pi/permissions.local.json) or the
 *     global allowlist (<agent-dir>/permissions.json).
 *   - Read-only bash and commands that provably stay inside the project or
 *     `~/.pi` run without asking. A command that reaches elsewhere, or talks to
 *     the network, asks.
 *   - A small always-prompt list of irreversible commands (rm -rf, force push,
 *     git reset --hard, ...) is hard-blocked even inside the project. The user
 *     can authorize a single run with the one-time passcode from
 *     /i-understand-the-danger.
 *   - Subagent processes (env PI_GOVERNED_SUBAGENT=1) are scoped to their
 *     working directory plus explicit extra paths approved at launch time.
 *     They cannot prompt, so out-of-scope actions fail closed.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AllowRules,
	addRule,
	bashScopeEscape,
	dangerousReason,
	displayPath,
	expandHome,
	homeRelative,
	isInside,
	isCompoundCommand,
	loadRules,
	mainBashVerdict,
	mainWriteVerdict,
	matchBashRule,
	matchWriteRule,
	resolveFromCwd,
	resolveWritePath,
	saveRules,
	uniqueResolved,
} from "./utils.ts";
import {
	applyWorkingIndicator,
	installGovernanceFooter,
	installGovernanceTitleBar,
	type FooterHandle,
} from "./footer.ts";
import { installBlockRenderers, installUserMessageRail } from "./renderers.ts";
import { createThroughputTracker } from "./throughput.ts";

const PASSCODE_TTL_MS = 2 * 60 * 1000;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
/** Tools the main gate knows how to reason about; anything else fails closed. */
const MAIN_ALLOWED_TOOLS = new Set([...READ_TOOLS, "subagent", "questionnaire", "ask", "confirm"]);
/** Tools a subagent may use; everything else (including `powershell`) fails closed. */
const SUBAGENT_ALLOWED_TOOLS = new Set(["edit", "write", "bash", ...READ_TOOLS]);
/** Footer repaint ceiling while streaming (~10 Hz); no timer, extra frames are dropped. */
const RENDER_INTERVAL_MS = 100;
/**
 * Rough characters-per-token used when a provider reports usage only at the end;
 * the character count covers text, thinking, and tool-call JSON (D-0028).
 */
const CHARS_PER_TOKEN = 4;

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

/** The pi config root (~/.pi), i.e. the agent dir's parent. */
function piRootPath(): string {
	return path.resolve(getAgentDir(), "..");
}

/**
 * Pi's own installation roots: walk up from the running script to the
 * `pi-coding-agent` package directory and include it plus its parent. Returns
 * an empty list when the layout is not recognisable (the `read` allowlist is
 * the escape hatch for unusual installs).
 */
function piInstallRoots(): string[] {
	const script = process.argv[1];
	if (!script) return [];
	let start: string;
	try {
		start = fs.realpathSync(script);
	} catch {
		return [];
	}
	let current = path.dirname(start);
	while (true) {
		if (path.basename(current) === "pi-coding-agent") return [current, path.dirname(current)];
		const parent = path.dirname(current);
		if (parent === current) return [];
		current = parent;
	}
}

/**
 * Roots read-only bash may `cd` into: the project, ~/.pi, the pi install,
 * temp dirs, and configured `read` rules. They extend `cd` trust only; they do
 * not authorize a command on their own.
 */
function readRoots(cwd: string): string[] {
	const project = loadProjectRules(cwd);
	const global = loadGlobalRules();
	const configured = [...project.read, ...global.read].map((rule) =>
		resolveFromCwd(expandHome(rule), cwd),
	);
	return uniqueResolved([cwd, piRootPath(), ...piInstallRoots(), "/tmp", os.tmpdir(), ...configured]);
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
	let passcode: Passcode | null = null;
	let footerEnabled = true;
	let footerInstalled = false;
	let titleEnabled = true;
	let titleInstalled = false;
	let userRailEnabled = true;

	// One tracker per process: the footer shows the live sample while a reply
	// streams and the last completed call's numbers when idle.
	const throughput = createThroughputTracker();
	let footerHandle: FooterHandle | undefined;
	let lastRenderAt = 0;
	let streamedChars = 0;
	/** `before_provider_request` timestamp; the request, not `message_start`, anchors TTFT. */
	let pendingRequestStartedAt: number | null = null;

	installBlockRenderers(pi);
	installUserMessageRail(pi, () => userRailEnabled);

	// -----------------------------------------------------------------------
	// State helpers
	// -----------------------------------------------------------------------

	function passcodeActive(): boolean {
		return passcode !== null && Date.now() < passcode.expiresAt;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const key = passcodeActive() ? ctx.ui.theme.fg("warning", "🔑") : "";
		ctx.ui.setStatus("governance", key);
	}

	function setupFooter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (footerEnabled && !footerInstalled) {
			footerHandle = installGovernanceFooter(ctx, () => ({
				passcodeActive: passcodeActive(),
				throughput: () => throughput.snapshot(),
			}));
			footerInstalled = true;
		} else if (!footerEnabled && footerInstalled) {
			ctx.ui.setFooter(undefined);
			footerInstalled = false;
			footerHandle = undefined;
		}
	}

	/** Repaint the footer at most ~10 Hz; `force` settles the final numbers. */
	function requestFooterRender(force = false): void {
		const handle = footerHandle;
		if (!handle) return;
		const now = performance.now();
		if (!force && now - lastRenderAt < RENDER_INTERVAL_MS) return;
		lastRenderAt = now;
		handle.requestRender();
	}

	function setupTitleBar(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (titleEnabled && !titleInstalled) {
			installGovernanceTitleBar(ctx);
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
		const piDisplay = homeRelative(`${piRootPath()}${path.sep}`);

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
				`Write approval\n\n${rel}\n\noutside ${projectName} and ${piDisplay}`,
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
				`Command approval${note ? `\n(${note})` : ""}\n\n$ ${normalized}`,
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
			// Expand `~` first, then resolve against the session cwd.
			const abs = resolveWritePath(p, cwd);

			// Inside the project or ~/.pi the write is ordinary work: no prompt.
			const verdict = mainWriteVerdict(abs, { projectRoot: cwd, piRoot: piRootPath() });
			if (verdict === "allow") return undefined;

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

			// Irreversible operations win over every allow path below.
			const reason = dangerousReason(command);
			if (reason) return handleHardBlock(ctx, command, reason);

			let cwdNote: string | undefined;
			if (typeof input.cwd === "string" && input.cwd.length > 0) {
				const requested = resolveFromCwd(input.cwd, cwd);
				if (!isInside(cwd, requested) && !isInside(piRootPath(), requested)) {
					cwdNote = `requested cwd: ${requested}`;
				}
			}

			if (
				!cwdNote &&
				mainBashVerdict(command, { projectRoot: cwd, piRoot: piRootPath(), readRoots: readRoots(cwd) }) === "allow"
			) {
				return undefined;
			}

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

		if (tool === "powershell") {
			return {
				block: true,
				reason: [
					"⛔ BLOCKED · powershell is not supported",
					"This setup only supports the `bash` tool. Run the equivalent command with `bash` instead.",
				].join("\n"),
			};
		}

		// Fail closed: a tool the gate does not understand never runs unattended.
		if (!MAIN_ALLOWED_TOOLS.has(tool)) {
			return {
				block: true,
				reason: [
					`⛔ BLOCKED · unknown tool (${tool})`,
					"The governance gate has no policy for this tool, so it cannot be allowed.",
					"Add it to MAIN_ALLOWED_TOOLS in the governance extension if it is read-only.",
				].join("\n"),
			};
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
		// Honor launch-time allowPaths as well as the working directory.
		const configuredRoots = subagentRoots();
		const approvedRoots = uniqueResolved(configuredRoots.length > 0 ? configuredRoots : [cwd]);
		const scopeNote =
			"Subagents are scoped to the project directory. The parent session must ask the user and re-launch with allowPaths for outside access.";

		if (tool === "subagent") {
			return { block: true, reason: `Nested subagent launches are blocked. ${scopeNote}` };
		}

		if (tool === "edit" || tool === "write") {
			const p = pathFromInput(input);
			if (!p) return { block: true, reason: `Blocked: write call without a target path. ${scopeNote}` };
			const abs = resolveWritePath(p, cwd);
			if (isOutsideSubagentScope(abs)) {
				return { block: true, reason: `Blocked: ${displayPath(abs, cwd)} is outside the approved scope. ${scopeNote}` };
			}
			return undefined;
		}

		if (tool === "bash") {
			const command = typeof input.command === "string" ? input.command : "";
			if (!command.trim()) return { block: true, reason: "Blocked: empty bash command." };

			const danger = dangerousReason(command);
			if (danger) {
				return {
					block: true,
					reason: `HARD BLOCK (${danger}): ${command}\nDangerous commands cannot be authorized from a subagent. Report back and let the user run it.`,
				};
			}
			const escape = bashScopeEscape(command, [cwd, ...approvedRoots]);
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
			return undefined;
		}

		if (tool === "powershell") {
			return {
				block: true,
				reason: `Blocked: powershell is not supported. Only the bash tool is available in this setup. ${scopeNote}`,
			};
		}

		// Fail closed: a tool without a subagent policy never runs unattended.
		if (!SUBAGENT_ALLOWED_TOOLS.has(tool)) {
			return {
				block: true,
				reason: `Blocked: tool "${tool}" has no subagent policy, so it fails closed. ${scopeNote}`,
			};
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
	// Live throughput (footer segment)
	// -----------------------------------------------------------------------

	// Fires before every provider HTTP call, including classifier, compaction, and
	// title requests, so it only records a timestamp: start() belongs to the
	// assistant message that actually follows.
	pi.on("before_provider_request", () => {
		pendingRequestStartedAt = performance.now();
	});

	pi.on("message_start", (event) => {
		const message = event.message as AssistantMessage | undefined;
		if (!message || message.role !== "assistant") return;
		// Anchor TTFT at the request, not here: durationMs counts from stream creation.
		throughput.start(pendingRequestStartedAt ?? undefined);
		pendingRequestStartedAt = null;
		streamedChars = 0;
		lastRenderAt = 0;
	});

	pi.on("message_update", (event, ctx) => {
		const message = event.message as AssistantMessage | undefined;
		if (!message || message.role !== "assistant") return;

		// Fallback for providers that only send usage in the final chunk: count every
		// streamed delta (text, thinking, tool-call JSON) and estimate tokens from it.
		// Code points, not UTF-16 units, to stay close to the token count.
		const deltaEvent = event.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
		if (typeof deltaEvent?.type === "string" && deltaEvent.type.endsWith("_delta")) {
			if (typeof deltaEvent.delta === "string") streamedChars += [...deltaEvent.delta].length;
		}

		const reported = message.usage?.output ?? 0;
		const output = reported > 0 ? reported : streamedChars / CHARS_PER_TOKEN;

		const sample = throughput.update({ output }, !(reported > 0));
		if (!sample) return;
		if (ctx.mode !== "tui" || !footerInstalled) return;
		requestFooterRender();
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message as AssistantMessage | undefined;
		if (!message || message.role !== "assistant") return;
		throughput.end(message);
		if (ctx.mode !== "tui" || !footerInstalled) return;
		requestFooterRender(true);
	});

	// -----------------------------------------------------------------------
	// Commands
	// -----------------------------------------------------------------------

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
					`  read:  ${rules.read.length > 0 ? rules.read.join(", ") : "(none)"}`,
				].join("\n");
			ctx.ui.notify(
				[
					render("Project", project, projectRulesPath(ctx.cwd)),
					render("Global", global, globalRulesPath()),
					`Writes and local commands run free inside the project and ~/.pi; everything else prompts.`,
					`Irreversible commands (rm -rf, force push, git reset --hard, ...) always prompt.`,
					`Read rules extend the trusted roots for bash paths and cd.`,
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

	pi.on("before_agent_start", async (_event, ctx) => {
		// Chrome is runtime state: reinstall it lazily after a reload.
		setupFooter(ctx);
		setupTitleBar(ctx);
		setupThinking(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
		setupFooter(ctx);
		setupTitleBar(ctx);
		setupThinking(ctx);
		applyWorkingIndicator(ctx);
	});
}
