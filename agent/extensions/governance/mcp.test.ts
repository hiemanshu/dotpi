/**
 * MCP tool allowlist tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/governance/mcp.test.ts
 *
 * These cover the rule forms the first-use prompt writes:
 *   - `mcp__rea__inspect_artifact` — one tool
 *   - `mcp__rea__*` — every tool from one server
 * and the persistence round-trip that keeps those rules alive when another
 * allowlist kind is saved.
 */

import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	addRule,
	loadRules,
	matchMcpRule,
	mcpServerOf,
	mcpServerRule,
	saveRules,
} from "./utils.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
	fn();
	passed++;
	console.log(`ok ${passed} - ${name}`);
}

// ---------------------------------------------------------------------------
// Exact-tool rules
// ---------------------------------------------------------------------------

test("exact rule matches its own tool", () => {
	assert.equal(matchMcpRule("mcp__rea__inspect_artifact", "mcp__rea__inspect_artifact"), true);
});

test("exact rule does not match a sibling tool", () => {
	assert.equal(matchMcpRule("mcp__rea__inspect_artifact", "mcp__rea__inspect_pe_resources"), false);
});

test("exact rule does not match the same tool on another server", () => {
	assert.equal(matchMcpRule("mcp__rea__inspect_artifact", "mcp__other__inspect_artifact"), false);
});

// ---------------------------------------------------------------------------
// Server-wide rules
// ---------------------------------------------------------------------------

test("server rule matches any tool on that server", () => {
	const rule = "mcp__rea__*";
	for (const tool of [
		"mcp__rea__inspect_artifact",
		"mcp__rea__execute_rizin_command",
		"mcp__rea__x",
	]) {
		assert.equal(matchMcpRule(rule, tool), true, tool);
	}
});

test("server rule does not leak to a prefix-colliding server", () => {
	// The trailing separator is what stops `rea` from matching `reach`.
	assert.equal(matchMcpRule("mcp__rea__*", "mcp__reach__tool"), false);
	assert.equal(matchMcpRule("mcp__rea__*", "mcp__react__tool"), false);
});

test("server rule does not match another server's tool", () => {
	assert.equal(matchMcpRule("mcp__rea__*", "mcp__websearch__web_search"), false);
});

test("server rule with an underscore server name still scopes correctly", () => {
	assert.equal(matchMcpRule("mcp__dev_radius__*", "mcp__dev_radius__tool_x"), true);
	assert.equal(matchMcpRule("mcp__dev_radius__*", "mcp__dev__radius_x"), false);
});

// ---------------------------------------------------------------------------
// Rules that must never become a catch-all
// ---------------------------------------------------------------------------

test("a bare wildcard never matches", () => {
	assert.equal(matchMcpRule("*", "mcp__rea__inspect_artifact"), false);
});

test("non-MCP rules never match an MCP tool", () => {
	for (const rule of ["mcp__", "npm test", "/tmp/", "websearch", "mcp_reax"]) {
		assert.equal(matchMcpRule(rule, "mcp__rea__inspect_artifact"), false, rule);
	}
});

test("MCP rules ignore surrounding whitespace but not case", () => {
	assert.equal(matchMcpRule("  mcp__rea__*  ", " mcp__rea__inspect_artifact "), true);
	assert.equal(matchMcpRule("mcp__REA__*", "mcp__rea__inspect_artifact"), false);
});

test("an empty rule matches nothing", () => {
	assert.equal(matchMcpRule("", "mcp__rea__inspect_artifact"), false);
});

// ---------------------------------------------------------------------------
// Server derivation
// ---------------------------------------------------------------------------

test("server name is taken up to the first separator after the prefix", () => {
	assert.equal(mcpServerOf("mcp__rea__inspect_artifact"), "rea");
	assert.equal(mcpServerOf("mcp__dev_radius__tool_x"), "dev_radius");
	assert.equal(mcpServerOf("mcp__websearch__web_fetch"), "websearch");
});

