/**
 * Throughput tracker + formatting tests. Run with:
 *   node --experimental-strip-types ~/.pi/agent/extensions/governance/throughput.test.ts
 */

import assert from "node:assert";
import { createThroughputTracker, formatRate, formatTtft } from "./throughput.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
	fn();
	passed++;
	console.log(`ok ${passed} - ${name}`);
}

/** Injectable clock: tests advance time explicitly. */
function fakeClock(start = 0): { clock: () => number; advance: (ms: number) => void } {
	let now = start;
	return {
		clock: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

test("ttft is measured from start to the first delta", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(800);
	const sample = tracker.update({ output: 5 });
	assert.ok(sample);
	assert.equal(sample.ttftMs, 800);
	assert.equal(sample.output, 5);
});

test("start(at) anchors ttft to the real request timestamp", () => {
	const { clock } = fakeClock(1000);
	const tracker = createThroughputTracker(clock);
	tracker.start(200); // the provider request went out at t=200, outside the clock
	const live = tracker.update({ output: 5 });
	assert.ok(live);
	assert.equal(live.ttftMs, 800, "clock now (1000) minus the passed start (200)");

	const finished = tracker.end({ durationMs: 1800, usage: { output: 15 } });
	assert.ok(finished);
	assert.equal(finished.ttftMs, 800);
	assert.equal(finished.genMs, 1000);
	assert.equal(finished.tokensPerSecond, 15);
});

test("start(at) ignores a non-finite timestamp", () => {
	const { clock, advance } = fakeClock(500);
	const tracker = createThroughputTracker(clock);
	tracker.start(Number.NaN);
	advance(300);
	const sample = tracker.update({ output: 2 });
	assert.ok(sample);
	assert.equal(sample.ttftMs, 300, "falls back to the clock");
});

test("rate excludes ttft", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(900); // TTFT
	tracker.update({ output: 10 });
	advance(1000); // 1 s of generation
	const sample = tracker.update({ output: 55 });
	assert.ok(sample);
	assert.equal(sample.genMs, 1000);
	assert.equal(sample.tokensPerSecond, 55);
});

test("no delta means no ttft and the whole call is the rate window", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(400);
	const sample = tracker.end({ durationMs: 400, usage: { output: 4 } });
	assert.ok(sample);
	assert.equal(sample.ttftMs, null);
	assert.equal(sample.genMs, 400);
	assert.equal(sample.tokensPerSecond, 10);
	assert.equal(sample.estimated, false);
	assert.equal(sample.effective, true, "the rate spans the whole call");
});

test("zero output and zero elapsed are guarded", () => {
	const { clock } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	// No tokens yet: no sample at all, so the footer shows nothing.
	assert.equal(tracker.update({ output: 0 }), null);
	assert.deepEqual(tracker.snapshot(), { live: true, sample: null });

	// Same-instant first delta: the 50 ms floor keeps the rate finite.
	const sample = tracker.update({ output: 10 });
	assert.ok(sample);
	assert.equal(sample.genMs, 50);
	assert.equal(sample.tokensPerSecond, 200);
	assert.ok(Number.isFinite(sample.tokensPerSecond));

	assert.equal(tracker.update(undefined), null);
});

test("a zero-token first update still records the first delta time", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(300);
	// The first chunk may carry reasoning only: no count, but the stream did start.
	assert.equal(tracker.update({ output: 0 }), null, "footer stays empty before tokens");
	advance(200);
	const live = tracker.update({ output: 5 });
	assert.ok(live);
	assert.equal(live.ttftMs, 300, "ttft is anchored at the first chunk, not the first count");

	const finished = tracker.end({ durationMs: 1300, usage: { output: 25 } });
	assert.ok(finished);
	assert.equal(finished.ttftMs, 300);
	assert.equal(finished.genMs, 1000);
	assert.equal(finished.tokensPerSecond, 25);
});

test("ttft survives when the token count only arrives at the end", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(400);
	assert.equal(tracker.update({ output: 0 }), null);
	const finished = tracker.end({ durationMs: 1400, usage: { output: 30 } });
	assert.ok(finished);
	assert.equal(finished.ttftMs, 400);
	assert.equal(finished.genMs, 1000);
	assert.equal(finished.tokensPerSecond, 30);
	assert.equal(finished.effective, false, "a ttft means the rate is generation-only");
});

test("state resets between consecutive messages", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);

	tracker.start();
	advance(500);
	tracker.update({ output: 20 });
	advance(500);
	const first = tracker.end({ durationMs: 1000, usage: { output: 20 } });
	assert.ok(first);
	assert.equal(first.tokensPerSecond, 40);
	assert.equal(tracker.snapshot().live, false);
	assert.deepEqual(tracker.snapshot().sample, first);

	tracker.start();
	assert.equal(tracker.snapshot().live, true);
	assert.equal(tracker.snapshot().sample, null, "in-flight sample cleared");
	advance(200);
	const second = tracker.update({ output: 4 });
	assert.ok(second);
	assert.equal(second.ttftMs, 200, "ttft does not carry over");
});

test("end() uses durationMs minus ttftMs", () => {
	const { clock, advance } = fakeClock(100);
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(800); // first delta at 900 -> ttft 800
	tracker.update({ output: 10 });
	advance(5000); // stream ends long after the last delta
	const sample = tracker.end({ durationMs: 2800, usage: { output: 100 } });
	assert.ok(sample);
	assert.equal(sample.ttftMs, 800);
	assert.equal(sample.genMs, 2000);
	assert.equal(sample.tokensPerSecond, 50);
	assert.equal(tracker.snapshot().live, false);
});

