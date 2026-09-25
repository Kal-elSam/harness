/**
 * Extension UI shell slot API (H6): setSidebar / setBottomStrip exist and
 * must not throw when the interactive host is not in fullscreen.
 */
import { describe, expect, test, vi } from "vitest";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { theme } from "../../src/modes/interactive/theme/theme.ts";

describe("ExtensionUIContext shell slots (Kairo H6)", () => {
	test("setSidebar and setBottomStrip exist and are safe no-ops in regular mode", () => {
		const setExtensionSidebar = vi.fn();
		const setExtensionBottomStrip = vi.fn();
		const fakeThis: Record<string, unknown> = {
			ui: { requestRender: vi.fn(), terminal: { setTitle: vi.fn() } },
			themeController: {
				setThemeInstance: vi.fn(),
				setThemeName: vi.fn(() => ({ success: true })),
			},
			settingsManager: { getTheme: () => "dark", setTheme: vi.fn() },
			renderer: { mode: "regular" },
			showExtensionSelector: vi.fn(),
			showExtensionConfirm: vi.fn(),
			showExtensionInput: vi.fn(),
			showExtensionNotify: vi.fn(),
			addExtensionTerminalInputListener: vi.fn(() => () => {}),
			setExtensionStatus: vi.fn(),
			setWorkingVisible: vi.fn(),
			setWorkingIndicator: vi.fn(),
			setHiddenThinkingLabel: vi.fn(),
			setExtensionWidget: vi.fn(),
			setExtensionFooter: vi.fn(),
			setExtensionHeader: vi.fn(),
			setExtensionSidebar,
			setExtensionBottomStrip,
			showExtensionCustom: vi.fn(),
			showExtensionEditor: vi.fn(),
			setCustomEditorComponent: vi.fn(),
			setupAutocompleteProvider: vi.fn(),
			editor: { handleInput: vi.fn(), setText: vi.fn(), getText: () => "", getExpandedText: () => "" },
			autocompleteProviderWrappers: [],
			editorComponentFactory: undefined,
			toolOutputExpanded: false,
			setToolsExpanded: vi.fn(),
			workingMessage: undefined,
			activeStatusIndicator: undefined,
			defaultWorkingMessage: "working",
		};

		const uiContext = (
			InteractiveMode as unknown as { prototype: { createExtensionUIContext: () => ExtensionUIContext } }
		).prototype.createExtensionUIContext.call(fakeThis);

		expect(typeof uiContext.setSidebar).toBe("function");
		expect(typeof uiContext.setBottomStrip).toBe("function");
		expect(() => uiContext.setSidebar(["SPACES", "AGENTS"])).not.toThrow();
		expect(() => uiContext.setBottomStrip(["USAGE"])).not.toThrow();
		expect(() => uiContext.setSidebar(undefined)).not.toThrow();
		expect(() => uiContext.setBottomStrip(undefined)).not.toThrow();
		expect(setExtensionSidebar).toHaveBeenCalledWith(["SPACES", "AGENTS"]);
		expect(setExtensionSidebar).toHaveBeenCalledWith(undefined);
		expect(setExtensionBottomStrip).toHaveBeenCalledWith(["USAGE"]);
		expect(setExtensionBottomStrip).toHaveBeenCalledWith(undefined);
		expect(uiContext.theme).toBe(theme);
	});
});
