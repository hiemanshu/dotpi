/**
 * Auto mode: while a plan in the repo says `approved` or `in-progress`, the
 * governance gate stops asking for everything except installs/publishes and the
 * hard-block list (D-0037).
 *
 * Pure functions only — no pi imports — so the parse rules, the scan scope, and
 * the gate matrix are testable without a session:
 *   node --experimental-strip-types trust.test.ts
 *
 * The mode is *derived*, never latched: the plan file is the switch, and it is
 * re-read on every turn. Nothing is written to disk, so a new session starts
 * with whatever the plan files say right then.
 */

import * as path from "node:path";
import { isInside } from "./utils.ts";

export type PlanStatus = "approved" | "in-progress" | "draft" | "done" | "superseded" | "none";

/** A plan file as read from disk: its path and its text. */
export interface PlanFile {
	path: string;
	text: string;
}

/** How far into a plan file the `Status:` line is looked for. */
export const STATUS_SCAN_LINES = 25;

/**
 * Read the status out of a plan file's header.
 *
 * The status lives on a line mentioning `Status` (`- **Status:** approved`,
 * `**Status:** in-progress`, a table row) and the first such line that parses to
 * a known value wins. `Status: approved — was in-progress` therefore reads as
 * approved: the value after the marker is what counts, not any word after it.
 */
export function planStatusOf(text: string): PlanStatus {
	const lines = text.split(/\r?\n/).slice(0, STATUS_SCAN_LINES);
	for (const line of lines) {
		if (!/status/i.test(line)) continue;
		// Everything after the marker; `\W{0,6}` eats `:**`, ` | ` and the like.
		const tail = (line.match(/status\b\W{0,6}(.*)$/i)?.[1] ?? "").toLowerCase();
		const value = tail.replace(/^[^a-z]+/, "");
		if (value.startsWith("in-progress") || value.startsWith("in progress")) return "in-progress";
		if (value.startsWith("approved")) return "approved";
		if (value.startsWith("draft")) return "draft";
		if (value.startsWith("done")) return "done";
		if (value.startsWith("superseded")) return "superseded";
	}
	return "none";
}

/** The statuses that hold auto mode on. */
export function statusHoldsTrust(status: PlanStatus): boolean {
	return status === "approved" || status === "in-progress";
}

/** The first plan whose status holds the mode on, or null when none does. */
export function qualifyingPlan(files: PlanFile[]): PlanFile | null {
	for (const file of files) {
		if (statusHoldsTrust(planStatusOf(file.text))) return file;
	}
	return null;
}

export interface TrustScope {
	/** Session working directory. */
	cwd: string;
	/** The pi config root (`~/.pi`). */
	piRoot: string;
}

/**
 * Where plan files are read from: `<cwd>/docs/plans` always, and
 * `~/.pi/setup` only when the session is working inside `~/.pi` — a setup plan
 * must not grant trust in a project.
 */
export function planScanDirs(scope: TrustScope): string[] {
	const dirs = [path.join(scope.cwd, "docs", "plans")];
	if (isInside(scope.piRoot, scope.cwd)) dirs.push(path.join(scope.piRoot, "setup"));
	return dirs;
}

/** The calls the normal gate asks about and auto mode may cover. */
export type AskKind = "bash" | "write" | "mcp";

/**
 * What auto mode does with a call the normal gate would have asked about.
 *
 * Everything is allowed except a bash install/publish: changing what software
 * runs on the machine is the one ask where a human's answer changes the
 * outcome, and the user kept it (0023). Hard blocks never reach this function —
 * `dangerousReason` is checked first and needs the passcode either way.
 */
export function autoVerdict(kind: AskKind, installReason: string | null = null): "allow" | "ask" {
	if (kind === "bash" && installReason) return "ask";
	return "allow";
}
