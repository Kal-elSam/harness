/**
 * Kairo shell slots (H6): fullscreen composition around createChatViewport.
 * Sidebar + bottom strip are extension-owned; chat column stays transcript + dock.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Component, Container, HStack, ScrollView, stripTerminalSequences, VStack } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import { CollapsibleSidebarLayout, createShellViewport } from "../../src/modes/interactive/shell-viewport.ts";

const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

interface StackLayoutEntry {
	component: unknown;
	basis?: number | "auto";
	grow?: number;
	shrink?: number;
}

interface StackLayoutNode {
	type: "vstack" | "hstack";
	entries: readonly StackLayoutEntry[];
}

function getStackLayout(component: unknown): StackLayoutNode {
	const candidate = component as { [key: symbol]: () => StackLayoutNode };
	const node = candidate[LAYOUT_NODE]?.();
	if (!node || (node.type !== "hstack" && node.type !== "vstack")) {
		throw new Error("expected stack layout node");
	}
	return node;
}

function chatParts() {
	return {
		document: new Container(),
		pendingMessages: new Container(),
		status: new Container(),
		editor: new Container(),
		footer: new Container(),
	};
}

/** A Component with fixed, injectable render output — for tests that need
 * exact control over what a sidebar/main slot renders, independent of the
 * real chat-viewport internals (see the Kairo H8b regression: the fork
 * must react to what a slot ACTUALLY renders, not just whether one is
 * present — see CollapsibleSidebarLayout's own doc). */
