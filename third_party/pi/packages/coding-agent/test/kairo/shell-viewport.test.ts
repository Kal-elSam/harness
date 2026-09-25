/**
 * Kairo shell slots (H6): fullscreen composition around createChatViewport.
 * Sidebar + bottom strip are extension-owned; chat column stays transcript + dock.
 */
import { Container, HStack, ScrollView, VStack } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createChatViewport } from "../../src/modes/interactive/chat-viewport.ts";
import { createShellViewport } from "../../src/modes/interactive/shell-viewport.ts";

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

describe("createShellViewport (Kairo H6)", () => {
	test("fullscreen composition includes sidebar + main when sidebar is set", () => {
		const sidebar = new Container();
		const viewport = createShellViewport({
			...chatParts(),
			sidebar,
		});

		expect(viewport.root).toBeInstanceOf(HStack);
		const layout = getStackLayout(viewport.root);
		expect(layout.type).toBe("hstack");
		expect(layout.entries).toHaveLength(2);
		expect(layout.entries[0]!.component).toBe(sidebar);
		expect(layout.entries[1]!.component).toBeInstanceOf(VStack);
	});

	test("sidebar uses fixed-ish basis (~28) and chat column grows", () => {
		const sidebar = new Container();
		const viewport = createShellViewport({
			...chatParts(),
			sidebar,
		});

		const layout = getStackLayout(viewport.root);
		const [side, main] = layout.entries;
		expect(side!.basis).toBe(28);
		expect(side!.grow ?? 0).toBe(0);
		expect(main!.grow).toBe(1);
		expect(main!.basis).toBe(0);
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
			sidebar: new Container(),
		});
		expect(withSide.root).toBeInstanceOf(HStack);

		const cleared = createShellViewport(chatParts());
		expect(cleared.root).not.toBeInstanceOf(HStack);
		const layout = getStackLayout(cleared.root);
		expect(layout.type).toBe("vstack");
	});

	test("transcript ScrollView remains primary; editor dock present", () => {
		const viewport = createShellViewport({
			...chatParts(),
			sidebar: new Container(),
		});

		expect(viewport.transcript).toBeInstanceOf(ScrollView);
		expect(viewport.transcript.primary).toBe(true);

		const shell = getStackLayout(viewport.root);
		const mainColumn = shell.entries[1]!.component;
		const mainLayout = getStackLayout(mainColumn);
		expect(mainLayout.type).toBe("vstack");
		expect(mainLayout.entries[0]!.component).toBe(viewport.transcript);
		expect(mainLayout.entries).toHaveLength(2);
	});

	test("optional bottomStrip sits below the chat column without replacing footer", () => {
		const bottomStrip = new Container();
		const footer = new Container();
		const viewport = createShellViewport({
			...chatParts(),
			footer,
			bottomStrip,
			sidebar: new Container(),
		});

		const shell = getStackLayout(viewport.root);
		const mainWithStrip = shell.entries[1]!.component;
		const column = getStackLayout(mainWithStrip);
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

	test("package version is 0.87.1-kairo.4", () => {
		const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
		const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
		expect(pkg.version).toBe("0.87.1-kairo.4");
	});
});
