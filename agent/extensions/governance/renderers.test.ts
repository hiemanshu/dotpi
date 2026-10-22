/**
 * Renderer helper tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/governance/renderers.test.ts
 */

import assert from "node:assert";
import { railify } from "./text.ts";

assert.equal(railify("hello\nworld"), "> hello\n> world");
assert.equal(railify("hello\n\nworld"), "> hello\n>\n> world");
assert.equal(railify(""), ">");
assert.equal(railify("> quoted"), "> > quoted");

console.log("railify tests passed");