class FixedLinesComponent implements Component {
	private readonly lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width?: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

describe("createShellViewport (Kairo H6)", () => {
	test("fullscreen composition includes sidebar + main when the sidebar has content", () => {
		const sidebar = new FixedLinesComponent(["SIDE"]);
		const viewport = createShellViewport({
			...chatParts(),
			sidebar,
		});

		// H8b: the sidebar/main split is no longer a generic HStack — it
		// is CollapsibleSidebarLayout, which can react to what the sidebar
		// ACTUALLY renders (see its own doc and the collapse tests below).
		expect(viewport.root).toBeInstanceOf(CollapsibleSidebarLayout);
		expect(viewport.root).not.toBeInstanceOf(HStack);
		const lines = viewport.root.render(60);
		expect(lines.some((line) => stripTerminalSequences(line).includes("SIDE"))).toBe(true);
	});

	test("without sidebar, root is chat-only (no HStack shell)", () => {
		const viewport = createShellViewport(chatParts());
		expect(viewport.root).toBeInstanceOf(VStack);
		expect(viewport.root).not.toBeInstanceOf(HStack);

		const plain = createChatViewport(chatParts());
		expect(getStackLayout(viewport.root).type).toBe(getStackLayout(plain.root).type);
	});

	test("clearing sidebar (omit) yields no sidebar in layout", () => {
		const withSide = createShellViewport({
			...chatParts(),
			sidebar: new FixedLinesComponent(["SIDE"]),
		});
		expect(withSide.root).toBeInstanceOf(CollapsibleSidebarLayout);

		const cleared = createShellViewport(chatParts());
		expect(cleared.root).not.toBeInstanceOf(CollapsibleSidebarLayout);
		expect(cleared.root).not.toBeInstanceOf(HStack);
		const layout = getStackLayout(cleared.root);
		expect(layout.type).toBe("vstack");
	});

	test("transcript ScrollView remains primary; editor dock present", () => {
		// No sidebar here — this test is about the main column's own
		// composition (transcript + dock), which does not depend on whether
		// a sidebar wraps it. See CollapsibleSidebarLayout's own doc: with a
		// sidebar, viewport.root is that wrapper, not a Stack, so
		// getStackLayout would not apply here.
		const viewport = createShellViewport(chatParts());

		expect(viewport.transcript).toBeInstanceOf(ScrollView);
		expect(viewport.transcript.primary).toBe(true);

		const mainLayout = getStackLayout(viewport.root);
		expect(mainLayout.type).toBe("vstack");
		expect(mainLayout.entries[0]!.component).toBe(viewport.transcript);
		expect(mainLayout.entries).toHaveLength(2);
	});

	test("optional bottomStrip sits below the chat column without replacing footer", () => {
		const bottomStrip = new Container();
		const footer = new Container();
		// No sidebar — see the no-sidebar note above.
		const viewport = createShellViewport({
			...chatParts(),
			footer,
			bottomStrip,
		});

		const column = getStackLayout(viewport.root);
		expect(column.type).toBe("vstack");
		expect(column.entries).toHaveLength(2);
		expect(column.entries[1]!.component).toBe(bottomStrip);

		const chatColumn = column.entries[0]!.component;
		const chatLayout = getStackLayout(chatColumn);
		const dock = chatLayout.entries[1]!.component as Container;
		expect(dock).toBeInstanceOf(VStack);
		const dockLayout = getStackLayout(dock);
		const footerEntry = dockLayout.entries[dockLayout.entries.length - 1];
		expect(footerEntry!.component).toBe(footer);
	});

	// --- H8b (Kairo native review regression, 2026-09-25): a real PTY run
	// at 60 columns showed the sidebar column still reserved 28 columns
	// even though the extension deliberately rendered it empty below its
	// own 90-column threshold — leaving the chat only 32 columns and
	// truncating the status bar enough to hide the bound session id.
	// CollapsibleSidebarLayout must collapse the reserved column to zero
	// whenever the sidebar renders no lines, re-evaluated on every
	// render() call (a live resize, not just a fresh extension refresh).

	test("sidebar with content at 100 columns reserves exactly its 28-column basis", () => {
		const sidebar = new FixedLinesComponent(["SIDE"]);
		const main = new FixedLinesComponent(["MAIN"]);
		const layout = new CollapsibleSidebarLayout(sidebar, main, 28);

		const [line] = layout.render(100);
		const plain = stripTerminalSequences(line!);
		expect(plain.slice(0, 4)).toBe("SIDE");
		expect(plain.slice(28, 32)).toBe("MAIN");
	});

	test("sidebar returning no lines at 60 columns reserves zero columns — the main column gets the full width", () => {
		const emptySidebar = new FixedLinesComponent([]);
		const main = new FixedLinesComponent(["MAIN".padEnd(60, ".")]);
		const layout = new CollapsibleSidebarLayout(emptySidebar, main, 28);

		const lines = layout.render(60);
		expect(lines).toEqual(main.render(60));
		const plain = stripTerminalSequences(lines[0]!);
		expect(plain.startsWith("MAIN")).toBe(true);
		expect(plain).not.toMatch(/^ {2,}MAIN/);
	});

	test("a live resize from 100 to 60 and back relays out with no extension refresh — same component instances throughout", () => {
		let sidebarHasContent = true;
		const sidebar: Component = {
			render: () => (sidebarHasContent ? ["SIDE"] : []),
			invalidate: () => {},
		};
		const main: Component = {
			render: (width) => ["MAIN".padEnd(width, ".")],
			invalidate: () => {},
		};
		const layout = new CollapsibleSidebarLayout(sidebar, main, 28);

		// 100 cols, sidebar visible: main starts at column 28.
		let plain = stripTerminalSequences(layout.render(100)[0]!);
		expect(plain.slice(0, 4)).toBe("SIDE");
		expect(plain.slice(28, 32)).toBe("MAIN");

		// Live resize to 60 AND the extension's own width-driven decision
		// hides the sidebar — same layout instance, no new
		// CollapsibleSidebarLayout, no createShellViewport call.
		sidebarHasContent = false;
		plain = stripTerminalSequences(layout.render(60)[0]!);
		expect(plain.startsWith("MAIN")).toBe(true);
		expect(plain.length).toBeLessThanOrEqual(60);

		// And back to 100 with the sidebar visible again.
		sidebarHasContent = true;
		plain = stripTerminalSequences(layout.render(100)[0]!);
		expect(plain.slice(0, 4)).toBe("SIDE");
		expect(plain.slice(28, 32)).toBe("MAIN");
	});

	test("an empty bottomStrip already collapses to zero height (VStack auto-basis) — no fork change needed there", () => {
		// Isolates the bottomStrip entry's own basis:"auto" sizing (the
		// same mode createShellViewport uses for it): an empty strip's
		// intrinsic height is 0 lines, so VStack contributes zero rows for
		// it; a non-empty one contributes exactly its own rows. Uses
		// "auto" for the chat stand-in too (rather than createShellViewport's
		// exact basis:0/minSize:1 chat config) to isolate the strip's own
		// behavior from VStack.render's separate basis:0-with-no-height-
		// budget clamping, which is pre-existing and unrelated to H8b.
		const chatLike = new FixedLinesComponent(["CHAT-LINE-1", "CHAT-LINE-2"]);
		const emptyStrip = new FixedLinesComponent([]);
		const nonEmptyStrip = new FixedLinesComponent(["STRIP-LINE"]);

		const withEmptyStrip = new VStack([
			{ component: chatLike, basis: "auto", grow: 0, shrink: 0, minSize: 0 },
			{ component: emptyStrip, basis: "auto", grow: 0, shrink: 1, minSize: 0 },
		]);
		const withNonEmptyStrip = new VStack([
			{ component: chatLike, basis: "auto", grow: 0, shrink: 0, minSize: 0 },
			{ component: nonEmptyStrip, basis: "auto", grow: 0, shrink: 1, minSize: 0 },
		]);

		expect(withEmptyStrip.render(60)).toEqual(chatLike.render(60));
		expect(withNonEmptyStrip.render(60)).toEqual([...chatLike.render(60), ...nonEmptyStrip.render(60)]);
	});

	test("package version is 0.87.1-kairo.5", () => {
		const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
		const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
		expect(pkg.version).toBe("0.87.1-kairo.5");
	});
});
