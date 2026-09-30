/**
 * Kairo H8d: full-screen layout regression.
 *
 * H8c fixed the WIDTH bug (an empty sidebar no longer reserves its 28-column
 * basis). It broke the VERTICAL layout while doing it: `CollapsibleSidebarLayout`
 * (which replaced the generic `HStack` sidebar/main split in shell-viewport.ts)
 * implements only `Component.render(width)` — a single-argument method with no
 * height budget. The REAL fullscreen renderer never calls that method on the
 * root component directly; it walks the `[LAYOUT_NODE]` tree top-down via
 * `renderLayoutFrame(root, width, height, ...)` (see
 * `packages/tui/src/layout.ts` and `TuiAltScreen`'s real render path), passing
 * a real height budget at every level so nested `VStack`s with `grow`/`basis:0`
 * entries (the transcript, the editor dock, the footer) can flex correctly.
 *
 * A component with no `[LAYOUT_NODE]()` is opaque to that walk: the engine
 * treats it as a single leaf and calls its bare `render(width)` — which has no
 * height parameter to distribute at all. Every VStack inside then computes
 * sizes with `availableSize: undefined` (see `VStack.render` in
 * `packages/tui/src/components/v-stack.ts`), so a `basis: 0, grow: 1` entry
 * (the transcript) collapses to zero and a `basis: 0` sibling (the chat column
 * inside the bottom-strip wrapper) does too — dropping the editor, the footer,
 * and the status bar entirely, while the top-anchored USAGE strip is all that
 * survives. That matches the exact regression this task describes: rows
 * 2-7 show USAGE at the TOP of the main column, rows 8-29 are blank.
 *
 * These tests exercise `renderLayoutFrame` directly (the real fullscreen path)
 * instead of calling `.render(width)` on the root component, because only
 * `renderLayoutFrame` has a height budget to distribute — the bug is
 * invisible to any test that only calls `.render(width)`.
 */