test("names without a server part yield null", () => {
	for (const tool of ["mcp__rea", "mcp__", "websearch", "mcp_rea_x", ""]) {
		assert.equal(mcpServerOf(tool), null, tool);
	}
});

test("server-wide rule is derived from a tool or a bare server name", () => {
	assert.equal(mcpServerRule("mcp__rea__inspect_artifact"), "mcp__rea__*");
	assert.equal(mcpServerRule("rea"), "mcp__rea__*");
	assert.equal(mcpServerRule("dev_radius"), "mcp__dev_radius__*");
});

test("derived server rule is itself a valid matcher for the server's tools", () => {
	const rule = mcpServerRule("mcp__rea__inspect_artifact");
	assert.equal(matchMcpRule(rule, "mcp__rea__execute_rizin_command"), true);
});

test("server names are mangled the way pi mangles them", () => {
	assert.equal(mcpServerRule("my.server"), "mcp__my_server__*");
	assert.equal(mcpServerRule("mcp__a-b_c__t"), "mcp__a-b_c__*");
});

// ---------------------------------------------------------------------------
// Persistence alongside the other rule kinds
// ---------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rea-mcp-rules-"));
const rulesPath = path.join(dir, "permissions.json");

test("a missing file loads an empty mcp list", () => {
	const rules = loadRules(path.join(dir, "does-not-exist.json"));
	assert.deepEqual(rules.mcp, []);
});

test("a file without an mcp key still loads", () => {
	const legacy = path.join(dir, "legacy.json");
	fs.writeFileSync(legacy, JSON.stringify({ write: ["~/x"], bash: ["git status"], read: [] }));
	const rules = loadRules(legacy);
	assert.deepEqual(rules.mcp, []);
	assert.deepEqual(rules.bash, ["git status"]);
});

test("saving an MCP rule round-trips", () => {
	const rules = loadRules(rulesPath);
	addRule(rules, "mcp", "mcp__rea__inspect_artifact");
	saveRules(rulesPath, rules);
	assert.deepEqual(loadRules(rulesPath).mcp, ["mcp__rea__inspect_artifact"]);
});

test("adding a bash rule does not erase existing MCP rules", () => {
	const rules = loadRules(rulesPath);
	addRule(rules, "bash", "git status");
	saveRules(rulesPath, rules);
	const reloaded = loadRules(rulesPath);
	assert.deepEqual(reloaded.bash, ["git status"]);
	assert.deepEqual(reloaded.mcp, ["mcp__rea__inspect_artifact"], "mcp rules must survive a bash-rule save");
});

test("adding a server-wide rule keeps the per-tool rule too", () => {
	const rules = loadRules(rulesPath);
	addRule(rules, "mcp", mcpServerRule("mcp__rea__inspect_artifact"));
	saveRules(rulesPath, rules);
	assert.deepEqual(loadRules(rulesPath).mcp, ["mcp__rea__inspect_artifact", "mcp__rea__*"]);
});

test("duplicate MCP rules are not added twice", () => {
	const rules = loadRules(rulesPath);
	const before = rules.mcp.length;
	addRule(rules, "mcp", "mcp__rea__inspect_artifact");
	assert.equal(rules.mcp.length, before);
});

test("non-string entries in the mcp list are dropped on load", () => {
	const dirty = path.join(dir, "dirty.json");
	fs.writeFileSync(dirty, JSON.stringify({ mcp: ["mcp__rea__*", 7, null, { a: 1 }] }));
	assert.deepEqual(loadRules(dirty).mcp, ["mcp__rea__*"]);
});

test("saved file keeps the other rule kinds byte-identical in shape", () => {
	const raw = JSON.parse(fs.readFileSync(rulesPath, "utf-8")) as Record<string, unknown>;
	assert.deepEqual(Object.keys(raw).sort(), ["bash", "mcp", "read", "write"]);
});

fs.rmSync(dir, { recursive: true, force: true });

console.log(`mcp tests passed (${passed})`);
