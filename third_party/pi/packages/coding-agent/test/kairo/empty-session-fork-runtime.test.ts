/**
 * Kairo fork regression tests: forking an in-progress (no assistant reply
 * yet) session through AgentSessionRuntime.fork(), end to end, with the
 * empty-session persistence gate (KAIRO_PI_EMPTY_SESSIONS=1).
 *
 * Everything under test (SessionManager, AgentSessionRuntime,
 * createAgentSessionServices, createAgentSessionFromServices) is imported
 * from the BUILT BUNDLE (dist/bundle/index.js), not src and not dist/core.
 * The faux model provider from @earendil-works/pi-ai/compat is test
 * scaffolding only, required to construct a runtime; no prompt/completion is
 * ever issued, so no model call happens and no assistant message is faked
 * into the session under test.
 *
 * The bundle is loaded via a computed dynamic import (not a static relative
 * ".js" import specifier) so it goes through the same module resolution the
 * built CLI uses, without tripping this repo's check:ts-imports rule, which
 * forbids relative ".js" import specifiers in source .ts files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type {
	CreateAgentSessionRuntimeFactory,
	ExtensionAPI,
	ExtensionFactory,
	SessionStartEvent,
} from "../../src/index.ts";

const ENV_VAR = "KAIRO_PI_EMPTY_SESSIONS";

const bundleUrl = new URL("../../dist/bundle/index.js", import.meta.url).href;
const { SessionManager, createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices } =
	(await import(bundleUrl)) as typeof import("../../src/index.ts");

function userMsg(text: string) {
	return { role: "user" as const, content: text, timestamp: Date.now() };
}

function assistantMsg(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "anthropic-messages" as const,
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function headerCount(sessionFile: string): number {
	const lines = readFileSync(sessionFile, "utf8").trim().split("\n").filter(Boolean);
	return lines.filter((line) => JSON.parse(line).type === "session").length;
}

describe("Kairo empty-session fork via AgentSessionRuntime (dist/bundle)", () => {
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
		options?: {
			buildInitialSessionManager?: (cwd: string, sessionDir: string) => ReturnType<typeof SessionManager.create>;
		},
	) {
		const tempDir = join(tmpdir(), `kairo-fork-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
			sessionManager: options?.buildInitialSessionManager
				? options.buildInitialSessionManager(tempDir, sessionDir)
				: SessionManager.create(tempDir, sessionDir),
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

	it("gate ON: forks an assistant-less session without the 'has not been saved yet' guard, persists eagerly, and emits session_start:fork", async () => {
		process.env[ENV_VAR] = "1";
		const events: SessionStartEvent[] = [];
		const { runtime } = await createRuntimeForTest((event) => events.push(event));

		// No prompt() is called: append a real user message directly, with no
		// assistant reply, so the session is exactly in the "not saved yet"
		// state the upstream guard used to reject.
		const userEntryId = runtime.session.sessionManager.appendMessage(userMsg("hello"));
		const previousSessionFile = runtime.session.sessionFile;
		expect(existsSync(previousSessionFile!)).toBe(true); // eager write from newSession()

		events.length = 0;
		const forkResult = await runtime.fork(userEntryId, { position: "at" });
		expect(forkResult.cancelled).toBe(false);
		await runtime.session.bindExtensions({});

		const forkedSessionFile = runtime.session.sessionFile!;
		expect(forkedSessionFile).not.toBe(previousSessionFile);
		expect(existsSync(forkedSessionFile)).toBe(true);
		expect(headerCount(forkedSessionFile)).toBe(1);

		const header = JSON.parse(readFileSync(forkedSessionFile, "utf8").split("\n")[0]);
		expect(header.parentSession).toBe(previousSessionFile);

		expect(events).toEqual([{ type: "session_start", reason: "fork", previousSessionFile }]);

		// First append on the forked (still assistant-less) session: no
		// duplicate header, no EEXIST.
		expect(() => runtime.session.sessionManager.appendMessage(assistantMsg("reply"))).not.toThrow();
		expect(headerCount(forkedSessionFile)).toBe(1);
	});

	it("gate OFF: the same fork still throws the upstream 'has not been saved yet' guard", async () => {
		delete process.env[ENV_VAR];
		const { runtime } = await createRuntimeForTest(() => {});

		const userEntryId = runtime.session.sessionManager.appendMessage(userMsg("hello"));
		const previousSessionFile = runtime.session.sessionFile;
		expect(existsSync(previousSessionFile!)).toBe(false); // upstream: not persisted yet

		await expect(runtime.fork(userEntryId, { position: "at" })).rejects.toThrow(/has not been saved yet/);
	});

	it("gate ON: forking at the very first user message (position 'before', no target leaf) leaves no orphan session file", async () => {
		process.env[ENV_VAR] = "1";

		// Append the user message as the very first entry (parentId: null)
		// BEFORE the runtime/session is created around this SessionManager.
		// Going through the normal runtime startup first would seed a
		// model_change/thinking_level_change entry ahead of any user
		// message, which is never the case for imported/legacy sessions or a
		// session driven directly through this lower-level API without that
		// startup sequence: the entry-append order here, not a
		// createRuntimeForTest quirk, is what makes the very first user
		// message have a null parentId, which is the "no target leaf" case
		// fork() hits when the user forks "before" it.
		let userEntryId = "";
		const { runtime, sessionDir } = await createRuntimeForTest(() => {}, {
			buildInitialSessionManager: (cwd, sessionDirForManager) => {
				const manager = SessionManager.create(cwd, sessionDirForManager);
				userEntryId = manager.appendMessage(userMsg("hello"));
				return manager;
			},
		});

		expect(runtime.session.sessionManager.getEntry(userEntryId)?.parentId).toBeNull();
		const previousSessionFile = runtime.session.sessionFile!;
		expect(existsSync(previousSessionFile)).toBe(true); // eager write from newSession()

		const forkResult = await runtime.fork(userEntryId, { position: "before" });
		expect(forkResult.cancelled).toBe(false);
		await runtime.session.bindExtensions({});

		const forkedSessionFile = runtime.session.sessionFile!;
		expect(forkedSessionFile).not.toBe(previousSessionFile);
		expect(existsSync(forkedSessionFile)).toBe(true);

		const sessionFiles = readdirSync(sessionDir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => join(sessionDir, name));

		// Exactly two files: the original session and the forked child. No
		// orphan (parent-less, unreferenced) session file left behind from an
		// intermediate SessionManager that was persisted before being
		// discarded.
		expect(sessionFiles.sort()).toEqual([previousSessionFile, forkedSessionFile].sort());

		const header = JSON.parse(readFileSync(forkedSessionFile, "utf8").split("\n")[0]);
		expect(header.parentSession).toBe(previousSessionFile);
	});

	it("gate ON: plain /new still creates exactly one new session file (no parentSession option)", async () => {
		process.env[ENV_VAR] = "1";
		const { runtime, sessionDir } = await createRuntimeForTest(() => {});

		const previousSessionFile = runtime.session.sessionFile!;
		expect(existsSync(previousSessionFile)).toBe(true); // eager write from newSession()

		const newResult = await runtime.newSession();
		expect(newResult.cancelled).toBe(false);
		await runtime.session.bindExtensions({});

		const newSessionFile = runtime.session.sessionFile!;
		expect(newSessionFile).not.toBe(previousSessionFile);
		expect(existsSync(newSessionFile)).toBe(true);

		const sessionFiles = readdirSync(sessionDir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => join(sessionDir, name));

		expect(sessionFiles.sort()).toEqual([previousSessionFile, newSessionFile].sort());
	});

	it("gate ON: /new with an explicit parentSession leaves no orphan session file", async () => {
		process.env[ENV_VAR] = "1";
		const { runtime, sessionDir } = await createRuntimeForTest(() => {});

		const previousSessionFile = runtime.session.sessionFile!;
		expect(existsSync(previousSessionFile)).toBe(true); // eager write from newSession()

		const newResult = await runtime.newSession({ parentSession: previousSessionFile });
		expect(newResult.cancelled).toBe(false);
		await runtime.session.bindExtensions({});

		const newSessionFile = runtime.session.sessionFile!;
		expect(newSessionFile).not.toBe(previousSessionFile);
		expect(existsSync(newSessionFile)).toBe(true);

		const sessionFiles = readdirSync(sessionDir)
			.filter((name) => name.endsWith(".jsonl"))
			.map((name) => join(sessionDir, name));

		expect(sessionFiles.sort()).toEqual([previousSessionFile, newSessionFile].sort());

		const header = JSON.parse(readFileSync(newSessionFile, "utf8").split("\n")[0]);
		expect(header.parentSession).toBe(previousSessionFile);
	});
});
