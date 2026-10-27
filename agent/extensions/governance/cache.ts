/**
 * Cache-hit summary for the footer: how much of the conversation's prompt came
 * from the provider's prompt cache. Pure logic over recorded usage numbers, so
 * it is testable without a session or a provider.
 */

/** A cached fraction at or above this counts as a hit rather than a partial. */
export const HIT_THRESHOLD = 0.9;

/** The only usage fields the cache summary needs. */
export interface CacheUsage {
	input: number;
	cacheRead: number;
}

/** How one call was served: nothing cached, partly cached, or (almost) all of it. */
export type CacheBucket = "hit" | "partial" | "miss";

export interface CacheSummary {
	cachedTokens: number;
	promptTokens: number;
	/** Cached share of the prompt, 0..1. Zero when nothing is recorded yet. */
	rate: number;
	/** Bucket of the most recent call with usage; null before any call. */
	lastBucket: CacheBucket | null;
	/** Number of calls that contributed. */
	calls: number;
}

/** Glyph per bucket: filled = fully cached, half = partial, hollow = miss. */
export const CACHE_GLYPH: Record<CacheBucket, string> = {
	hit: "●",
	partial: "◐",
	miss: "○",
};

/** Bucket a single call's cached share; `0` is a miss, `>= HIT_THRESHOLD` a hit. */
export function bucketFor(cachedFraction: number): CacheBucket {
	if (!(cachedFraction > 0)) return "miss";
	return cachedFraction >= HIT_THRESHOLD ? "hit" : "partial";
}

/**
 * Sum cached and prompt tokens over recorded calls. Calls with no prompt tokens
 * (`input + cacheRead === 0`) are ignored so a failed or empty request cannot
 * drag the rate down.
 */
export function summarizeCache(usages: Iterable<CacheUsage | undefined>): CacheSummary {
	let cachedTokens = 0;
	let promptTokens = 0;
	let calls = 0;
	let lastBucket: CacheBucket | null = null;

	for (const usage of usages) {
		if (!usage) continue;
		const cached = positive(usage.cacheRead);
		const prompt = positive(usage.input) + cached;
		if (prompt <= 0) continue;
		cachedTokens += cached;
		promptTokens += prompt;
		calls++;
		lastBucket = bucketFor(cached / prompt);
	}

	return {
		cachedTokens,
		promptTokens,
		rate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
		lastBucket,
		calls,
	};
}

/** "96.3%", "100%", "0.0%" — one decimal, except a clean 100%. */
export function formatCacheRate(rate: number): string {
	const bounded = Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0;
	if (bounded >= 0.9995) return "100%";
	return `${(bounded * 100).toFixed(1)}%`;
}

/** Narrow-terminal form: "96%". */
export function formatCacheRateCompact(rate: number): string {
	const bounded = Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0;
	return `${Math.round(bounded * 100)}%`;
}

function positive(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
