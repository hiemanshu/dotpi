/** Pure text helpers for TUI renderers. */

/** Prefix each line with a Markdown quote marker; blank lines become `>`. */
export function railify(markdown: string): string {
	return markdown
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}
