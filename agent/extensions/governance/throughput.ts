/**
 * Live throughput for the footer: time to first token (TTFT) and a
 * TTFT-excluded generation rate. Pure logic with an injectable clock so the
 * behaviour is testable without a running TUI or a provider.
 *
 * Per D-0028 the rate counts every token the model generates — text, thinking,
 * and tool-call argument JSON — so it lines up with `usage.output`. Tool results
 * (input side) and nested tool usage are not counted.
 */

/** Smallest generation window; keeps the first delta from reporting a huge rate. */
const MIN_GEN_MS = 50;

/** Minimal shape of the usage numbers the tracker needs. */
export interface ThroughputUsage {
	output?: number;
}

/** Minimal shape of the finalized assistant message the tracker needs. */
export interface ThroughputMessage {
	durationMs?: number;
	usage?: ThroughputUsage;
}

export interface ThroughputSample {
	output: number;
	/** Start of the request to the first delta; null when no delta was seen. */
	ttftMs: number | null;
	genMs: number;
	tokensPerSecond: number;
	/** True when the token count came from a character estimate, not usage. */
	estimated: boolean;
	/**
	 * True when the rate spans the whole call (no TTFT known), so it includes the
	 * time to first token and must not be presented as a generation-only rate.
	 */
	effective: boolean;
}

export interface ThroughputSnapshot {
	live: boolean;
	sample: ThroughputSample | null;
}

export interface ThroughputTracker {
	/** `at` is the real request-start timestamp when the caller has one. */
	start(at?: number): void;
	update(usage: ThroughputUsage | undefined, estimated?: boolean): ThroughputSample | null;
	end(message: ThroughputMessage | undefined): ThroughputSample | null;
	snapshot(): ThroughputSnapshot;
}

/** Coerce anything unusable (undefined, NaN, negative) to 0. */
function positive(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function rate(output: number, genMs: number): number {
	if (output <= 0 || !(genMs > 0)) return 0;
	const value = output / (genMs / 1000);
	return Number.isFinite(value) ? value : 0;
}

function sample(
	output: number,
	ttftMs: number | null,
	genMs: number,
	estimated: boolean,
): ThroughputSample {
	return {
		output,
		ttftMs,
		genMs,
		tokensPerSecond: rate(output, genMs),
		estimated,
		// No TTFT means the window starts at the request, so the rate includes it.
		effective: ttftMs === null && output > 0,
	};
}

/** "142" for fast streams, "9.4" below 10 tok/s; 9.96 rounds up to "10". */
export function formatRate(tokensPerSecond: number): string {
	if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return "0";
	if (tokensPerSecond < 10) {
		// Round first: 9.96 must render "10", never "10.0".
		const rounded = Number(tokensPerSecond.toFixed(1));
		return rounded < 10 ? tokensPerSecond.toFixed(1) : `${Math.round(rounded)}`;
	}
	return `${Math.round(tokensPerSecond)}`;
}

/** "0.9s", "1.2s" — one decimal of a second. */
export function formatTtft(ms: number): string {
	const seconds = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
	return `${seconds.toFixed(1)}s`;
}

/**
 * Footer segment as plain text, colour-free so it is testable: `⚡` + `≈` (the
 * rate includes startup) + `~` (the rate came from a character estimate) +
 * rate. `full` carries the unit and the ttft, `compact` drops both so the
 * segment survives a narrow footer. Null when there is nothing to show.
 */
export function throughputParts(
	sample: ThroughputSample | null | undefined,
): { full: string; compact: string } | null {
	if (!sample || !Number.isFinite(sample.tokensPerSecond) || sample.tokensPerSecond <= 0) return null;
	const prefix = `${sample.effective ? "≈" : ""}${sample.estimated ? "~" : ""}${formatRate(sample.tokensPerSecond)}`;
	const ttft = sample.ttftMs != null ? formatTtft(sample.ttftMs) : null;
	return {
		full: ttft ? `⚡${prefix} tok/s · ${ttft} ttft` : `⚡${prefix} tok/s`,
		compact: ttft ? `⚡${prefix} · ${ttft}` : `⚡${prefix}`,
	};
}

export function createThroughputTracker(clock: () => number = () => performance.now()): ThroughputTracker {
	let requestStartedAt: number | null = null;
	let firstDeltaAt: number | null = null;
	let live = false;
	let inFlight: ThroughputSample | null = null;
	let last: ThroughputSample | null = null;

	function start(at?: number): void {
		requestStartedAt = typeof at === "number" && Number.isFinite(at) ? at : clock();
		firstDeltaAt = null;
		inFlight = null;
		live = true;
	}

	function update(usage: ThroughputUsage | undefined, estimated = false): ThroughputSample | null {
		if (!live) return null;
		const now = clock();
		// Any chunk starts the stream — reasoning included — so record the delta even
		// while the token count is still 0 and the footer has nothing to show.
		if (firstDeltaAt === null) firstDeltaAt = now;

		const output = positive(usage?.output);
		// Nothing measured yet: the footer keeps showing nothing rather than 0 tok/s.
		if (output <= 0) return null;

		const ttftMs = requestStartedAt === null ? null : Math.max(firstDeltaAt - requestStartedAt, 0);
		const genMs = Math.max(now - firstDeltaAt, MIN_GEN_MS);
		inFlight = sample(output, ttftMs, genMs, estimated);
		return inFlight;
	}

	function end(message: ThroughputMessage | undefined): ThroughputSample | null {
		const reported = positive(message?.usage?.output);
		// Providers that never report usage still get the estimate built from deltas.
		const output = reported > 0 ? reported : (inFlight?.output ?? 0);
		// A real usage number is never an estimate; an estimate stays flagged when the
		// final message carries no usage at all.
		const estimated = reported > 0 ? false : inFlight?.estimated === true;

		const measured = message?.durationMs;
		const durationMs =
			typeof measured === "number" && Number.isFinite(measured) && measured > 0
				? measured
				: requestStartedAt !== null
					? Math.max(clock() - requestStartedAt, 0)
					: 0;

		const ttftMs =
			firstDeltaAt !== null && requestStartedAt !== null
				? Math.min(Math.max(firstDeltaAt - requestStartedAt, 0), durationMs)
				: null;
		// The floor applies with or without a TTFT, so a 60 ms call cannot report 3000 tok/s.
		const genMs = Math.max(durationMs - (ttftMs ?? 0), MIN_GEN_MS);

		// Aborted or errored calls keep the previous readable sample instead of 0 tok/s.
		if (output > 0) last = sample(output, ttftMs, genMs, estimated);

		live = false;
		inFlight = null;
		requestStartedAt = null;
		firstDeltaAt = null;
		return last;
	}

	function snapshot(): ThroughputSnapshot {
		return { live, sample: live ? inFlight : last };
	}

	return { start, update, end, snapshot };
}
