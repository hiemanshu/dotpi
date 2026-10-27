/**
 * Governance extension utilities.
 *
 * Pure-ish helpers for command classification, path scoping, and the
 * allowlist files. Kept separate from index.ts so they are easy to test
 * and to reason about.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface AllowRules {
	write: string[];
	bash: string[];
	read: string[];
}

export const EMPTY_RULES: AllowRules = { write: [], bash: [], read: [] };

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

/** Resolve, drop empties, and dedupe a list of root paths. */
export function uniqueResolved(paths: Array<string | undefined | null>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of paths) {
		if (!p) continue;
		const resolved = path.resolve(p);
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		out.push(resolved);
	}
	return out;
}

/**
 * A docs/setup root is only trustworthy if it is a plain child directory of
 * its base. If `<project>/docs` (or `<piRoot>/setup`) is a symlink pointing
 * elsewhere, the derived root is dropped so its writes fall back to the prompt
 * path instead of being trusted.
 */
function derivedWriteRoot(base: string, name: string): string | null {
	const root = path.join(base, name);
	const expected = path.join(realPathForScope(base), name);
	return realPathForScope(root) === expected ? root : null;
}

/**
 * Roots the main session may write to without a prompt: `<project>/docs/`,
 * `<piRoot>/setup/`, `/tmp`, and `os.tmpdir()`. When `piRoot` is omitted the
 * home config root (`~/.pi`) is assumed. The docs/setup roots are dropped when
 * they are symlinks (`/tmp` and `os.tmpdir()` are deliberately kept as-is).
 */
export function freeWriteRoots(projectRoot: string, piRoot?: string): string[] {
	const configRoot = piRoot ?? path.join(os.homedir(), ".pi");
	return uniqueResolved([
		derivedWriteRoot(projectRoot, "docs"),
		derivedWriteRoot(configRoot, "setup"),
		"/tmp",
		os.tmpdir(),
	]);
}

/**
 * What the main session may do with a write:
 *   - "allow"        free-write root (docs, pi setup, temp dirs)
 *   - "block-source" inside the project or `~/.pi` outside those roots:
 *                     source/config writes are delegated to a worker subagent
 *   - "ask"          anywhere else (the existing prompt path)
 */
export type WriteVerdict = "allow" | "block-source" | "ask";

export interface WriteScope {
	/** Session project root (ctx.cwd). */
	projectRoot: string;
	/** The pi config root (~/.pi). */
	piRoot: string;
}

export function mainWriteVerdict(absPath: string, scope: WriteScope): WriteVerdict {
	const target = path.resolve(absPath);
	const roots = freeWriteRoots(scope.projectRoot, scope.piRoot);
	if (roots.some((root) => isInside(root, target))) return "allow";
	if (isInside(scope.projectRoot, target)) return "block-source";
	if (isInside(scope.piRoot, target)) return "block-source";
	return "ask";
}

// ---------------------------------------------------------------------------
// Bash classification
// ---------------------------------------------------------------------------

// The auto-allowed set is a minimal read-only core: every entry must be
// unable to write, delete, or execute, because a single output flag turns a
// "safe" command into a write (`uniq in out`, `sort -o`, `curl -D`).
// Anything else prompts; a specific form can still be allowlisted.
// Every segment of a compound command must match one of these.
const SAFE_COMMAND_PATTERNS: RegExp[] = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*find\b/,
	/^\s*fd\b/,
	/^\s*ls\b/,
	/^\s*eza\b/,
	// `echo`/`printf` can only write through a redirect: harmless redirects are
	// stripped first (free-write roots only) and every other one is rejected as
	// unanalysable, so neither can escape the gate on its own.
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*pwd\b/,
	/^\s*wc\b/,
	/^\s*diff\b/,
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
	/^\s*ps\b/,
	/^\s*jq\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files|rev-parse|describe|blame|shortlog|stash\s+list)\b/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*(node|python3?|bun|deno)\s+--version\s*$/i,
];

