/**
 * Kairo fork regression tests for the empty-session persistence gate
 * (KAIRO_PI_EMPTY_SESSIONS=1).
 *
 * These tests import SessionManager from the BUILT BUNDLE
 * (dist/bundle/index.js), not from src or dist/core, because that bundle is
 * what the published pi bin actually executes at runtime. Upstream's own
 * dist/core/session-manager.js is not reachable from the CLI; only the
 * bundled copy under dist/bundle/chunks is.
 *
 * The bundle is loaded via a computed dynamic import (not a static relative
 * ".js" import specifier) so it goes through the same module resolution the
 * built CLI uses, without tripping this repo's check:ts-imports rule, which
 * forbids relative ".js" import specifiers in source .ts files.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ENV_VAR = "KAIRO_PI_EMPTY_SESSIONS";

const bundleUrl = new URL("../../dist/bundle/index.js", import.meta.url).href;
const { SessionManager } = (await import(bundleUrl)) as typeof import("../../src/core/session-manager.ts");

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

/** Count how many "session" header lines a JSONL session file contains. */
function headerCount(sessionFile: string): number {
	const lines = readFileSync(sessionFile, "utf8").trim().split("\n").filter(Boolean);
	return lines.filter((line) => JSON.parse(line).type === "session").length;
}

describe("Kairo empty-session persistence (dist/bundle)", () => {
	const cleanups: Array<() => void> = [];
	const prevEnv = process.env[ENV_VAR];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
		if (prevEnv === undefined) {
			delete process.env[ENV_VAR];
		} else {
			process.env[ENV_VAR] = prevEnv;
		}
	});

	function makeTempDir(prefix: string): string {
		const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
		return dir;
	}

	describe("gate ON (KAIRO_PI_EMPTY_SESSIONS=1)", () => {
		it("persists a brand-new session immediately, before any assistant message", () => {
			process.env[ENV_VAR] = "1";
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessionFile = manager.getSessionFile();

			expect(sessionFile).toBeTruthy();
			expect(existsSync(sessionFile!)).toBe(true);
			expect(headerCount(sessionFile!)).toBe(1);
		});

		it("lists the empty session under SessionManager.list() (/resume)", async () => {
			process.env[ENV_VAR] = "1";
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessions = await SessionManager.list(cwd, sessionDir);

			expect(sessions.map((s) => s.id)).toContain(manager.getSessionId());
		});

		it("reopens the empty session (/resume selecting it)", () => {
			process.env[ENV_VAR] = "1";
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessionFile = manager.getSessionFile()!;

			const reopened = SessionManager.open(sessionFile, sessionDir);

			expect(reopened.getSessionId()).toBe(manager.getSessionId());
			expect(reopened.getEntries()).toEqual([]);
			expect(reopened.getHeader()?.id).toBe(manager.getSessionId());
		});

		it("appends after the eager write without duplicating the header or throwing EEXIST", () => {
			process.env[ENV_VAR] = "1";
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessionFile = manager.getSessionFile()!;

			expect(() => manager.appendMessage(userMsg("hello"))).not.toThrow();
			expect(headerCount(sessionFile)).toBe(1);

			expect(() => manager.appendMessage(assistantMsg("hi there"))).not.toThrow();
			expect(headerCount(sessionFile)).toBe(1);
		});

		it("createBranchedSession writes eagerly and sets parentSession, even without an assistant reply", () => {
			process.env[ENV_VAR] = "1";
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const originalFile = manager.getSessionFile()!;
			const userEntryId = manager.appendMessage(userMsg("first"));

			const forkedFile = manager.createBranchedSession(userEntryId);

			expect(forkedFile).toBeTruthy();
			expect(forkedFile).not.toBe(originalFile);
			expect(existsSync(forkedFile!)).toBe(true);
			expect(headerCount(forkedFile!)).toBe(1);

			const header = JSON.parse(readFileSync(forkedFile!, "utf8").split("\n")[0]);
			expect(header.type).toBe("session");
			expect(header.parentSession).toBe(originalFile);

			expect(() => manager.appendMessage(assistantMsg("reply on branch"))).not.toThrow();
			expect(headerCount(forkedFile!)).toBe(1);
		});
	});

	describe("gate OFF (default, KAIRO_PI_EMPTY_SESSIONS unset)", () => {
		it("does not persist a brand-new session until the first assistant message (upstream behavior)", () => {
			delete process.env[ENV_VAR];
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessionFile = manager.getSessionFile()!;
			expect(existsSync(sessionFile)).toBe(false);

			manager.appendMessage(userMsg("hello"));
			expect(existsSync(sessionFile)).toBe(false);

			manager.appendMessage(assistantMsg("hi there"));
			expect(existsSync(sessionFile)).toBe(true);
			expect(headerCount(sessionFile)).toBe(1);
		});

		it("does not list the still-empty session under SessionManager.list()", async () => {
			delete process.env[ENV_VAR];
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			const sessions = await SessionManager.list(cwd, sessionDir);

			expect(sessions.map((s) => s.id)).not.toContain(manager.getSessionId());
		});

		it("createBranchedSession still defers the write when there is no assistant reply yet", () => {
			delete process.env[ENV_VAR];
			const cwd = makeTempDir("kairo-cwd");
			const sessionDir = makeTempDir("kairo-sessions");

			const manager = SessionManager.create(cwd, sessionDir);
			manager.appendMessage(userMsg("first"));
			const secondUserEntryId = manager.appendMessage(userMsg("second, still no assistant reply"));

			const forkedFile = manager.createBranchedSession(secondUserEntryId);

			expect(forkedFile).toBeTruthy();
			expect(existsSync(forkedFile!)).toBe(false);
		});
	});
});