import { Container, type LayoutFrame, renderLayoutFrame, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { createShellViewport } from "../../src/modes/interactive/shell-viewport.ts";

const SIDEBAR_BASIS = 28;

/** A sidebar stand-in whose emptiness is toggled externally, exactly like the
 * Kairo extension's real sidebar (which decides emptiness from live terminal
 * columns inside its own render(), not from the width parameter it is given). */
function makeToggleableSidebar(initiallyVisible: boolean) {
	let visible = initiallyVisible;
	return {
		component: {
			render: (): string[] => (visible ? ["SPACES", "AGENTS"] : []),
			invalidate(): void {},
		},
		setVisible(next: boolean): void {
			visible = next;
		},
	};
}

function container(...lines: string[]): Container {
	const c = new Container();
	for (const line of lines) c.addChild(new Text(line, 0, 0));
	return c;
}

/** Many transcript lines so the ScrollView has real overflow content to flex around. */
function transcriptDocument(): Container {
	const lines = Array.from({ length: 80 }, (_, index) => `TRANSCRIPT-LINE-${index}`);
	return container(...lines);
}

function plainLines(frame: LayoutFrame): string[] {
	return frame.lines.map((line) => stripTerminalSequences(line));
}

function findRow(lines: string[], needle: string): number {
	return lines.findIndex((line) => line.includes(needle));
}

describe("full-screen shell layout (Kairo H8d)", () => {
	test("100x30 with a visible sidebar: editor/footer at the bottom of the main column, strip below them, transcript above, 28-col sidebar on the left", () => {
		const sidebar = makeToggleableSidebar(true);
		const bottomStrip = container("USAGE", "Codex 5h 50%");
		const viewport = createShellViewport({
			document: transcriptDocument(),
			pendingMessages: new Container(),
			status: container("STATUS-LINE"),
			editor: container("EDITOR-LINE"),
			footer: container("FOOTER-LINE"),
			sidebar: sidebar.component,
			bottomStrip,
		});

		const frame = renderLayoutFrame(viewport.root, 100, 30, () => {});
		expect(frame.lines).toHaveLength(30);
		const lines = plainLines(frame);

		const editorRow = findRow(lines, "EDITOR-LINE");
		const footerRow = findRow(lines, "FOOTER-LINE");
		const stripRow = findRow(lines, "USAGE");
		const transcriptRow = findRow(lines, "TRANSCRIPT-LINE-79"); // last (most recent) transcript line

		// The editor, the footer, and the strip must all actually be on screen.
		expect(editorRow).toBeGreaterThanOrEqual(0);
		expect(footerRow).toBeGreaterThanOrEqual(0);
		expect(stripRow).toBeGreaterThanOrEqual(0);
		expect(transcriptRow).toBeGreaterThanOrEqual(0);

		// Bottom-of-screen ordering: editor above footer, footer above the strip.
		expect(editorRow).toBeLessThan(footerRow);
		expect(footerRow).toBeLessThan(stripRow);
		// The transcript sits above the dock (editor/footer), not squashed at the top with everything else gone.
		expect(transcriptRow).toBeLessThan(editorRow);
		// The dock/strip must be near the bottom of a 30-row screen, not at the top (the regression symptom).
		expect(stripRow).toBeGreaterThan(20);

		// Sidebar occupies exactly the left 28 columns on every row it renders.
		const sidebarRow = lines.findIndex((line) => line.startsWith("SPACES"));
		expect(sidebarRow).toBeGreaterThanOrEqual(0);
		expect(lines[sidebarRow]!.slice(0, SIDEBAR_BASIS).trimEnd()).toBe("SPACES");
	});

	test("60x30 with an empty sidebar: full width goes to chat, editor and footer are still present", () => {
		const sidebar = makeToggleableSidebar(false);
		const bottomStrip = container("USAGE narrow");
		const viewport = createShellViewport({
			document: transcriptDocument(),
			pendingMessages: new Container(),
			status: container("STATUS-LINE"),
			editor: container("EDITOR-LINE"),
			footer: container("FOOTER-LINE"),
			sidebar: sidebar.component,
			bottomStrip,
		});

		const frame = renderLayoutFrame(viewport.root, 60, 30, () => {});
		expect(frame.lines).toHaveLength(30);
		const lines = plainLines(frame);

		expect(findRow(lines, "SPACES")).toBe(-1);
		const editorRow = findRow(lines, "EDITOR-LINE");
		const footerRow = findRow(lines, "FOOTER-LINE");
		expect(editorRow).toBeGreaterThanOrEqual(0);
		expect(footerRow).toBeGreaterThanOrEqual(0);
		expect(editorRow).toBeLessThan(footerRow);

		// No reserved blank sidebar gutter: chat content starts at column 0.
		const editorLine = lines[editorRow]!;
		expect(editorLine.startsWith("EDITOR-LINE")).toBe(true);
	});

	test("a live resize 100 -> 60 -> 100 on the same viewport instance relays out correctly every time", () => {
		const sidebar = makeToggleableSidebar(true);
		const bottomStrip = container("USAGE");
		const viewport = createShellViewport({
			document: transcriptDocument(),
			pendingMessages: new Container(),
			status: container("STATUS-LINE"),
			editor: container("EDITOR-LINE"),
			footer: container("FOOTER-LINE"),
			sidebar: sidebar.component,
			bottomStrip,
		});

		// 100 cols, sidebar visible.
		let frame = renderLayoutFrame(viewport.root, 100, 30, () => {});
		let lines = plainLines(frame);
		expect(findRow(lines, "EDITOR-LINE")).toBeGreaterThanOrEqual(0);
		expect(findRow(lines, "FOOTER-LINE")).toBeGreaterThanOrEqual(0);
		expect(lines.some((line) => line.startsWith("SPACES"))).toBe(true);

		// Live resize to 60, and the extension's own width-driven decision hides
		// the sidebar — same component instances throughout, no rebuild.
		sidebar.setVisible(false);
		frame = renderLayoutFrame(viewport.root, 60, 30, () => {});
		lines = plainLines(frame);
		expect(findRow(lines, "EDITOR-LINE")).toBeGreaterThanOrEqual(0);
		expect(findRow(lines, "FOOTER-LINE")).toBeGreaterThanOrEqual(0);
		expect(lines.some((line) => line.startsWith("SPACES"))).toBe(false);

		// Back to 100, sidebar visible again.
		sidebar.setVisible(true);
		frame = renderLayoutFrame(viewport.root, 100, 30, () => {});
		lines = plainLines(frame);
		const editorRow = findRow(lines, "EDITOR-LINE");
		const footerRow = findRow(lines, "FOOTER-LINE");
		expect(editorRow).toBeGreaterThanOrEqual(0);
		expect(footerRow).toBeGreaterThanOrEqual(0);
		expect(editorRow).toBeLessThan(footerRow);
		expect(lines.some((line) => line.startsWith("SPACES"))).toBe(true);
	});
});