/**
 * Parse the arguments of a `cd` segment. Returns `null` when the segment is
 * not a `cd`, a resolved target when it provably lands inside a trusted root,
 * and an error otherwise. Shared by the main-session classifier and the
 * subagent scope check so both reject the same shapes: bare `cd`, `cd -`,
 * `cd --` without a following target, more than one target, flags, and globs.
 */
export type CdParse = { target: string } | { error: string } | null;

export function parseCdSegment(segment: string, roots: string[], baseDir: string): CdParse {
	const words = shellWords(segment);
	if (words.length === 0 || words[0] !== "cd") return null;
	let args = words.slice(1);
	// `cd -- <target>` is fine; `cd --` on its own is not.
	if (args[0] === "--") args = args.slice(1);
	if (args.length === 0) return { error: "cd with no target" };
	if (args.length > 1) return { error: `cd with multiple targets (${args.join(" ")})` };
	const raw = args[0];
	if (raw === "") return { error: "cd with no target" };
	if (raw === "-") return { error: "cd -" };
	if (raw.startsWith("-")) return { error: `cd flag ${raw}` };
	if (GLOB_CHARS.test(raw)) return { error: `cd glob ${raw}` };
	const target = resolveFromCwd(expandHome(raw), baseDir);
	return roots.some((root) => isInside(root, target)) ? { target } : { error: `${raw} is outside approved scope` };
}

/**
 * `cd` into a trusted read root (or a directory inside one) is harmless for a
 * read-only command chain. Relative targets resolve against `baseDir`, the
 * directory the chain has reached so far (initially the project). Returns the
 * resolved target so callers can track it.
 */
function resolveSafeCdTarget(segment: string, readRoots: string[], baseDir: string): string | null {
	const roots = uniqueResolved(readRoots);
	if (roots.length === 0) return null;
	const parsed = parseCdSegment(segment, roots, baseDir);
	return parsed && "target" in parsed ? parsed.target : null;
}

/**
 * Shell syntax the gate refuses to analyse: quoting that hides the real words
 * (`$'…'`, `$"…"`, a backslash anywhere outside single quotes) and expansions
 * that can stand for anything (`$(…)`, `${…}`, backticks). One rule instead of
 * auditing each interpreter's quoting rules.
 *
 * With `redirects: true` a `<` or `>` still present after harmless-redirect
 * stripping also counts: the caller already proved the plain redirects safe.
 * Returns a reason string so both the main-session classifier and the subagent
 * scope check can report what they rejected; `null` means the command is plain
 * enough to reason about word by word.
 */
export function unanalysableShell(command: string, { redirects = false } = {}): string | null {
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote === "'") {
			// Single quotes are literal: a backslash there hides nothing.
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') {
				quote = null;
				continue;
			}
			// Command substitution still runs inside double quotes.
			if (ch === "`") return "backtick command substitution";
			if (ch === "$" && command[i + 1] === "(") return "$( command substitution";
			if (ch === "$" && command[i + 1] === "{") return "${ parameter expansion";
			if (ch === "\\") return "backslash escape in double quotes";
			continue;
		}
		if (ch === "'" || ch === '"') {
			// `$'…'` (ANSI-C) and `$"…"` (translated) quoting hide the real word.
			if (i > 0 && command[i - 1] === "$") return `$${ch} quoting`;
			quote = ch;
			continue;
		}
		if (ch === "\\") return "backslash escape";
		if (ch === "`") return "backtick command substitution";
		if (ch === "$" && command[i + 1] === "(") return "$( command substitution";
		if (ch === "$" && command[i + 1] === "{") return "${ parameter expansion";
		if (redirects && (ch === "<" || ch === ">")) return "redirect";
	}

	return null;
}

/** Path targets a redirect may take without needing shell expansion. */
const LITERAL_REDIRECT_TARGET = /^[\w.\/~@%+=:,-]+$/;

