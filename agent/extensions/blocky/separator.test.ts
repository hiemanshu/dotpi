/**
 * Separator helper tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/blocky/separator.test.ts
 */

import assert from "node:assert";
import { separatorLine } from "./separator.ts";

const measure = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, "").length;
const truncate = (text: string, width: number): string =>
	text.replace(/\x1b\[[0-9;]*m/g, "").slice(0, Math.max(0, width));
const border = (text: string): string => text;

const line = (width: number, left?: string, right?: string): string =>
	separatorLine({ width, left, right, border, measure, truncate });

assert.equal(line(0), "");
assert.equal(line(1), "─");
assert.equal(line(2), "──");

const withLabels = line(40, "message", "ctx 42%");
assert.equal(measure(withLabels), 40);
assert.ok(withLabels.startsWith("─ message "));
assert.ok(withLabels.endsWith(" ctx 42% ─"));

const cramped = line(20, "enter send · / commands · esc abort", "ctx 70%");
assert.equal(measure(cramped), 20);

const styled = line(30, "\x1b[31mmessage\x1b[39m", "\x1b[2mctx\x1b[0m");
assert.equal(measure(styled), 30);
assert.ok(styled.includes("message"));
assert.ok(styled.includes("ctx"));

console.log("separator tests passed");
