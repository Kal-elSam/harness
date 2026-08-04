import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  assertGraphInsideWorkspace, inspectGraphArtifact, probeGraphify
} from "../src/global/observability/graphify-probe.js";
import { runGraphifyOp } from "../src/global/observability/graphify-ops.js";

const okJson = () => JSON.stringify({ nodes: [{ id: "a" }], links: [] });

test("graphify probe fail-soft: which throw and graph IO error", async () => {
  const threw = await probeGraphify({ whichCommand: () => { throw new Error("which boom"); } });
  assert.equal(threw.state, "error");
  assert.match(String(threw.error), /which boom/);
  const io = await probeGraphify({
    whichCommand: () => "/usr/bin/graphify",
    inspectGraph: () => ({ status: "error", path: "/ws/g.json", error: "EACCES", diagnostics: ["read_error"] })
  });
  assert.equal(io.state === "error" && io.error === "EACCES", true);
  assert.equal(io.evidence.find((e) => e.kind === "graph")?.status, "error");
  assert.equal(io.evidence.find((e) => e.kind === "binary")?.path, "/usr/bin/graphify");
});

test("graphify inspect, containment, stale ops, opaque stdout", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-g4-"));
  const dir = join(root, "graphify-out");
  await mkdir(dir, { recursive: true });
  const graphPath = join(dir, "graph.json");
  await writeFile(graphPath, okJson());
  await writeFile(join(dir, "GRAPH_REPORT.md"), "Built from commit: `4fba5fe`\n");
  const rp = (p) => p;
  const rf = (p) => String(p).endsWith("GRAPH_REPORT.md") ? "Built from commit: `4fba5fe`\n" : okJson();
  const head = "01099efaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(inspectGraphArtifact("/x", {
    readFile: () => { const e = new Error("n"); e.code = "ENOENT"; throw e; },
    realpath: () => { const e = new Error("n"); e.code = "ENOENT"; throw e; }
  }).status, "missing");
  assert.equal(inspectGraphArtifact(graphPath, { readFile: () => "{", realpath: rp }).status, "malformed");
  assert.equal(inspectGraphArtifact(graphPath, {
    readFile: () => JSON.stringify({ nodes: 1 }), realpath: rp
  }).status, "malformed");
  assert.equal(inspectGraphArtifact(graphPath, { cwd: root, headSha: head, realpath: rp, readFile: rf }).status, "stale");
  assert.equal(assertGraphInsideWorkspace(root, "/tmp/x.json", { cwd: root, realpath: rp }).code,
    "graph_path_outside_workspace");
  assert.throws(() => parseArgs(["graphify", "query", "x"]), /Missing --graph/);
  assert.equal(parseArgs(["graphify", "query", "how?", "--graph", graphPath, "--budget", "100"]).options.graphifyAction, "query");

  const inspected = [];
  let seen;
  const ok = await runGraphifyOp({
    op: "query", args: ["how?"], graphPath, cwd: root, workspaceRoot: root, budget: 100, headSha: head,
    whichCommand: () => "/usr/bin/graphify",
    containPath: (ws, gp, o) => assertGraphInsideWorkspace(ws, gp, { ...o, realpath: rp }),
    inspectGraph: (p, o) => { inspected.push(p); return inspectGraphArtifact(p, { ...o, realpath: rp, readFile: rf }); },
    probeCommand: (_c, args) => {
      seen = [...args];
      return { ok: true, status: 0, stdout: "opaque", stderr: "token=SECRET", timedOut: false };
    }
  });
  assert.equal(ok.ok && ok.graphStatus === "stale" && ok.text === "opaque", true);
  assert.deepEqual(inspected, [graphPath]);
  assert.deepEqual(seen, ["query", "how?", "--budget", "100", "--graph", graphPath]);
  assert.equal(JSON.stringify(ok).includes("SECRET"), false);

  let spawned = false;
  assert.equal((await runGraphifyOp({
    op: "explain", args: ["X"], graphPath: "/etc/passwd", cwd: root, workspaceRoot: root,
    whichCommand: () => "/usr/bin/graphify",
    containPath: () => ({ ok: false, code: "graph_path_outside_workspace", path: "/etc/passwd" }),
    inspectGraph: () => { throw new Error("no"); },
    probeCommand: () => { spawned = true; return { ok: true, status: 0 }; }
  })).code, "graph_path_outside_workspace");
  assert.equal(spawned, false);

  const other = join(dir, "other.json");
  await writeFile(other, okJson());
  const bound = [];
  await runGraphifyOp({
    op: "path", args: ["A", "B"], graphPath: other, cwd: root, workspaceRoot: root,
    whichCommand: () => "/usr/bin/graphify",
    containPath: (ws, gp, o) => assertGraphInsideWorkspace(ws, gp, { ...o, realpath: rp }),
    inspectGraph: (p) => { bound.push(p); return { status: "ok", path: p, diagnostics: [], error: null }; },
    probeCommand: (_c, args) => {
      assert.equal(args.at(-1), other);
      return { ok: true, status: 0, stdout: "a->b", stderr: "", timedOut: false };
    }
  });
  assert.deepEqual(bound, [other]);

  // Productive consumers resolve HEAD when headSha is omitted.
  const auto = await runGraphifyOp({
    op: "query", args: ["q"], graphPath, cwd: root, workspaceRoot: root, budget: 50,
    whichCommand: () => "/usr/bin/graphify",
    resolveHead: () => head,
    containPath: (ws, gp, o) => assertGraphInsideWorkspace(ws, gp, { ...o, realpath: rp }),
    inspectGraph: (p, o) => inspectGraphArtifact(p, { ...o, realpath: rp, readFile: rf }),
    probeCommand: () => ({ ok: true, status: 0, stdout: "x", stderr: "", timedOut: false })
  });
  assert.equal(auto.graphStatus, "stale");
  assert.equal((await probeGraphify({
    cwd: root, whichCommand: () => "/usr/bin/graphify", resolveHead: () => head,
    inspectGraph: (p, o) => inspectGraphArtifact(p, { ...o, realpath: (x) => x, readFile: rf })
  })).evidence.find((e) => e.kind === "graph")?.status, "stale");
});