/** Shell glob characters: a target containing one is not a single literal path. */
const GLOB_CHARS = /[*?[{]/;

/**
 * Remove `>`, `>>`, and `n>` redirects whose target resolves inside one of
 * `roots`. Any redirect that cannot be proven harmless is left untouched so
 * `unanalysableShell` still rejects the command. Quoted targets are
 * supported as long as they contain no whitespace; expansion (`$VAR`, globs,
 * `(...)`) is deliberately not. Relative targets resolve against `baseDir`
 * (default: process.cwd()).
 */
export function stripHarmlessRedirects(command: string, roots: string[], baseDir?: string): string {
	const resolvedRoots = uniqueResolved(roots);
	if (resolvedRoots.length === 0) return command;
	const base = baseDir ?? process.cwd();

	const inside = (target: string): boolean => {
		if (GLOB_CHARS.test(target) || !LITERAL_REDIRECT_TARGET.test(target)) return false;
		const abs = path.resolve(base, expandHome(target));
		return resolvedRoots.some((root) => isInside(root, abs));
	};

	let out = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];

		if (quote === "'") {
			out += ch;
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			out += ch;
			if (ch === "\\" && i + 1 < command.length) {
				out += command[++i];
				continue;
			}
			if (ch === '"') quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			out += ch + command[++i];
			continue;
		}
		if (ch !== ">") {
			out += ch;
			continue;
		}

		// `x >&2`, `x &> file`: fd duplication / combined redirect — leave alone.
		if (out.endsWith("&") || command[i + 1] === "&") return command;

		// `2>`/`1>>`: the leading digit is a file descriptor, not a word.
		const fdMatch = out.match(/(^|[\s;|&])(\d)$/);
		if (fdMatch) out = out.slice(0, out.length - 1);

		let j = i + 1;
		if (command[j] === ">") j++;
		while (j < command.length && /[ \t]/.test(command[j])) j++;

		let target = "";
		const quoteChar = command[j];
		if (quoteChar === '"' || quoteChar === "'") {
			const end = command.indexOf(quoteChar, j + 1);
			if (end < 0) return command;
			target = command.slice(j + 1, end);
			j = end + 1;
		} else {
			let k = j;
			while (k < command.length && !/[\s;|&<>()]/.test(command[k])) k++;
			target = command.slice(j, k);
			j = k;
		}

		if (!target || !inside(target)) return command;

		out += " ";
		i = j - 1;
	}

	return out;
}

/**
 * Split on top-level `&&`, `||`, `&`, `;`, `|`, and newlines while respecting
 * quotes and escapes. A single `&` backgrounds the first command and starts a
 * second one, so it separates too; `&>` and fd duplication (`2>&1`) do not.
 * Newlines are command separators in a shell, so they must split too.
 */
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
		if (ch === "&") {
			// `&&` separates commands. `&>` (next char `>`) and fd duplication
			// (`2>&1`, previous char `>`) do not, and `&` on its own does: it
			// backgrounds the first command and starts a second one.
			if (command[i + 1] === "&") {
				segments.push(current);
				current = "";
				i++;
				continue;
			}
			if (command[i + 1] === ">" || command[i - 1] === ">") {
				current += ch;
				continue;
			}
			segments.push(current);
			current = "";
			continue;
		}
		if (ch === "|" && command[i + 1] === "|") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "\n" || ch === "\r") {
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
	// `-o` takes an attached value too: `tree -oout` writes a file.
	{ command: /^\s*tree\b/, flags: /(\s-o|\s--output\b)/ },
	{ command: /^\s*rg\b/, flags: /(\s--pre\b)/ },
	{ command: /^\s*npm\s+audit\b/, flags: /\sfix\b/ },
	{ command: /^\s*git\b/, flags: /\s--output\b/ },
	{ command: /^\s*git\s+branch\b/, flags: /(\s-d\b|\s-D\b|\s-f\b|\s--delete\b|\s--force\b|\s-m\b|\s-M\b|\s--move\b)/ },
	{ command: /^\s*git\s+remote\b/, flags: /\s(add|remove|rm|set-url|rename|prune)\b/ },
];

