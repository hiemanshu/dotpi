/**
 * Auto mode tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/governance/trust.test.ts
 *
 * Three things are checked: the `Status:` parse, the scan scope (a setup plan
 * must not grant trust in a project), and the gate matrix — auto mode covers
 * network/outside writes/MCP but never installs, and the hard block is not its
 * business at all.
 *
 * The last block also covers the `pi install` pattern added to the gate in the
 * same piece: without it, `pi install git:…` cloned and ran third-party
 * extension code without a prompt.
 */

import assert from "node:assert";
import * as path from "node:path";
import { autoVerdict, planScanDirs, planStatusOf, qualifyingPlan, statusHoldsTrust } from "./trust.ts";
import { installOrPublishReason } from "./utils.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
	fn();
	passed++;
	console.log(`ok ${passed} - ${name}`);
}

// ---------------------------------------------------------------------------
// Status parsing
// ---------------------------------------------------------------------------

const statusCases: Array<[string, string, Parameters<typeof planStatusOf>[0]]> = [
	["bold list form", "approved", "- **Status:** approved"],
	["bold with a trailing date", "approved", "- **Status:** approved (2026-11-08)"],
	["plain form", "approved", "Status: approved"],
	["table row", "approved", "| Status | approved |"],
	["in-progress", "in-progress", "- **Status:** in-progress"],
	["in progress with a space", "in-progress", "- **Status:** in progress"],
	["draft", "draft", "- **Status:** draft"],
	["done", "done", "- **Status:** done"],
	["superseded", "superseded", "- **Status:** superseded"],
	["uppercase", "approved", "- **STATUS:** APPROVED"],
	["value first, word after", "approved", "- **Status:** approved — was in-progress"],
	["unknown value", "none", "- **Status:** blocked"],
	["no status line", "none", "# 0017 — Bash allow-by-default\n\nSome prose."],
	["empty", "none", ""],
];

for (const [name, expected, text] of statusCases) {
	test(`status parse: ${name}`, () => {
		assert.equal(planStatusOf(text), expected);
	});
}

test("status parse: only the first 25 lines are read", () => {
	const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
	lines.push("- **Status:** approved");
	assert.equal(planStatusOf(lines.join("\n")), "none");
});

test("status parse: a 'Supersedes:' line is not a status line", () => {
	assert.equal(planStatusOf("- **Supersedes:** the allowlist bash model\n- **Status:** draft"), "draft");
});

test("status parse: the first parseable status wins", () => {
	assert.equal(planStatusOf("- **Status:** draft\n- **Status:** approved"), "draft");
});

test("status parse: an unparseable status line does not shadow a later one", () => {
	assert.equal(planStatusOf("- **Status:** blocked\n- **Status:** approved"), "approved");
});

test("only approved and in-progress hold trust", () => {
	assert.deepEqual(
		(["approved", "in-progress", "draft", "done", "superseded", "none"] as const).map(statusHoldsTrust),
		[true, true, false, false, false, false],
	);
});

// ---------------------------------------------------------------------------
// Which plan holds the mode on
// ---------------------------------------------------------------------------

const approvedPlan = { path: "/repo/docs/plans/0001-a.md", text: "- **Status:** approved" };
const donePlan = { path: "/repo/docs/plans/0002-b.md", text: "- **Status:** done" };
const draftPlan = { path: "/repo/docs/plans/0003-c.md", text: "- **Status:** draft" };
const progressPlan = { path: "/repo/docs/plans/0004-d.md", text: "- **Status:** in-progress" };

test("an approved plan qualifies", () => {
	assert.equal(qualifyingPlan([approvedPlan])?.path, approvedPlan.path);
});

test("an in-progress plan qualifies", () => {
	assert.equal(qualifyingPlan([progressPlan])?.path, progressPlan.path);
});

test("draft and done plans do not qualify", () => {
	assert.equal(qualifyingPlan([draftPlan, donePlan]), null);
});

test("no plan files means no auto mode", () => {
	assert.equal(qualifyingPlan([]), null);
});

test("the first qualifying plan is reported, skipping done ones", () => {
	assert.equal(qualifyingPlan([donePlan, draftPlan, progressPlan, approvedPlan])?.path, progressPlan.path);
});

// ---------------------------------------------------------------------------
// Scan scope
// ---------------------------------------------------------------------------

test("a project session scans <cwd>/docs/plans only", () => {
	const dirs = planScanDirs({ cwd: "/repo", piRoot: "/home/me/.pi" });
	assert.deepEqual(dirs, [path.join("/repo", "docs", "plans")]);
});

test("a session inside ~/.pi also scans ~/.pi/setup", () => {
	const dirs = planScanDirs({ cwd: "/home/me/.pi", piRoot: "/home/me/.pi" });
	assert.deepEqual(dirs, [path.join("/home/me/.pi", "docs", "plans"), path.join("/home/me/.pi", "setup")]);
});

test("a session in ~/.pi/setup scans both", () => {
	const dirs = planScanDirs({ cwd: "/home/me/.pi/setup", piRoot: "/home/me/.pi" });
	assert.equal(dirs.length, 2);
	assert.ok(dirs.includes(path.join("/home/me/.pi", "setup")));
});

test("a sibling of ~/.pi does not get the setup directory", () => {
	const dirs = planScanDirs({ cwd: "/home/me/.pi-other", piRoot: "/home/me/.pi" });
	assert.equal(dirs.length, 1);
});

// ---------------------------------------------------------------------------
// Gate matrix
// ---------------------------------------------------------------------------

test("auto mode allows a network/outside-write/destructive bash ask", () => {
	assert.equal(autoVerdict("bash", null), "allow");
});

test("auto mode still asks for an install", () => {
	assert.equal(autoVerdict("bash", "npm install left-pad"), "ask");
});

test("auto mode allows a write outside the trusted roots", () => {
	assert.equal(autoVerdict("write"), "allow");
});

test("auto mode allows an MCP tool with no rule", () => {
	assert.equal(autoVerdict("mcp"), "allow");
});

test("the install gate recognises pi install/update/remove", () => {
	for (const command of [
		"pi install git:github.com/DietrichGebert/ponytail",
		"pi update --extensions",
		"pi uninstall ponytail",
		"pi remove npm:@example/pi-tools",
	]) {
		assert.ok(installOrPublishReason(command), `expected ${command} to be an install`);
	}
});

test("the pi install pattern does not catch other pi commands", () => {
	for (const command of ["pi list", "pi --version", "pip install x", "python3 -m pip install x"]) {
		if (command.startsWith("pip")) {
			assert.ok(installOrPublishReason(command), `expected ${command} to be an install`);
			continue;
		}
		assert.equal(installOrPublishReason(command), null, `expected ${command} to stay free`);
	}
});

console.log(`trust tests passed (${passed})`);
