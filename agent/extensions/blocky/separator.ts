/**
 * Flat separator line for the blocky input panel.
 *
 *   ─ message ─────────────────────────────────────
 *   ─ enter send · / commands · esc abort ─────────
 *
 * No corners or side borders: labels sit inside a full-width horizontal rule.
 * Labels may contain ANSI styling; measure/truncate handle it.
 */

export interface SeparatorOptions {
	width: number;
	left?: string;
	right?: string;
	border: (text: string) => string;
	measure: (text: string) => number;
	truncate: (text: string, width: number) => string;
}

export function separatorLine(options: SeparatorOptions): string {
	const width = Math.max(0, Math.floor(options.width));
	const { border, measure, truncate } = options;
	if (width <= 0) return "";
	if (width <= 2) return border("─".repeat(width));

	const segment = (label: string | undefined): string => (label ? ` ${label} ` : "");
	let left = options.left ?? "";
	let right = options.right ?? "";

	const tooWide = (): boolean => 2 + measure(segment(left)) + measure(segment(right)) + 1 > width;
	let guard = 0;
	while (tooWide() && right && guard++ < 1000) {
		right = truncate(right, Math.max(0, measure(right) - 1));
		if (measure(right) <= 0) right = "";
	}
	while (tooWide() && left && guard++ < 1000) {
		left = truncate(left, Math.max(0, measure(left) - 1));
		if (measure(left) <= 0) left = "";
	}

	const leftSegment = segment(left);
	const rightSegment = segment(right);
	const fill = Math.max(1, width - 2 - measure(leftSegment) - measure(rightSegment));
	return border("─") + leftSegment + border("─".repeat(fill)) + rightSegment + border("─");
}
