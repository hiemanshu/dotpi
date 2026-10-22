/**
 * TUI renderer tweaks:
 *   - every built-in tool result gets a uniform collapsed height; clicking the
 *     box (or ctrl+o) expands/collapses it through the default shell.
 *   - the edit tool opts out of the default boxed shell; force it back in.
 *   - user messages get a render-only Markdown blockquote so they show a left
 *     rail, without touching the stored transcript or model context.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { railify } from "./text.ts";

const BOXED_TOOLS = new Set(["bash", "powershell", "read", "grep", "find", "ls", "write", "edit"]);
const COLLAPSED_CONTENT_LINES = 4;

class FixedToolResult implements Component {
	private inner: Component;
	private expanded: boolean;
	private theme: Theme;

	constructor(inner: Component, expanded: boolean, theme: Theme) {
		this.inner = inner;
		this.expanded = expanded;
		this.theme = theme;
	}

	invalidate(): void {
		this.inner.invalidate?.();
	}

	render(width: number): string[] {
		const raw = this.inner.render(width);
		let start = 0;
		let end = raw.length;
		while (start < end && visibleWidth(raw[start]) === 0) start++;
		while (end > start && visibleWidth(raw[end - 1]) === 0) end--;
		const content = raw.slice(start, end);

		const limit = this.expanded ? content.length : COLLAPSED_CONTENT_LINES;
		const shown = content.slice(0, limit);

		if (!this.expanded) {
			while (shown.length < COLLAPSED_CONTENT_LINES) shown.push("");
		}

		const hint = this.expanded ? "▾ click to collapse" : "▸ click to expand";
		shown.push(truncateToWidth(this.theme.fg("dim", hint), width));
		return shown;
	}
}

function compactCallRenderer(toolName: string) {
	return (args: Record<string, unknown>, theme: Theme, context: { expanded: boolean }) => {
		const name = theme.fg("toolTitle", theme.bold(toolName));
		if (!context.expanded) return new Text(name, 0, 0);
		return new Text(`${name}\n${theme.fg("dim", JSON.stringify(args, null, 2))}`, 0, 0);
	};
}

export function installBlockRenderers(pi: ExtensionAPI): void {
	pi.registerToolRenderer((toolName, next) => {
		const renderers = next();
		if (!renderers) {
			return { renderCall: compactCallRenderer(toolName) };
		}
		if (!BOXED_TOOLS.has(toolName)) {
			// Tools with their own call renderer keep it; otherwise hide the raw
			// argument JSON behind expand.
			if (renderers.renderCall) return renderers;
			return { ...renderers, renderCall: compactCallRenderer(toolName) };
		}
		const originalResult = renderers.renderResult;

		return {
			...renderers,
			renderShell: "default",
			renderCall:
				toolName === "edit"
					? (args, theme) => {
							const rawPath =
								typeof args?.path === "string"
									? args.path
									: typeof args?.file_path === "string"
										? args.file_path
										: "(no path)";
							return new Text(
								`${theme.fg("toolTitle", theme.bold("edit"))} ${theme.fg("accent", rawPath)}`,
								0,
								0,
							);
						}
					: renderers.renderCall,
			renderResult: originalResult
				? (result, options, theme, context) => {
						// Built-in result renderers reuse context.lastComponent and call
						// Container methods on it. Keep their component, not our wrapper, so
						// streaming updates mutate the right object.
						const state = context.state as { fixedToolInner?: Component } | undefined;
						const previousInner = state?.fixedToolInner;
						const innerContext = previousInner ? { ...context, lastComponent: previousInner } : context;
						const inner = originalResult(result, options, theme, innerContext);
						if (!inner) return undefined;
						if (state) state.fixedToolInner = inner;
						return new FixedToolResult(inner, options.expanded, theme);
					}
				: undefined,
		};
	});
}

export function installUserMessageRail(pi: ExtensionAPI, isEnabled: () => boolean): void {
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType !== "user" || !isEnabled()) return markdown;
		return railify(markdown);
	});
}
