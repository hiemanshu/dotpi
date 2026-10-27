/**
 * Cache summary + formatting tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/governance/cache.test.ts
 */

import assert from "node:assert";
import {
	bucketFor,
	CACHE_GLYPH,
	formatCacheRate,
	formatCacheRateCompact,
	HIT_THRESHOLD,
	summarizeCache,
} from "./cache.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
	fn();
	passed++;
	console.log(`ok ${passed} - ${name}`);
}

const call = (input: number, cacheRead: number) => ({ input, cacheRead });

test("rate is cached over prompt tokens", () => {
	const summary = summarizeCache([call(5, 95), call(5, 95)]);
	assert.equal(summary.cachedTokens, 190);
	assert.equal(summary.promptTokens, 200);
	assert.equal(summary.rate, 0.95);
	assert.equal(summary.calls, 2);
});

test("a fresh session has no rate and no bucket", () => {
	const summary = summarizeCache([]);
	assert.equal(summary.rate, 0);
	assert.equal(summary.promptTokens, 0);
	assert.equal(summary.lastBucket, null);
	assert.equal(summary.calls, 0);
});

test("calls without prompt tokens are ignored", () => {
	const summary = summarizeCache([call(0, 0), call(10, 90), undefined as unknown as undefined]);
	assert.equal(summary.calls, 1);
	assert.equal(summary.promptTokens, 100);
	assert.equal(summary.rate, 0.9);
	assert.equal(summary.lastBucket, "hit");
});

test("last bucket follows the most recent call, not the average", () => {
	const summary = summarizeCache([call(100, 0), call(1, 99)]);
	assert.equal(summary.lastBucket, "hit");
	assert.ok(summary.rate < HIT_THRESHOLD);
});

test("buckets at the boundaries", () => {
	assert.equal(bucketFor(0), "miss");
	assert.equal(bucketFor(0.001), "partial");
	assert.equal(bucketFor(0.5), "partial");
	assert.equal(bucketFor(HIT_THRESHOLD), "hit");
	assert.equal(bucketFor(1), "hit");
});

test("bad numbers cannot produce a NaN rate", () => {
	const summary = summarizeCache([
		{ input: Number.NaN, cacheRead: 10 },
		{ input: -5, cacheRead: -1 },
	]);
	assert.equal(summary.rate, 1);
	assert.ok(Number.isFinite(summary.rate));
});

test("formatters", () => {
	assert.equal(formatCacheRate(0.963), "96.3%");
	assert.equal(formatCacheRate(0.9634), "96.3%");
	assert.equal(formatCacheRate(1), "100%");
	assert.equal(formatCacheRate(0.9996), "100%");
	assert.equal(formatCacheRate(0), "0.0%");
	assert.equal(formatCacheRate(Number.NaN), "0.0%");
	assert.equal(formatCacheRate(2), "100%");
	assert.equal(formatCacheRateCompact(0.963), "96%");
	assert.equal(formatCacheRateCompact(0.996), "100%");
	assert.equal(formatCacheRateCompact(0.004), "0%");
});

test("every bucket has a glyph", () => {
	assert.deepEqual(Object.keys(CACHE_GLYPH).sort(), ["hit", "miss", "partial"]);
	assert.equal(CACHE_GLYPH.hit, "●");
	assert.equal(CACHE_GLYPH.partial, "◐");
	assert.equal(CACHE_GLYPH.miss, "○");
});

console.log(`cache tests passed (${passed})`);