test("ttft is clamped into [0, durationMs] and the floor applies", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(1500);
	tracker.update({ output: 3 });
	const sample = tracker.end({ durationMs: 1000, usage: { output: 3 } });
	assert.ok(sample);
	assert.equal(sample.ttftMs, 1000);
	assert.equal(sample.genMs, 50, "MIN_GEN_MS floor, not the 1 ms the window had left");
	assert.equal(sample.tokensPerSecond, 60, "no 3000 tok/s snap");
});

test("rates above 10 tok/s stay distinguishable near the floor", () => {
	const fast = fakeClock();
	const fastTracker = createThroughputTracker(fast.clock);
	fastTracker.start();
	fastTracker.update({ output: 3 });
	const fastSample = fastTracker.end({ durationMs: 50, usage: { output: 3 } });
	assert.ok(fastSample);
	assert.equal(fastSample.genMs, 50);
	assert.equal(fastSample.tokensPerSecond, 60);

	const slow = fakeClock();
	const slowTracker = createThroughputTracker(slow.clock);
	slowTracker.start();
	slowTracker.update({ output: 3 });
	const slowSample = slowTracker.end({ durationMs: 60, usage: { output: 3 } });
	assert.ok(slowSample);
	assert.equal(slowSample.genMs, 60);
	assert.equal(slowSample.tokensPerSecond, 50);

	assert.notEqual(
		fastSample.tokensPerSecond,
		slowSample.tokensPerSecond,
		"a 10 ms window difference must not snap to the same rate",
	);
});

test("estimated samples keep the flag and survive a missing final usage", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(300);
	const live = tracker.update({ output: 12 }, true);
	assert.ok(live);
	assert.equal(live.estimated, true);

	const finished = tracker.end({ durationMs: 1300, usage: { output: 0 } });
	assert.ok(finished);
	assert.equal(finished.estimated, true);
	assert.equal(finished.output, 12, "falls back to the character estimate");
	assert.equal(finished.tokensPerSecond, 12);
});

test("an estimate stays flagged when the final message has no usage", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(400);
	assert.ok(tracker.update({ output: 9 }, true));
	const finished = tracker.end({ durationMs: 1400 });
	assert.ok(finished);
	assert.equal(finished.output, 9);
	assert.equal(finished.estimated, true);
	assert.equal(finished.ttftMs, 400);
	assert.equal(finished.genMs, 1000);
	assert.equal(finished.tokensPerSecond, 9);
});

test("a real mid-stream count is never flagged as an estimate", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(200);
	tracker.update({ output: 7 }); // real usage mid-stream, not a character estimate
	const finished = tracker.end({ durationMs: 1200, usage: { output: 0 } });
	assert.ok(finished);
	assert.equal(finished.output, 7);
	assert.equal(finished.estimated, false, "a real number must not turn into an estimate");
	assert.equal(finished.genMs, 1000);
	assert.equal(finished.tokensPerSecond, 7);
});

test("a final usage number clears the estimate flag", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);
	tracker.start();
	advance(100);
	tracker.update({ output: 8 }, true);
	const sample = tracker.end({ durationMs: 1100, usage: { output: 100 } });
	assert.ok(sample);
	assert.equal(sample.estimated, false);
	assert.equal(sample.tokensPerSecond, 100);
});

test("an aborted call keeps the previous good sample", () => {
	const { clock, advance } = fakeClock();
	const tracker = createThroughputTracker(clock);

	tracker.start();
	advance(500);
	tracker.update({ output: 20 });
	advance(500);
	const good = tracker.end({ durationMs: 1000, usage: { output: 20 } });
	assert.ok(good);
	assert.equal(good.tokensPerSecond, 40);

	tracker.start();
	advance(700);
	assert.equal(tracker.update({ output: 0 }), null);
	advance(300);
	const aborted = tracker.end(undefined); // error path: no usage, no durationMs
	assert.equal(aborted, good, "the previous sample stays visible");
	assert.equal(tracker.snapshot().live, false);
	assert.deepEqual(tracker.snapshot().sample, good);
});

test("effective is set when the rate includes ttft", () => {
	const { clock } = fakeClock();
	const noDelta = createThroughputTracker(clock);
	noDelta.start();
	const whole = noDelta.end({ durationMs: 2000, usage: { output: 20 } });
	assert.ok(whole);
	assert.equal(whole.ttftMs, null);
	assert.equal(whole.effective, true, "the rate includes ttft");

	const withDelta = fakeClock();
	const measured = createThroughputTracker(withDelta.clock);
	measured.start();
	withDelta.advance(1000);
	measured.update({ output: 5 });
	const generationOnly = measured.end({ durationMs: 2000, usage: { output: 15 } });
	assert.ok(generationOnly);
	assert.equal(generationOnly.ttftMs, 1000);
	assert.equal(generationOnly.effective, false, "ttft is excluded from the rate");
});

test("end() without a start() does not throw", () => {
	const { clock } = fakeClock();
	const tracker = createThroughputTracker(clock);
	assert.equal(tracker.end(undefined), null, "no output and no previous sample");
	assert.equal(tracker.snapshot().live, false);
	assert.equal(tracker.snapshot().sample, null);
});

test("formatters", () => {
	assert.equal(formatRate(142.4), "142");
	assert.equal(formatRate(142), "142");
	assert.equal(formatRate(9.4), "9.4");
	assert.equal(formatRate(9.96), "10", "rounds up to 10, never \"10.0\"");
	assert.equal(formatRate(0), "0");
	assert.equal(formatRate(Number.NaN), "0");
	assert.equal(formatTtft(900), "0.9s");
	assert.equal(formatTtft(1249), "1.2s");
	assert.equal(formatTtft(0), "0.0s");
});

console.log(`throughput tests passed (${passed})`);
