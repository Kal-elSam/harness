import { type Component, compositeTuiLine, VStack } from "@earendil-works/pi-tui";
import { createChatViewport, type ChatViewport, type ChatViewportOptions } from "./chat-viewport.ts";

/** Default fixed-ish sidebar column width (terminal cells). */
export const SHELL_SIDEBAR_BASIS = 28;

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
