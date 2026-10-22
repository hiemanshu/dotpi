/**
 * Blocky: single-pane, opencode-inspired chrome for pi's TUI.
 *
 * Replaces the editor with a flat input panel (top/bottom separator rules and a
 * dark-violet content block) and hides the separate working row (the spinner
 * lives in the top rule). Tools already render in their default background
 * shell, so this extension does not wrap them.
 *
 * TUI only. In print/json/rpc modes nothing is installed.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { BoxedEditor } from "./boxed-editor.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HINT = "enter send · / commands · esc abort";
const LABEL = "message";

export default function blockyExtension(pi: ExtensionAPI): void {
	let enabled = false;
	// User intent from /blocky: keeps the lazy reinstall from undoing an opt-out.
	let userDisabled = false;
	let working = false;
	let spinnerIndex = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let activeTui: TUI | undefined;
	let activeCtx: ExtensionContext | undefined;

	function stopSpinner(): void {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = undefined;
		}
	}

	function syncSpinner(): void {
		if (!enabled || !working) {
			stopSpinner();
			return;
		}
		if (spinnerTimer) return;
		spinnerTimer = setInterval(() => {
			spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
			activeTui?.requestRender();
		}, 80);
	}

	function theme(): Theme | undefined {
		return activeCtx?.mode === "tui" ? activeCtx.ui.theme : undefined;
	}

	function installEditor(ctx: ExtensionContext): void {
		if (enabled) return;
		if (ctx.mode !== "tui") return;
		activeCtx = ctx;
		enabled = true;
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setEditorComponent((tui, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
			activeTui = tui;
			return new BoxedEditor(tui, editorTheme, keybindings, {
				getLabel: () => LABEL,
				getHint: () => HINT,
				isWorking: () => working,
				getSpinner: () => SPINNER_FRAMES[spinnerIndex] ?? SPINNER_FRAMES[0],
				getTheme: theme,
			});
		});
		syncSpinner();
	}

	function removeEditor(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		enabled = false;
		stopSpinner();
		activeTui = undefined;
		ctx.ui.setEditorComponent(undefined);
		// The default editor does not draw the spinner, so give the working row back.
		ctx.ui.setWorkingVisible(true);
	}

	pi.on("session_start", (_event, ctx) => {
		installEditor(ctx);
	});

	// Chrome is runtime state: after /reload session_start is not guaranteed to
	// re-fire, so reinstall the editor lazily on the next run.
	pi.on("before_agent_start", (_event, ctx) => {
		if (!enabled && !userDisabled) installEditor(ctx);
	});

	pi.on("agent_start", () => {
		working = true;
		syncSpinner();
		activeTui?.requestRender();
	});

	pi.on("agent_settled", () => {
		working = false;
		stopSpinner();
		activeTui?.requestRender();
	});

	pi.on("session_shutdown", () => {
		working = false;
		enabled = false;
		stopSpinner();
		activeTui = undefined;
	});

	pi.registerCommand("blocky", {
		description: "Toggle the blocky boxed input (default editor on/off)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (enabled) {
				userDisabled = true;
				removeEditor(ctx);
				ctx.ui.notify("Blocky off — default editor and working row restored.", "info");
			} else {
				userDisabled = false;
				installEditor(ctx);
				ctx.ui.notify("Blocky on — boxed input, spinner in the box header.", "info");
			}
		},
	});
}
