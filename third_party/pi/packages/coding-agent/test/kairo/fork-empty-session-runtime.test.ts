/**
 * Kairo empty-session `/fork` regression tests: forking a session with NO
 * user messages at all through `AgentSessionRuntime.forkEmptySession()`, end
 * to end, gated behind `KAIRO_PI_EMPTY_SESSIONS=1`.
 *
 * Upstream's `fork()` always resolves an existing entry via
 * `SessionManager.getEntry()`, so a session with no user messages has
 * nothing to select and upstream's TUI shows "No messages to fork from"
 * (see fork-empty-session-tui.test.ts for that command-level behavior).
 * This file covers the runtime path and the `session_before_fork` event
 * contract: `entryId: ""`, `position: "at"`, `emptySession: true`.
 *
 * Everything under test (SessionManager, AgentSessionRuntime,
 * createAgentSessionServices, createAgentSessionFromServices) is imported
 * from the BUILT BUNDLE (dist/bundle/index.js), not src and not dist/core,
 * matching the existing kairo empty-session tests. The faux model provider
 * from @earendil-works/pi-ai/compat is test scaffolding only, required to
 * construct a runtime; no prompt/completion is ever issued, so no model call
 * happens and no assistant message is faked into the session under test.
 *
 * The bundle is loaded via a computed dynamic import (not a static relative
 * ".js" import specifier) so it goes through the same module resolution the
 * built CLI uses, without tripping this repo's check:ts-imports rule, which
 * forbids relative ".js" import specifiers in source .ts files.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type {
	CreateAgentSessionRuntimeFactory,
	ExtensionAPI,
	ExtensionFactory,
	SessionBeforeForkEvent,
	SessionStartEvent,
} from "../../src/index.ts";

const ENV_VAR = "KAIRO_PI_EMPTY_SESSIONS";

const bundleUrl = new URL("../../dist/bundle/index.js", import.meta.url).href;
const { SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } =
	(await import(bundleUrl)) as typeof import("../../src/index.ts");

function userMsg(text: string) {
	return { role: "user" as const, content: text, timestamp: Date.now() };
}

describe("Kairo empty-session /fork via AgentSessionRuntime.forkEmptySession (dist/bundle)", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	const prevEnv = process.env[ENV_VAR];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
		if (prevEnv === undefined) {
			delete process.env[ENV_VAR];
		} else {
			process.env[ENV_VAR] = prevEnv;
		}
	});

	async function createRuntimeForTest(
		onSessionStart: (event: SessionStartEvent) => void,
		onBeforeFork?: (event: SessionBeforeForkEvent) => { cancel: boolean } | undefined,
	) {
		const tempDir = join(tmpdir(), `kairo-empty-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const sessionDir = join(tempDir, "sessions");
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({ models: [{ id: "faux-1", reasoning: false }] });

		const extensionFactory: ExtensionFactory = (pi: ExtensionAPI) => {
			pi.registerProvider(faux.getModel().provider, {
				baseUrl: faux.getModel().baseUrl,
				apiKey: "faux-key",
				api: faux.api,
				models: faux.models.map((registeredModel) => ({
					id: registeredModel.id,
					name: registeredModel.name,
					api: registeredModel.api,
					reasoning: registeredModel.reasoning,
					input: registeredModel.input,
					cost: registeredModel.cost,
					contextWindow: registeredModel.contextWindow,
					maxTokens: registeredModel.maxTokens,
				})),
			});
			pi.on("session_start", (event) => onSessionStart(event));
			if (onBeforeFork) {
				pi.on("session_before_fork", (event) => onBeforeFork(event));
			}
		};

		const runtimeOptions = {
			agentDir: tempDir,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				...runtimeOptions,
				cwd,
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir, sessionDir),
		});
		await runtime.session.bindExtensions({});

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, sessionDir };
	}

	it('gate ON + empty session: forks into a parent-linked child, emits session_before_fork(entryId:"", position:"at", emptySession:true) and session_start:fork', async () => {
		process.env[ENV_VAR] = "1";
		const events: SessionStartEvent[] = [];
		const beforeForkEvents: SessionBeforeForkEvent[] = [];
		const { runtime } = await createRuntimeForTest(
			(event) => events.push(event),
			(event) => {
				beforeForkEvents.push(event);
				return undefined;
			},
		);

		expect(runtime.session.getUserMessagesForForking()).toEqual([]);
		const previousSessionFile = runtime.session.sessionFile;

		events.length = 0;
		const forkResult = await runtime.forkEmptySession();
		expect(forkResult.cancelled).toBe(false);
		await runtime.session.bindExtensions({});

		expect(beforeForkEvents).toEqual([
			{ type: "session_before_fork", entryId: "", position: "at", emptySession: true },
		]);

		const forkedSessionFile = runtime.session.sessionFile!;
		expect(forkedSessionFile).not.toBe(previousSessionFile);
		expect(existsSync(forkedSessionFile)).toBe(true);

		const header = JSON.parse(readFileSync(forkedSessionFile, "utf8").split("\n")[0]);
		expect(header.parentSession).toBe(previousSessionFile);

		expect(events).toEqual([{ type: "session_start", reason: "fork", previousSessionFile }]);
		expect(runtime.session.getUserMessagesForForking()).toEqual([]);
	});

	it("cancellation creates nothing: a session_before_fork handler that cancels leaves the original session untouched", async () => {
		process.env[ENV_VAR] = "1";
		const events: SessionStartEvent[] = [];
		const { runtime } = await createRuntimeForTest(
			(event) => events.push(event),
			() => ({ cancel: true }),
		);

		const previousSessionFile = runtime.session.sessionFile;
		events.length = 0;

		const forkResult = await runtime.forkEmptySession();
		expect(forkResult.cancelled).toBe(true);
		expect(events).toEqual([]);
		expect(runtime.session.sessionFile).toBe(previousSessionFile);
	});

	it("gate OFF: forkEmptySession() rejects with a clear error", async () => {
		delete process.env[ENV_VAR];
		const { runtime } = await createRuntimeForTest(() => {});

		await expect(runtime.forkEmptySession()).rejects.toThrow(/Invalid entry ID for forking/);
	});

	it("gate ON but session has entries: forkEmptySession() rejects with a clear error", async () => {
		process.env[ENV_VAR] = "1";
		const { runtime } = await createRuntimeForTest(() => {});

		runtime.session.sessionManager.appendMessage(userMsg("hello"));
		expect(runtime.session.getUserMessagesForForking().length).toBeGreaterThan(0);

		await expect(runtime.forkEmptySession()).rejects.toThrow(/Invalid entry ID for forking/);
	});
});
