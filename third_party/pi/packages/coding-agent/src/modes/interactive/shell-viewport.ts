import { type Component, HStack, VStack } from "@earendil-works/pi-tui";
import { createChatViewport, type ChatViewport, type ChatViewportOptions } from "./chat-viewport.ts";

/** Default fixed-ish sidebar column width (terminal cells). */
export const SHELL_SIDEBAR_BASIS = 28;

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
		root: new HStack([
			{
				component: options.sidebar,
				basis: sidebarBasis,
				grow: 0,
				shrink: 0,
				minSize: 0,
			},
			{
				component: mainColumn,
				basis: 0,
				grow: 1,
				shrink: 1,
				minSize: 1,
			},
		]),
	};
}