/**
 * `mkdir [-p] …` is safe when every path argument lands in a free-write root.
 * Non-recursive `rm` is safe only when every target is a temp dir. Recursive
 * removal is never auto-allowed this way.
 */
function isSafeFreeWriteCommand(segment: string, writeRoots: string[], baseDir: string): boolean {
	const words = shellWords(segment);
	if (words.length === 0) return false;
	const command = words[0];
	const roots = uniqueResolved(writeRoots);
	if (roots.length === 0) return false;
	const inside = (candidates: string[], target: string): boolean => {
		if (GLOB_CHARS.test(target)) return false;
		const abs = resolveFromCwd(expandHome(target), baseDir);
		return candidates.some((root) => isInside(root, abs));
	};

	if (command === "mkdir") {
		let sawPath = false;
		for (let i = 1; i < words.length; i++) {
			const word = words[i];
			if (word === "--") continue;
			if (word.startsWith("-")) {
				if (/^(-[pv]+|--parents|--verbose)$/.test(word)) continue;
				if (/^(-m|--mode)$/.test(word)) {
					i++;
					continue;
				}
				return false;
			}
			sawPath = true;
			if (!inside(roots, word)) return false;
		}
		return sawPath;
	}

	if (command === "rm") {
		const tmpRoots = uniqueResolved(["/tmp", os.tmpdir()]);
		let sawPath = false;
		for (let i = 1; i < words.length; i++) {
			const word = words[i];
			if (word === "--") continue;
			if (word.startsWith("-")) {
				if (word.startsWith("--")) {
					if (/^--(recursive|dir)$/.test(word)) return false;
					if (/^--(force|interactive|verbose)$/.test(word)) continue;
					return false;
				}
				if (/[rR]/.test(word)) return false;
				if (!/^-[fiIv]+$/.test(word)) return false;
				continue;
			}
			sawPath = true;
			if (!inside(tmpRoots, word)) return false;
		}
		return sawPath;
	}

	return false;
}

interface SegmentClassification {
	safe: boolean;
	/** Resolved directory when the segment is a trusted `cd`. */
	cdTarget?: string;
}

function classifySegment(
	segment: string,
	readRoots: string[],
	writeRoots: string[],
	baseDir: string,
): SegmentClassification {
	const candidate = stripLeadingAssignments(segment);
	if (!candidate) return { safe: false };
	const cdTarget = resolveSafeCdTarget(candidate, readRoots, baseDir);
	const matchesSafe =
		SAFE_COMMAND_PATTERNS.some((p) => p.test(candidate)) ||
		cdTarget !== null ||
		isSafeFreeWriteCommand(candidate, writeRoots, baseDir);
	if (!matchesSafe) return { safe: false };
	// Flags can be quoted (`find . "-delete"`, `git log "--output=x"`,
	// `git branch "-D"`). Audit the quote-stripped words so the flag content
	// stays visible to the regexes instead of hiding inside the quotes.
	const unquoted = shellWords(candidate).join(" ");
	for (const rule of UNSAFE_FLAGS) {
		if (rule.command.test(unquoted) && rule.flags.test(unquoted)) return { safe: false };
	}
	return cdTarget !== null ? { safe: true, cdTarget } : { safe: true };
}

/**
 * Harmless descriptors: stderr/stdout redirection and /dev/null are not writes.
 * Applied per segment, before redirect stripping, so `2>&1` does not look like
 * a file write to `unanalysableShell`.
 */
function stripHarmlessDescriptors(segment: string): string {
	return segment.replace(/\d?>>?\s*&\d/g, " ").replace(/\d?>>?\s*\/dev\/(null|stdout|stderr)/g, " ");
}

