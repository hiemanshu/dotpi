/**
 * Flat-panel editor: pi's CustomEditor with top/bottom separator rules and a
 * dark-violet content block.
 *
 *   ─ ⠋ message ─────────────────────────────────────
 *    hello world
 *   ─ enter send · / commands · esc abort ───────────
 *
 * No rounded corners or side borders. The editor itself is still pi's Editor:
 * cursor handling, keybindings, autocomplete, history and IME keep working.
 */

import {
	CustomEditor,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { separatorLine } from "./separator.ts";

/** Values the editor pulls from the extension on every render. */
export interface BoxedEditorHost {
	/** Label shown on the top rule (for example `message`). */
	getLabel(): string;
	/** Bottom-left key hints. */
	getHint(): string;
	/** True while the agent is streaming. */
	isWorking(): boolean;
	/** Current spinner frame (single glyph). */
	getSpinner(): string;
	/** Theme accessor; undefined before the TUI context exists. */
	getTheme(): Theme | undefined;
}

/** Zero-width APC sentinels used to locate the border rows in `super.render`. */
const TOP_SENTINEL = "\u001b_pi:blocky:top\u0007";
const BOTTOM_SENTINEL = "\u001b_pi:blocky:bottom\u0007";

/** Minimum total width at which the separator chrome still makes sense. */
const MIN_CHROME_WIDTH = 8;

export class BoxedEditor extends CustomEditor {
	private readonly host: BoxedEditorHost;
	private drawChrome = true;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, host: BoxedEditorHost) {
		// paddingX 0: the chrome supplies the horizontal padding and the editor
		// keeps its one reserved cursor column, so the cursor never clips.
		super(tui, theme, keybindings, { paddingX: 0 });
		this.host = host;
	}

	protected renderTopBorder(width: number, hiddenLineCount: number): string {
		return this.drawChrome ? TOP_SENTINEL : super.renderTopBorder(width, hiddenLineCount);
	}

	protected renderBottomBorder(width: number, hiddenLineCount: number): string {
		return this.drawChrome ? BOTTOM_SENTINEL : super.renderBottomBorder(width, hiddenLineCount);
	}

	render(width: number): string[] {
		const totalWidth = Math.max(0, Math.floor(width));
		this.drawChrome = totalWidth >= MIN_CHROME_WIDTH;

		const innerWidth = this.drawChrome ? Math.max(1, totalWidth - 4) : Math.max(1, totalWidth);
		const lines = super.render(innerWidth);
		if (!this.drawChrome) return lines;

		const topIndex = lines.indexOf(TOP_SENTINEL);
		const bottomIndex = lines.indexOf(BOTTOM_SENTINEL);
		if (topIndex < 0 || bottomIndex <= topIndex) {
			// Should not happen, but never leak sentinels into the terminal.
			return lines.filter((line) => line !== TOP_SENTINEL && line !== BOTTOM_SENTINEL);
		}

		// Terminals cannot scale fonts per block. Bold gives the input more
		// visual weight than assistant output and thinking while keeping the
		// same cell size and preserving the cursor marker.
		const content = lines.slice(topIndex + 1, bottomIndex).map((line) => `\x1b[1m${line}\x1b[22m`);
		// The editor renders its autocomplete list after the bottom border. Keep
		// it below the bottom rule and indent it to the same width.
		const below = lines.slice(bottomIndex + 1);

		const theme = this.host.getTheme();
		const paint = (color: "accent" | "dim" | "muted", text: string): string =>
			theme ? theme.fg(color, text) : text;

		const label = this.host.getLabel();
		const topLeft = this.host.isWorking()
			? paint("accent", `${this.host.getSpinner()} ${label}`)
			: paint("muted", label);

		const border = (text: string) => this.borderColor(text);
		const measure = visibleWidth;
		const truncate = (text: string, maxWidth: number) => truncateToWidth(text, maxWidth, "");

		const top = separatorLine({ width: totalWidth, left: topLeft, border, measure, truncate });
		const bottom = separatorLine({
			width: totalWidth,
			left: paint("dim", this.host.getHint()),
			border,
			measure,
			truncate,
		});

		const contentWidth = Math.max(1, totalWidth - 4);
		const contentLines = content.map((line) => {
			const clipped = truncateToWidth(line, contentWidth, "");
			const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
			const row = `  ${clipped}${padding}  `;
			return theme ? theme.bg("userMessageBg", row) : row;
		});

		const belowLines = below.map((line) => {
			const clipped = truncateToWidth(line, contentWidth, "");
			const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
			return `  ${clipped}${padding}  `;
		});

		return [top, ...contentLines, bottom, ...belowLines];
	}
}
