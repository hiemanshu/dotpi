/**
 * TUI chrome for the governance extension: footer + working indicator.
 */

import * as path from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FooterState {
	planMode: boolean;
	passcodeActive: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Color the streaming spinner to match the current mode. TUI only. */
export function applyWorkingIndicator(ctx: ExtensionContext, planMode: boolean): void {
	if (ctx.mode !== "tui") return;
	const color = planMode ? "warning" : "accent";
	ctx.ui.setWorkingIndicator({
		frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg(color, frame)),
		intervalMs: 80,
	});
}

/**
 * Persistent title bar above the editor: project + mode + model.
 * A widget instead of a header, because pi's header scrolls with the transcript.
 */
export function installGovernanceTitleBar(ctx: ExtensionContext, getState: () => FooterState): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setWidget(
		"governance-title",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const state = getState();
				const project = path.basename(ctx.cwd) || ctx.cwd;
				const projectLabel = project.length > 32 ? `${project.slice(0, 31)}…` : project;
				const left = `  π  ${projectLabel}`;
				const mode = state.planMode ? "⏸ plan" : "▶ governed";
				const model = ctx.model?.id ?? "no-model";
				const right = `${mode}  ·  ${model}  `;
				const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [theme.style(truncateToWidth(left + gap + right, width), { fg: "text", bg: "toolPendingBg" })];
			},
		}),
		{ placement: "aboveEditor" },
	);
}

/**
 * One-line footer: mode badge, context usage, session totals on the left;
 * git branch and model on the right. TUI only.
 */
export function installGovernanceFooter(ctx: ExtensionContext, getState: () => FooterState): void {
	if (ctx.mode !== "tui") return;
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
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
				const left = `  ${[
					titleStyled,
					theme.fg("muted", ctxLabel),
					theme.fg("muted", `↑${formatTokens(input)}  ↓${formatTokens(output)}`),
				].join(separator)}`;
				const branch = footerData.getGitBranch();
				const rightParts = branch ? [`⎇ ${branch}`, `$${cost.toFixed(3)}`] : [`$${cost.toFixed(3)}`];
				const right = `${theme.fg("muted", rightParts.join(separator))}  `;

				const maxLeft = Math.max(1, width - visibleWidth(right) - 1);
				const clippedLeft = truncateToWidth(left, maxLeft, "…");
				const gap = " ".repeat(Math.max(1, width - visibleWidth(clippedLeft) - visibleWidth(right)));
				const rule = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
				return [rule, truncateToWidth(clippedLeft + gap + right, width), rule];
			},
		};
	});
}
