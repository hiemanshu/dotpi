/**
 * TUI chrome for the governance extension: footer + working indicator.
 */

import * as path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { throughputParts, type ThroughputSnapshot } from "./throughput.ts";

export interface FooterState {
	passcodeActive: boolean;
	throughput: () => ThroughputSnapshot;
}

/** Lets the extension repaint the footer without owning a timer. */
export interface FooterHandle {
	requestRender(): void;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * `⚡142 tok/s · 0.9s ttft` — accent while a reply streams, muted for the last
 * completed call. `≈` marks a rate that still includes startup (no ttft known),
 * `~` a rate estimated from streamed characters. When the full form does not fit
 * the left group the segment falls back to `⚡142 · 0.9s`, and it is hidden
 * entirely before the first measured call.
 */
function throughputSegment(snapshot: ThroughputSnapshot, theme: Theme, form: "full" | "compact"): string | null {
	const parts = throughputParts(snapshot.sample);
	if (!parts) return null;
	return theme.fg(snapshot.live ? "accent" : "muted", parts[form]);
}

/** Color the streaming spinner. TUI only. */
export function applyWorkingIndicator(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setWorkingIndicator({
		frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg("accent", frame)),
		intervalMs: 80,
	});
}

/**
 * Persistent title bar above the editor: project on the left, model on the
 * right. A widget instead of a header, because pi's header scrolls with the
 * transcript.
 */
export function installGovernanceTitleBar(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setWidget(
		"governance-title",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const project = path.basename(ctx.cwd) || ctx.cwd;
				const projectLabel = project.length > 32 ? `${project.slice(0, 31)}…` : project;
				const left = `  π  ${projectLabel}`;
				const model = ctx.model?.id ?? "no-model";
				const right = `${model}  `;
				const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [theme.style(truncateToWidth(left + gap + right, width), { fg: "text", bg: "toolPendingBg" })];
			},
		}),
		{ placement: "aboveEditor" },
	);
}

/**
 * One-line footer: session title, context usage, live throughput and session
 * totals on the left; git branch and cost on the right. TUI only.
 */
export function installGovernanceFooter(
	ctx: ExtensionContext,
	getState: () => FooterState,
): FooterHandle {
	const mounted: { tui: TUI | undefined } = { tui: undefined };
	if (ctx.mode !== "tui") return { requestRender: () => {} };
	ctx.ui.setFooter((tui, theme, footerData) => {
		mounted.tui = tui;
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose() {
				mounted.tui = undefined;
				unsubscribe();
			},
			render(width: number): string[] {
				const state = getState();

				let input = 0;
				let output = 0;
				let cost = 0;
				for (const entry of ctx.sessionManager.getBranch()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const message = entry.message as AssistantMessage;
						input += message.usage.input;
						output += message.usage.output;
						cost += message.usage.cost.total;
					}
				}

				const usage = ctx.getContextUsage();
				const ctxLabel = usage?.percent != null ? `ctx ${Math.round(usage.percent)}%` : "ctx ?";
				const title = ctx.sessionManager.getSessionName()?.trim() || "session";
				const titleStyled =
					theme.fg("accent", title) + (state.passcodeActive ? ` ${theme.fg("warning", "🔑")}` : "");
				const separator = theme.fg("borderMuted", "  ·  ");
				const snapshot = state.throughput();
				const tokens = `↑${formatTokens(input)}  ↓${formatTokens(output)}`;
				// Throughput sits before the totals so it survives a narrow footer.
				const buildLeft = (form: "full" | "compact"): string => {
					const parts = [titleStyled, theme.fg("muted", ctxLabel)];
					const tps = throughputSegment(snapshot, theme, form);
					if (tps) parts.push(tps);
					parts.push(theme.fg("muted", tokens));
					return `  ${parts.join(separator)}`;
				};
				const branch = footerData.getGitBranch();
				const rightParts = branch ? [`⎇ ${branch}`, `$${cost.toFixed(3)}`] : [`$${cost.toFixed(3)}`];
				const right = `${theme.fg("muted", rightParts.join(separator))}  `;

				const maxLeft = Math.max(1, width - visibleWidth(right) - 1);
				let left = buildLeft("full");
				if (visibleWidth(left) > maxLeft) left = buildLeft("compact");
				const clippedLeft = truncateToWidth(left, maxLeft, "…");
				const gap = " ".repeat(Math.max(1, width - visibleWidth(clippedLeft) - visibleWidth(right)));
				const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
				return [rule, truncateToWidth(clippedLeft + gap + right, width), rule];
			},
		};
	});
	return { requestRender: () => mounted.tui?.requestRender() };
}
