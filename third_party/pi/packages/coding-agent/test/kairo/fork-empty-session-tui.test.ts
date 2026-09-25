/**
 * Kairo empty-session `/fork` TUI command test.
 *
 * Exercises `InteractiveMode.showUserMessageSelector()` (the private handler
 * bound to the `/fork` command and its keybinding) the same way upstream
 * tests other interactive-mode command handlers: by calling the method off
 * `InteractiveMode.prototype` with `.call(context)` against a minimal object
 * shaped like the slice of `this` the method actually reads/writes. See
 * test/interactive-mode-clone-command.test.ts for the existing upstream
 * pattern this reuses (it tests `handleCloneCommand` the same way). This is
 * the lowest level that really exercises the command path: it runs the real
 * method body (env-flag branch, empty-session branch, selector branch,
 * status text) without needing a real terminal/UI, PTY, or session file.
 *
 * Flag ON + empty session: `/fork` must call the runtime empty-fork path,
 * not show "No messages to fork from" and not open the message selector.
 * Flag OFF: `/fork` on an empty session must keep upstream's status message.
 * Neither case (empty or not) should ever call BOTH the selector and the
 * empty-fork path.
 */
import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";

const ENV_VAR = "KAIRO_PI_EMPTY_SESSIONS";

type ForkCommandContext = {
	session: { getUserMessagesForForking: () => Array<{ entryId: string; text: string }> };
	runtimeHost: {
		forkEmptySession: () => Promise<{ cancelled: boolean }>;
	};
	editor: { setText: (text: string) => void };
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	showSelector: (...args: unknown[]) => void;
	ui: { requestRender: () => void };
};

type InteractiveModePrototype = {
	showUserMessageSelector(this: ForkCommandContext): void;
	forkEmptySession(this: ForkCommandContext): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrototype;

function makeContext(userMessages: Array<{ entryId: string; text: string }>): ForkCommandContext & {
	forkEmptySessionSpy: ReturnType<typeof vi.fn>;
	setText: ReturnType<typeof vi.fn>;
	showStatus: ReturnType<typeof vi.fn>;
	showError: ReturnType<typeof vi.fn>;
	showSelector: ReturnType<typeof vi.fn>;
	requestRender: ReturnType<typeof vi.fn>;
} {
	const forkEmptySessionSpy = vi.fn(async () => ({ cancelled: false }));
	const setText = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const showSelector = vi.fn();
	const requestRender = vi.fn();

	return {
		session: { getUserMessagesForForking: () => userMessages },
		runtimeHost: { forkEmptySession: forkEmptySessionSpy },
		editor: { setText },
		showStatus,
		showError,
		showSelector,
		ui: { requestRender },
		forkEmptySessionSpy,
		setText,
		requestRender,
	};
}

describe("InteractiveMode /fork on an empty session", () => {
	const prevEnv = process.env[ENV_VAR];

	function restoreEnv() {
		if (prevEnv === undefined) {
			delete process.env[ENV_VAR];
		} else {
			process.env[ENV_VAR] = prevEnv;
		}
	}

	it("flag ON: forks immediately via the runtime empty-fork path, no status/selector", async () => {
		process.env[ENV_VAR] = "1";
		try {
			const context = makeContext([]);

			interactiveModePrototype.showUserMessageSelector.call(context);
			// showUserMessageSelector fires the empty-fork path without awaiting it
			// (void this.forkEmptySession()); flush microtasks before asserting.
			await Promise.resolve();
			await Promise.resolve();

			expect(context.forkEmptySessionSpy).toHaveBeenCalledTimes(1);
			expect(context.showSelector).not.toHaveBeenCalled();
			expect(context.showStatus).toHaveBeenCalledWith("Forked to new session");
			expect(context.showStatus).not.toHaveBeenCalledWith("No messages to fork from");
			expect(context.setText).toHaveBeenCalledWith("");
			expect(context.showError).not.toHaveBeenCalled();
		} finally {
			restoreEnv();
		}
	});

	it("flag ON + cancelled: requests a render, shows no status, forks nothing", async () => {
		process.env[ENV_VAR] = "1";
		try {
			const context = makeContext([]);
			context.forkEmptySessionSpy.mockResolvedValueOnce({ cancelled: true });

			interactiveModePrototype.showUserMessageSelector.call(context);
			await Promise.resolve();
			await Promise.resolve();

			expect(context.forkEmptySessionSpy).toHaveBeenCalledTimes(1);
			expect(context.requestRender).toHaveBeenCalledTimes(1);
			expect(context.showStatus).not.toHaveBeenCalled();
			expect(context.setText).not.toHaveBeenCalled();
		} finally {
			restoreEnv();
		}
	});

	it("flag OFF: keeps upstream's status message and never calls the empty-fork path", async () => {
		delete process.env[ENV_VAR];
		try {
			const context = makeContext([]);

			interactiveModePrototype.showUserMessageSelector.call(context);
			await Promise.resolve();

			expect(context.showStatus).toHaveBeenCalledWith("No messages to fork from");
			expect(context.forkEmptySessionSpy).not.toHaveBeenCalled();
			expect(context.showSelector).not.toHaveBeenCalled();
		} finally {
			restoreEnv();
		}
	});

	it("non-empty session, flag ON: opens the normal selector instead of the empty-fork path", async () => {
		process.env[ENV_VAR] = "1";
		try {
			const context = makeContext([{ entryId: "entry-1", text: "hello" }]);

			interactiveModePrototype.showUserMessageSelector.call(context);
			await Promise.resolve();

			expect(context.showSelector).toHaveBeenCalledTimes(1);
			expect(context.forkEmptySessionSpy).not.toHaveBeenCalled();
			expect(context.showStatus).not.toHaveBeenCalledWith("No messages to fork from");
		} finally {
			restoreEnv();
		}
	});
});