export function isSafeBashCommand(
	command: string,
	projectRoot?: string,
	readRoots?: string[],
	writeRoots?: string[],
): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;
	const trustedReads = uniqueResolved(
		readRoots && readRoots.length > 0 ? readRoots : projectRoot ? [projectRoot] : [],
	);
	// No implicit write trust: callers that want redirect/mkdir/rm handling for
	// free-write roots must pass them explicitly.
	const freeRoots = uniqueResolved(writeRoots ?? []);
	const segments = splitShellSegments(trimmed);
	if (segments.length === 0) return false;

	// Walk the chain, tracking the directory reached after each safe `cd` so
	// relative redirect/mkdir/rm targets resolve against the real target dir.
	let base = projectRoot ?? process.cwd();
	for (const segment of segments) {
		// Redirects into a free-write root are scratch writes, not shell escapes.
		const cleaned = stripHarmlessRedirects(stripHarmlessDescriptors(segment), freeRoots, base);
		if (unanalysableShell(cleaned, { redirects: true })) return false;
		const result = classifySegment(cleaned, trustedReads, freeRoots, base);
		if (!result.safe) return false;
		if (result.cdTarget) base = result.cdTarget;
	}
	return true;
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
	// Quoted flags still count for the never-allow list: `git push "--force"`
	// and `npm "publish"` must not be allowlistable away. Remove only the quote
	// characters so the flag content stays visible.
	const unquoted = c.replace(/['"]/g, "");

	if (/(^|\s)sudo(\s|$)/.test(bare)) return "sudo";
	if (/\b(shutdown|reboot|halt|poweroff)\b/.test(bare)) return "system power commands";
	if (/\b(mkfs(\.\w+)?|fdisk|diskutil\s+erase)\b/i.test(bare)) return "disk formatting";
	if (/\bdd\b[^|]*\bif=/.test(bare)) return "raw disk write (dd if=)";

	// Pipe-to-shell keeps the dequoted form: a search pattern such as
	// `grep -n "curl | sh" docs` is not a download being executed.
	const pipeSegments = splitShellSegments(bare);
	for (let i = 0; i < pipeSegments.length - 1; i++) {
		if (/\b(curl|wget)\b/.test(pipeSegments[i]) && /^\s*(sudo\s+)?(ba|z|k)?sh\b/.test(pipeSegments[i + 1])) {
			return "piping a download into a shell";
		}
	}

	if (/\bgit\s+push\b[^|]*(--force\b|(^|\s)-f(\s|$))/.test(unquoted)) return "force push";
	if (/\bgit\s+reset\s+--hard\b/.test(unquoted)) return "git reset --hard";
	if (/\bgit\s+clean\b[^|]*-[A-Za-z]*[fFdD]/.test(unquoted)) return "git clean with force/directories";
	if (/\b(npm|yarn|pnpm|bun)\s+publish\b/.test(unquoted)) return "package publish";

	const segments = splitShellSegments(c);
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

/** Character devices that are never a real read or write target. */
const ALLOWED_DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

function isAllowedDevicePath(p: string): boolean {
	return ALLOWED_DEVICE_PATHS.some((device) => p === device || p.startsWith(`${device}/`));
}

/**
 * Best-effort detection of commands that step outside the approved roots from
 * inside a subagent. Word/quote aware: each segment is split into words first,
 * so `cat "/etc/hostname"` and `echo pwn > "/tmp/out"` are caught even though
 * the path is quoted. Relative paths resolve against the first root and must
 * land inside one of them.
 *
 * Fail-closed on anything the word split cannot vouch for: unanalysable quoting
 * or expansions (via `unanalysableShell`), an interpreter at any word position
 * with a flag outside the read-only allowlist (`node --eval`, `node -p`,
 * `perl -E`, `php -R`, …), an interpreter with no script word (stdin payload),
 * `npx …`, `deno eval`, `bun eval`/`bun x`, a `$`-word, and the command word
 * itself when it names a path. `--opt=value` values and path-like attached
 * short-flag tails (`git -C..`, `sort -o/tmp/x`) are audited as paths too, and
 * bare `.`/`..` count as paths.
 */
export function bashScopeEscape(command: string, root: string | string[]): string | null {
	const roots = uniqueResolved(Array.isArray(root) ? root : [root]);
	if (roots.length === 0) return "command outside approved scope (no roots)";
	const insideAny = (candidate: string): boolean => roots.some((r) => isInside(r, candidate));

	const unanalysable = unanalysableShell(command);
	if (unanalysable) return `unanalysable shell syntax (${unanalysable})`;

	/** A single word as a path: `null` when it is harmless or inside a root. */
	const checkWord = (word: string): string | null => {
		if (!word) return null;
		// `$VAR`, `$1`, … can expand to anything; no payload audit.
		if (word.includes("$")) return `shell expansion outside approved scope (${word})`;
		if (isAllowedDevicePath(word)) return null;
		const tilde = word.startsWith("~");
		const dotPath =
			word === "." || word === ".." || word.startsWith("./") || word.startsWith("../");
		if (!word.includes("/") && !tilde && !dotPath) return null;
		const absolute = path.isAbsolute(word) || tilde;
		const resolved = resolveFromCwd(expandHome(word), roots[0]);
		if (insideAny(resolved)) return null;
		return absolute
			? `absolute path outside approved scope (${word})`
			: `relative path outside approved scope (${word})`;
	};

	/** A word tail that could name a path: `/…`, `~…`, `.`/`..…`, or any `/`. */
	const isPathLike = (word: string): boolean =>
		word.startsWith("/") || word.startsWith("~") || word.startsWith(".") || word.includes("/");

	for (const segment of splitShellSegments(command)) {
		const words = shellWords(segment);
		if (words.length === 0) continue;
		const cmd = words[0];

		// `pushd`/`popd` move the shell's directory outside the scope check.
		if (cmd === "pushd" || cmd === "popd") return `${cmd} outside approved scope`;

		// Same `cd` parser as the main-session classifier: bare `cd`, `cd -`,
		// multiple targets, globs, and targets outside the roots are escapes.
		const cd = parseCdSegment(segment, roots, roots[0]);
		if (cd && "error" in cd) return `cd outside approved scope (${cd.error})`;

		// Leading `VAR=...` assignments come before the command word and must be
		// audited too: `X=/etc cat f` is an escape.
		let commandIndex = 0;
		while (commandIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[commandIndex])) {
			commandIndex++;
		}

		// An interpreter anywhere in the segment switches to a whitelist: only
		// flags that just read information are allowed, so `-c`/`-e`/`-r` and
		// every future code-exec flag (`--eval`, `-p`, `-E`, `-R`, `--require`)
		// are escapes by default. Scanning every word catches wrappers too
		// (`env -i bash -c`, `exec`, `nohup`, `timeout 5`, `xargs`). A non-flag
		// word is the script path (or an argument), audited like any other word.
		for (let i = 0; i < words.length; i++) {
			const interpreter = path.basename(words[i]);
			if (!CODE_INTERPRETER.test(interpreter)) continue;
			// `npx …` downloads and runs an arbitrary package, so no form is auditable.
			if (interpreter === "npx") return `interpreter ${interpreter} runs an arbitrary package`;
			// No following script word means the interpreter reads its payload from
			// stdin (`echo x | bash`, bare `perl`); that payload is never audited.
			if (i === words.length - 1) return `interpreter ${interpreter} with no script path (stdin payload)`;
			for (let j = i + 1; j < words.length; j++) {
				const word = words[j];
				if (!word) continue;
				if (word.startsWith("-")) {
					if (INTERPRETER_SAFE_FLAGS.has(word)) continue;
					return `interpreter ${interpreter} with a flag outside the read-only allowlist (${word})`;
				}
				// `deno eval`, `bun eval`, and `bun x` are inline/remote execution.
				if ((interpreter === "deno" || interpreter === "bun") && INTERPRETER_EXEC_WORDS.has(word)) {
					return `interpreter ${interpreter} ${word} outside approved scope`;
				}
				const reason = checkWord(word);
				if (reason) return reason;
			}
		}

		for (let i = 0; i < words.length; i++) {
			const raw = words[i];
			if (!raw) continue;
			if (i !== commandIndex && raw.startsWith("-")) {
				// `--opt=value`: the value may be a path (`--git-dir=/outside/x`).
				if (raw.startsWith("--")) {
					const flagEq = raw.indexOf("=");
					if (flagEq < 0) continue;
					const reason = checkWord(raw.slice(flagEq + 1));
					if (reason) return reason;
					continue;
				}
				// An attached short-flag value can be a path too: `git -C..`,
				// `git -C/etc`, `sort -o/tmp/x`, `less -o/tmp/x`. Only the tail
				// after the flag letter that looks like a path is audited, so
				// ordinary bundled flags (`ls -la`) keep working.
				if (raw.length > 2) {
					const attached = raw.slice(2);
					if (isPathLike(attached)) {
						const reason = checkWord(attached);
						if (reason) return reason;
					}
				}
				continue;
			}
			const eq = raw.indexOf("=");
			const isAssignment = eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.slice(0, eq));
			const reason = checkWord(isAssignment ? raw.slice(eq + 1) : raw);
			if (reason) return reason;
		}
	}

	return null;
}

