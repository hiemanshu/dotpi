/**
 * Governance extension utilities.
 *
 * Pure-ish helpers for command classification, path scoping, and the
 * allowlist files. Kept separate from index.ts so they are easy to test
 * and to reason about.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AllowRules {
	write: string[];
	bash: string[];
}

export const EMPTY_RULES: AllowRules = { write: [], bash: [] };

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function resolveFromCwd(p: string, cwd: string): string {
	return path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p);
}

/**
 * Resolve the real filesystem path for scope checks. For paths that do not
 * exist yet (new files), the nearest existing ancestor is resolved so
 * symlinks cannot be used to escape the scope.
 */
export function realPathForScope(p: string): string {
	let current = path.resolve(p);
	const suffix: string[] = [];
	while (!fs.existsSync(current)) {
		const parent = path.dirname(current);
		if (parent === current) break;
		suffix.unshift(path.basename(current));
		current = parent;
	}
	let real = current;
	try {
		real = fs.realpathSync.native(current);
	} catch {
		/* keep the resolved path if realpath fails */
	}
	return suffix.length > 0 ? path.join(real, ...suffix) : real;
}

export function isInside(parent: string, child: string): boolean {
	const rel = path.relative(realPathForScope(parent), realPathForScope(child));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Display a path relative to cwd when possible. */
export function displayPath(p: string, cwd: string): string {
	const rel = path.relative(cwd, p);
	return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p;
}

// ---------------------------------------------------------------------------
// Bash classification
// ---------------------------------------------------------------------------

// Commands that only read. Every segment of a compound command must match one
// of these for the command to run without asking.
const SAFE_COMMAND_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*find\b/,
	/^\s*fd\b/,
	/^\s*ls\b/,
	/^\s*eza\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/,
	/^\s*file\b/,,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*bat\b/,
	/^\s*jq\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files|rev-parse|describe|blame|shortlog|stash\s+list)\b/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*(yarn|pnpm)\s+(list|info|why|audit|licenses)\b/i,
	/^\s*(node|python3?|lua|luau|bun|deno)\s+--version\b/i,
	/^\s*curl\s+(-s|-I|--head)\b/i,
	/^\s*wget\s+-O\s*-\s/i,
];

/**
 * `cd` into the project root (or a directory inside it) is harmless for a
 * read-only command chain. Bare `cd` goes to $HOME and `cd` elsewhere still
 * requires approval.
 */
function isSafeCdSegment(segment: string, projectRoot: string | undefined): boolean {
	if (!projectRoot) return false;
	const match = segment.match(/^cd(\s+(.+))?$/);
	if (!match) return false;
	const rawTarget = match[2]?.trim() || "~";
	const unquoted = rawTarget.replace(/^(['"])(.*)\1$/, "$2");
	const target =
		unquoted === "~" || unquoted.startsWith("~/")
			? path.join(process.env.HOME ?? "~", unquoted.slice(1))
			: unquoted;
	return isInside(projectRoot, resolveFromCwd(target, projectRoot));
}

// Shell constructs that can redirect output or evaluate arbitrary code.
function hasUnsafeShellSyntax(command: string): boolean {
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote === "'") {
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') {
				quote = null;
				continue;
			}
			// Command substitution still runs inside double quotes.
			if (ch === "`") return true;
			if (ch === "$" && (command[i + 1] === "(" || command[i + 1] === "{")) return true;
			if (ch === "\\") escaped = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === "<" || ch === ">" || ch === "`") return true;
		if (ch === "$" && (command[i + 1] === "(" || command[i + 1] === "{")) return true;
	}

	return false;
}

/** Split on top-level &&, ||, ;, and | while respecting quotes and escapes. */
export function splitShellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (quote === "'") {
			current += ch;
			if (ch === "'") quote = null;
			continue;
		}
		if (ch === "\\") {
			current += ch;
			if (i + 1 < command.length) current += command[++i];
			continue;
		}
		if (quote === '"') {
			current += ch;
			if (ch === '"') quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "&" && command[i + 1] === "&") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === "|" && command[i + 1] === "|") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === ";" || ch === "|") {
			segments.push(current);
			current = "";
			continue;
		}
		current += ch;
	}

	segments.push(current);
	return segments.map((s) => s.trim()).filter(Boolean);
}

export function isCompoundCommand(command: string): boolean {
	return splitShellSegments(command).length > 1;
}

/** `FOO=bar cmd` is safe if `cmd` is. */
function stripLeadingAssignments(segment: string): string {
	return segment.replace(/^(?:\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/, "").trim();
}

/** Remove quoted spans so hard-block checks don't fire on search patterns. */
function dequote(command: string): string {
	return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, " ");
}

