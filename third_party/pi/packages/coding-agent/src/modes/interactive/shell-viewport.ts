import { type Component, compositeTuiLine, VStack } from "@earendil-works/pi-tui";
import { type ChatViewport, type ChatViewportOptions, createChatViewport } from "./chat-viewport.ts";

/** Default fixed-ish sidebar column width (terminal cells). */
export const SHELL_SIDEBAR_BASIS = 28;

/**
 * Well-known layout-node symbol from `@earendil-works/pi-tui` (see
 * `packages/tui/src/layout-node.ts`). It is a global `Symbol.for(...)` key,
 * not a class export, so any component can implement it without importing
 * pi-tui's internal layout module — the same technique the fork's own
 * shell-viewport tests already use to inspect layout nodes.
 *
 * A component that implements this symbol is "layout-transparent": the real
 * fullscreen renderer (`renderLayoutFrame` in `packages/tui/src/layout.ts`,
 * driving `TuiAltScreen`'s render loop) walks it top-down with a real height
 * budget at every level, instead of treating it as an opaque leaf and calling
 * its bare `render(width)` — which has no height parameter at all. Without
 * this, every nested `VStack` with `grow`/`basis: 0` entries (the transcript,
 * the editor dock, the footer) computes sizes with no available height to
 * distribute (see `VStack.render` in `packages/tui/src/components/v-stack.ts`,
 * which passes `availableSize: undefined` to `allocateStackSizes`), so those
 * entries collapse to zero rows instead of flexing to fill the screen.
 */
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

/** Minimal shape of pi-tui's internal `StackLayoutNode`/`StackLayoutEntry`
 * (see `packages/tui/src/layout-node.ts`) — not exported from the package's
 * public API, so declared locally to the fields `CollapsibleSidebarLayout`
 * actually produces. */
interface ShellStackLayoutEntry {
	readonly component: Component;
	readonly basis?: number | "auto";
	readonly grow?: number;
	readonly shrink?: number;
	readonly minSize?: number;
}

interface ShellStackLayoutNode {
	readonly type: "hstack";
	readonly entries: readonly ShellStackLayoutEntry[];
	readonly gap: number;
	readonly align: "stretch";
}

/**
 * Two-column layout: a fixed-width sidebar next to a flexible main column,
 * where the sidebar collapses to ZERO width — giving the main column the
 * full available width — whenever the sidebar renders no lines at the
 * current width. Re-evaluated on every render(), so a live width change
 * (or a live content change from the extension owning the sidebar) grows
 * or collapses the reserved column with no other wiring.
 *
 * The generic HStack this replaces always reserved its fixed `basis` for
 * a present entry regardless of what that entry actually rendered. Kairo
 * reported the resulting regression: at a width where its extension
 * decided to render an empty sidebar (e.g. below its own 90-column
 * threshold), the HStack still reserved SHELL_SIDEBAR_BASIS columns for
 * it, leaving the chat only `width - SHELL_SIDEBAR_BASIS` columns even
 * though nothing occupied them, and truncating the status bar enough to
 * hide the bound session id.
 */
export class CollapsibleSidebarLayout implements Component {
	private readonly sidebar: Component;
	private readonly main: Component;
	private readonly sidebarBasis: number;
	private readonly gap: number;

	constructor(sidebar: Component, main: Component, sidebarBasis: number, gap = 0) {
		this.sidebar = sidebar;
		this.main = main;
		this.sidebarBasis = sidebarBasis;
		this.gap = gap;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const sidebarWidth = Math.min(this.sidebarBasis, safeWidth);
		const sidebarLines = sidebarWidth > 0 ? this.sidebar.render(sidebarWidth) : [];
		if (sidebarLines.length === 0) {
			return this.main.render(safeWidth);
		}

		const mainWidth = Math.max(1, safeWidth - sidebarWidth - this.gap);
		const mainLines = this.main.render(mainWidth);
		const height = Math.max(sidebarLines.length, mainLines.length);
		const blankBase = " ".repeat(safeWidth);
		const lines: string[] = [];
		for (let row = 0; row < height; row++) {
			let line = compositeTuiLine(blankBase, sidebarLines[row] ?? "", 0, sidebarWidth, safeWidth);
			line = compositeTuiLine(line, mainLines[row] ?? "", sidebarWidth + this.gap, mainWidth, safeWidth);
			lines.push(line);
		}
		return lines;
	}

	invalidate(): void {
		this.sidebar.invalidate();
		this.main.invalidate();
	}

	/**
	 * Layout-transparent hstack: the real fullscreen renderer (see the
	 * `LAYOUT_NODE` doc above) walks this tree top-down, distributing a real
	 * height budget to `this.main` (a `VStack` whose transcript/dock entries
	 * rely on that budget to flex). `render(width)` above is preserved for
	 * direct/opaque callers (existing unit tests, and `TuiAltScreen`'s
	 * fallback `render(width)` compat path) and produces the same visual
	 * result, but it has no width-independent way to reproduce the real
	 * renderer's height-aware layout — that only happens through this method.
	 *
	 * The sidebar's basis is computed the same way `render()` does: render it
	 * once at its fixed basis width and collapse to zero columns if it comes
	 * back empty, re-evaluated on every call (so a live resize or a live
	 * content change reflows with no rebuild — same guarantee `render()`
	 * already gives, now also honored by the real height-aware path).
	 */
	[LAYOUT_NODE](): ShellStackLayoutNode {
		const basis = this.sidebar.render(Math.max(1, this.sidebarBasis)).length === 0 ? 0 : this.sidebarBasis;
		return {
			type: "hstack",
			entries: [
				{ component: this.sidebar, basis, grow: 0, shrink: 0, minSize: 0 },
				{ component: this.main, basis: "auto", grow: 1, shrink: 1, minSize: 1 },
			],
			gap: this.gap,
			align: "stretch",
		};
	}
}

export interface ShellViewportOptions extends ChatViewportOptions {
	readonly sidebar?: Component;
	readonly bottomStrip?: Component;
	readonly sidebarBasis?: number;
}

export interface ShellViewport extends ChatViewport {
	readonly root: Component;
}

/**
 * Fullscreen shell around the existing chat viewport:
 * optional left sidebar | chat column (transcript + dock), optional bottom strip.
 * Does not replace transcript, editor dock, or built-in footer.
 */
export function createShellViewport(options: ShellViewportOptions): ShellViewport {
	const chat = createChatViewport(options);
	const sidebarBasis = options.sidebarBasis ?? SHELL_SIDEBAR_BASIS;

	let mainColumn: Component = chat.root;
	if (options.bottomStrip !== undefined) {
		mainColumn = new VStack([
			{ component: chat.root, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: options.bottomStrip, basis: "auto", grow: 0, shrink: 1, minSize: 0 },
		]);
	}

	if (options.sidebar === undefined) {
		return {
			transcript: chat.transcript,
			root: mainColumn,
		};
	}

	return {
		transcript: chat.transcript,
		root: new CollapsibleSidebarLayout(options.sidebar, mainColumn, sidebarBasis),
	};
}