/**
 * Shells and interpreters whose flags can run code the scope check never sees.
 * Versioned names are included (`python3.12`, `nodejs18`, `lua5.4`, …), plus
 * the TypeScript launchers and `npx` (which always runs a package). `npx` is
 * only a name match here; the loop rejects every `npx …` invocation outright.
 */
const CODE_INTERPRETER =
	/^(?:bash|sh|zsh|dash|ksh|csh|tcsh|fish|elvish|python3?(?:\.[0-9]+)*|perl[0-9.]*|ruby[0-9.]*|php[0-9.]*|node(?:js)?[0-9.]*|tclsh|lua[0-9.]*|Rscript|tsx|ts-node|npx|osascript|bun|deno)$/;

/**
 * Subcommands that make an interpreter run code or a remote package instead of
 * a script file: `deno eval`, `bun eval`, `bun x`. They are never auditable.
 */
const INTERPRETER_EXEC_WORDS = new Set(["eval", "x"]);

/**
 * The only flags a listed interpreter may be given inside a subagent: each one
 * prints information and cannot evaluate code. Matched exactly (case-sensitive,
 * no `=value` form), so every other flag is an escape by default. `--` is the
 * end-of-options marker: the words after it are audited as paths anyway.
 */
const INTERPRETER_SAFE_FLAGS = new Set([
	"--",
	"--version",
	"-v",
	"--help",
	"-h",
	"--experimental-strip-types",
	"--check",
	"--no-warnings",
	"--enable-source-maps",
]);

/**
 * Resolve a write target as the gate sees it: expand a leading `~`, then make
 * relative paths absolute against the session cwd.
 */
export function resolveWritePath(p: string, cwd: string): string {
	return resolveFromCwd(expandHome(p), cwd);
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
			read: Array.isArray(parsed?.read) ? parsed.read.filter((x): x is string => typeof x === "string") : [],
		};
	} catch {
		return { write: [], bash: [], read: [] };
	}
}

export function saveRules(filePath: string, rules: AllowRules): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const normalized: AllowRules = {
		write: rules.write ?? [],
		bash: rules.bash ?? [],
		read: rules.read ?? [],
	};
	const tmp = `${filePath}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
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