// Safe commands that can still write or execute when given specific flags.
const UNSAFE_FLAGS: Array<{ command: RegExp; flags: RegExp }> = [
	{
		command: /^\s*(find|fd)\b/,
		flags: /(\s-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)\b|\s--exec(-batch)?\b|\s-[xX]\b)/,
	},
	{ command: /^\s*sort\b/, flags: /(\s-o\b|\s--output\b)/ },
	{ command: /^\s*tree\b/, flags: /(\s-o\b|\s--output\b)/ },
	{ command: /^\s*curl\b/, flags: /(\s-o\b|\s--output\b|\s-O\b|\s--remote-name\b|\s-T\b|\s--upload-file\b)/ },
	{ command: /^\s*rg\b/, flags: /(\s--pre\b)/ },
	{ command: /^\s*awk\b/, flags: /(system\s*\(|\|\s*["'])/ },
	{ command: /^\s*npm\s+audit\b/, flags: /\sfix\b/ },
	{ command: /^\s*git\s+branch\b/, flags: /(\s-d\b|\s-D\b|\s--delete\b|\s-m\b|\s-M\b|\s--move\b)/ },
	{ command: /^\s*git\s+remote\b/, flags: /\s(add|remove|rm|set-url|rename|prune)\b/ },
];

function isSafeSegment(segment: string, projectRoot?: string): boolean {
	const candidate = stripLeadingAssignments(segment);
	const matchesSafe = SAFE_COMMAND_PATTERNS.some((p) => p.test(candidate)) || isSafeCdSegment(candidate, projectRoot);
	if (!matchesSafe) return false;
	for (const rule of UNSAFE_FLAGS) {
		if (rule.command.test(candidate) && rule.flags.test(candidate)) return false;
	}
	return true;
}

export function isSafeBashCommand(command: string, projectRoot?: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;
	// Harmless descriptors: stderr/stdout redirection and /dev/null are not writes.
	const cleaned = trimmed
		.replace(/\d?>>?\s*&\d/g, " ")
		.replace(/\d?>>?\s*\/dev\/(null|stdout|stderr)/g, " ");
	if (hasUnsafeShellSyntax(cleaned)) return false;
	const segments = splitShellSegments(cleaned);
	if (segments.length === 0) return false;
	return segments.every((segment) => isSafeSegment(segment, projectRoot));
}

function shellWords(command: string): string[] {
	const matches = command.match(/[^\s"']+|"[^"]*"|'[^']*'/g);
	return matches ? matches.map((t) => t.replace(/^(['"])(.*)\1$/, "$2")) : [];
}

/**
 * Returns a human-readable reason when a command is on the never-allow list
 * (even with an allowlist entry). `null` means the command is not hard-blocked.
 */
export function dangerousReason(command: string, projectRoot: string, extraTrustedRoots: string[] = []): string | null {
	const c = command;
	const bare = dequote(c);

	if (/(^|\s)sudo(\s|$)/.test(bare)) return "sudo";
	if (/\b(shutdown|reboot|halt|poweroff)\b/.test(bare)) return "system power commands";
	if (/\b(mkfs(\.\w+)?|fdisk|diskutil\s+erase)\b/i.test(bare)) return "disk formatting";
	if (/\bdd\b[^|]*\bif=/.test(bare)) return "raw disk write (dd if=)";

	const segments = splitShellSegments(c);
	for (let i = 0; i < segments.length - 1; i++) {
		if (/\b(curl|wget)\b/.test(segments[i]) && /^\s*(sudo\s+)?(ba|z|k)?sh\b/.test(segments[i + 1])) {
			return "piping a download into a shell";
		}
	}

	if (/\bgit\s+push\b[^|]*(--force\b|(^|\s)-f(\s|$))/.test(bare)) return "force push";
	if (/\bgit\s+reset\s+--hard\b/.test(bare)) return "git reset --hard";
	if (/\bgit\s+clean\b[^|]*-[A-Za-z]*[fFdD]/.test(bare)) return "git clean with force/directories";
	if (/\b(npm|yarn|pnpm|bun)\s+publish\b/.test(bare)) return "package publish";
	if (/:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/.test(bare)) return "fork bomb";
	if (/\bchmod\s+(-[A-Za-z]+\s+)*777\s+\/(\s|$)/.test(bare)) return "chmod 777 /";

	for (const segment of segments) {
		const words = shellWords(segment);
		const rmIndex = words.findIndex((word) => /^rm$/i.test(word));
		if (rmIndex < 0) continue;
		const args = words.slice(rmIndex + 1);
		const recursive = args.some((word) => /^-[A-Za-z]*[rR][A-Za-z]*$|^--recursive$/.test(word));
		const force = args.some((word) => /^-[A-Za-z]*f[A-Za-z]*$|^--force$/.test(word));
		if (!recursive || !force) continue;
		const targets = args.filter((word) => !/^--?[A-Za-z-]+$/.test(word) && word !== "--");
		if (targets.length === 0) return "rm -rf with an indeterminate target";
		const roots = [projectRoot, ...extraTrustedRoots];
		const outside = targets.filter(
			(target) => !roots.some((root) => isInside(root, resolveFromCwd(target, projectRoot))),
		);
		if (outside.length > 0) return `rm -rf outside trusted roots (${outside.join(", ")})`;
	}

	return null;
}

/**
 * Best-effort detection of commands that step outside the approved root from
 * inside a subagent: `cd` to an outside directory, or absolute path arguments
 * outside the root. Relative paths are ignored because the subagent's cwd is
 * already the root.
 */
export function bashScopeEscape(command: string, root: string): string | null {
	const cdMatch = command.match(/(?:^|[;&|]\s*)cd\s+([^\s;&|]+)/);
	if (cdMatch) {
		const target = cdMatch[1].replace(/^["']|["']$/g, "");
		if (target.startsWith("~")) return `cd outside approved scope (${target})`;
		if (!isInside(root, resolveFromCwd(target, root))) return `cd outside approved scope (${target})`;
	}

	const allowedDevicePaths = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
	for (const match of command.matchAll(/(?:^|\s)(\/[^\s;&|"']+)/g)) {
		const p = match[1];
		if (allowedDevicePaths.some((d) => p === d || p.startsWith(`${d}/`))) continue;
		if (!isInside(root, p)) return `absolute path outside approved scope (${p})`;
	}

	return null;
}

/** Expand a leading `~` to the home directory. */
function expandTilde(p: string): string {
	if (p === "~") return process.env.HOME ?? p;
	if (p.startsWith("~/")) return path.join(process.env.HOME ?? "~", p.slice(2));
	return p;
}

/**
 * True when every absolute (or `~`) path the command mentions resolves inside
 * one of `roots`, and at least one such path is present. Relative paths are
 * ignored: the caller cannot know the effective cwd. Used to trust commands
 * scoped to the pi config root, matching the global write allowlist.
 */
export function bashPathsAllInsideRoots(command: string, roots: string[]): boolean {
	const normalizedRoots = roots.filter(Boolean).map((root) => path.resolve(root));
	if (normalizedRoots.length === 0) return false;

	const inside = (candidate: string): boolean => {
		const absolute = expandTilde(candidate.replace(/^["']|["']$/g, ""));
		if (!path.isAbsolute(absolute)) return false;
		return normalizedRoots.some((root) => isInside(root, absolute));
	};

	let sawPath = false;
	for (const segment of splitShellSegments(command)) {
		const cd = segment.match(/(?:^|\s)cd\s+([^\s;&|]+)/);
		if (cd) {
			sawPath = true;
			if (!inside(cd[1])) return false;
		}

		for (const word of shellWords(segment)) {
			const eq = word.indexOf("=");
			const candidate = eq > 0 ? word.slice(eq + 1) : word;
			if (!(candidate === "~" || candidate.startsWith("/") || candidate.startsWith("~/"))) continue;
			sawPath = true;
			if (!inside(candidate)) return false;
		}
	}

	return sawPath;
}

// ---------------------------------------------------------------------------
// Allowlist files
// ---------------------------------------------------------------------------

export function loadRules(filePath: string): AllowRules {
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
		return {
			write: Array.isArray(parsed?.write) ? parsed.write.filter((x): x is string => typeof x === "string") : [],
			bash: Array.isArray(parsed?.bash) ? parsed.bash.filter((x): x is string => typeof x === "string") : [],
		};
	} catch {
		return { write: [], bash: [] };
	}
}

export function saveRules(filePath: string, rules: AllowRules): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(rules, null, 2)}\n`, "utf-8");
	fs.renameSync(tmp, filePath);
}

export function addRule(rules: AllowRules, kind: "write" | "bash", value: string): void {
	if (!rules[kind].includes(value)) rules[kind].push(value);
}

/** Expand a leading ~ to the current user's home directory. */
export function expandHome(p: string): string {
	if (p === "~") return process.env.HOME ?? p;
	if (p.startsWith("~/")) return path.join(process.env.HOME ?? "~", p.slice(2));
	return p;
}

/** Represent a path under $HOME as ~/..., preserving a trailing slash. */
export function homeRelative(p: string): string {
	const home = process.env.HOME;
	if (!home) return p;
	const resolvedHome = path.resolve(home);
	const resolved = path.resolve(p);
	const trailing = p.endsWith(path.sep) && resolved !== resolvedHome ? path.sep : "";
	if (resolved === resolvedHome) return "~";
	const prefix = `${resolvedHome}${path.sep}`;
	return resolved.startsWith(prefix) ? `~${resolved.slice(resolvedHome.length)}${trailing}` : p;
}

/**
 * Write rule forms:
 *   - exact file path (absolute, ~/..., or relative to the project root)
 *   - directory path ending in "/" (absolute, ~/..., or relative to the project root)
 */
export function matchWriteRule(rule: string, absPath: string, projectRoot: string): boolean {
	const expanded = expandHome(rule);
	const resolved = path.resolve(path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded));
	const target = path.resolve(absPath);
	if (target === resolved) return true;
	const dir = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
	return target.startsWith(dir);
}

/**
 * Bash rule forms:
 *   - exact command, compared after whitespace normalization
 *   - prefix rule ending in " *", e.g. "npm test *"
 */
export function matchBashRule(rule: string, command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ");
	const r = rule.trim().replace(/\s+/g, " ");
	if (r.endsWith(" *")) {
		const base = r.slice(0, -2);
		return normalized === base || normalized.startsWith(`${base} `);
	}
	return normalized === r;
}
