import { probeCommand as defaultProbeCommand } from "../cli-probe.js";

export const SYSTEM_RESOURCES_TIMEOUT_MS = 2000;
export const PROCESS_ALLOWLIST = Object.freeze([
  "cursor", "codex", "chatgpt", "brave", "teams", "obsidian", "ollama"
]);

const BIN = Object.freeze({
  sysctl: "/usr/sbin/sysctl", vmStat: "/usr/bin/vm_stat", pagesize: "/usr/bin/pagesize",
  df: "/bin/df", ps: "/bin/ps"
});

const emptyProcesses = () => ({ totalCount: 0, zombieCount: 0, tracked: [] });

function envelope(state, nowMs, diagnostics = [], partial = {}) {
  return {
    state, sampledAt: new Date(nowMs).toISOString(), diagnostics: diagnostics.map(String),
    memory: null, swap: null, disk: null, processes: emptyProcesses(),
    thermal: { state: "unavailable" }, ssdWear: { state: "unavailable" }, ...partial
  };
}

function invoke(probeCommand, cmd, args, timeoutMs) {
  try { return { ok: true, value: probeCommand(cmd, args, { timeoutMs }) }; }
  catch { return { ok: false }; }
}

function classify(inv) {
  if (!inv.ok) return { kind: "spawn_error" };
  const r = inv.value;
  if (r?.timedOut) return { kind: "timeout" };
  if (r?.error) {
    return /EACCES|EPERM|permission/i.test(String(r.error))
      ? { kind: "permission_denied" } : { kind: "spawn_error" };
  }
  if (!r?.ok) {
    return /permission|denied|Operation not permitted/i.test(String(r.stderr ?? ""))
      ? { kind: "permission_denied" } : { kind: "exit" };
  }
  return { kind: "ok", stdout: String(r.stdout ?? "") };
}

function parseBytesUnit(raw) {
  const m = String(raw).trim().match(/^([\d.]+)\s*([KMGTP]?)/i);
  if (!m || !Number.isFinite(Number(m[1]))) return null;
  const mul = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };
  return Math.round(Number(m[1]) * (mul[(m[2] || "B").toUpperCase()] ?? 1));
}

function parseSwap(stdout) {
  const grab = (label) => {
    const m = stdout.match(new RegExp(`${label}\\s*=\\s*([\\d.]+\\s*[KMGTP]?)`, "i"));
    return m ? parseBytesUnit(m[1]) : null;
  };
  const totalBytes = grab("total"), usedBytes = grab("used"), freeBytes = grab("free");
  return totalBytes == null || usedBytes == null || freeBytes == null
    ? null : { totalBytes, usedBytes, freeBytes };
}

function parseDf(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines.at(-1).trim().split(/\s+/);
  const totalKb = Number(cols[1]), availKb = Number(cols[3]);
  if (!Number.isFinite(totalKb) || !Number.isFinite(availKb) || totalKb <= 0) return null;
  const totalBytes = totalKb * 1024, freeBytes = availKb * 1024;
  return { totalBytes, freeBytes, freePercent: Math.round((freeBytes / totalBytes) * 1000) / 10 };
}

function matchAllowlist(comm) {
  const name = String(comm ?? "").toLowerCase();
  return PROCESS_ALLOWLIST.find((key) => name.includes(key)) ?? null;
}

export function parseProcessTable(stdout) {
  let totalCount = 0, zombieCount = 0;
  const counts = Object.fromEntries(PROCESS_ALLOWLIST.map((k) => [k, 0]));
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    totalCount += 1;
    if (/^Z/i.test(m[2])) zombieCount += 1;
    const key = matchAllowlist(m[3]);
    if (key) counts[key] += 1;
  }
  return {
    totalCount, zombieCount,
    tracked: PROCESS_ALLOWLIST.filter((k) => counts[k] > 0).map((k) => ({ name: k, count: counts[k] }))
  };
}

function probeMemory(probeCommand, timeoutMs) {
  const mem = classify(invoke(probeCommand, BIN.sysctl, ["-n", "hw.memsize"], timeoutMs));
  if (mem.kind !== "ok") return { ok: false, kind: mem.kind };
  const totalBytes = Number(String(mem.stdout).trim());
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return { ok: false, kind: "parse" };
  const page = classify(invoke(probeCommand, BIN.pagesize, [], timeoutMs));
  if (page.kind !== "ok") return { ok: false, kind: page.kind };
  const pageSize = Number(String(page.stdout).trim());
  if (!Number.isFinite(pageSize) || pageSize <= 0) return { ok: false, kind: "parse" };
  const vm = classify(invoke(probeCommand, BIN.vmStat, [], timeoutMs));
  if (vm.kind !== "ok") return { ok: false, kind: vm.kind };
  const free = vm.stdout.match(/Pages free:\s+(\d+)/i);
  const spec = vm.stdout.match(/Pages speculative:\s+(\d+)/i);
  if (!free) return { ok: false, kind: "parse" };
  const freeBytes = (Number(free[1]) + (spec ? Number(spec[1]) : 0)) * pageSize;
  return { ok: true, value: { totalBytes, freePercent: Math.round((freeBytes / totalBytes) * 1000) / 10 } };
}

function runProbe(fn, probeCommand, deadlineMs) {
  const left = Math.max(0, deadlineMs - Date.now());
  if (left <= 0) return { ok: false, kind: "timeout" };
  return fn(probeCommand, left);
}

function probeSwap(probeCommand, timeoutMs) {
  const cls = classify(invoke(probeCommand, BIN.sysctl, ["-n", "vm.swapusage"], timeoutMs));
  if (cls.kind !== "ok") return { ok: false, kind: cls.kind };
  const value = parseSwap(cls.stdout);
  return value ? { ok: true, value } : { ok: false, kind: "parse" };
}

function probeDisk(probeCommand, timeoutMs) {
  let cls = classify(invoke(probeCommand, BIN.df, ["-k", "/System/Volumes/Data"], timeoutMs));
  if (cls.kind !== "ok") cls = classify(invoke(probeCommand, BIN.df, ["-k", "/"], timeoutMs));
  if (cls.kind !== "ok") return { ok: false, kind: cls.kind };
  const value = parseDf(cls.stdout);
  return value ? { ok: true, value } : { ok: false, kind: "parse" };
}

function probeProcesses(probeCommand, timeoutMs) {
  const cls = classify(invoke(probeCommand, BIN.ps, ["-axc", "-o", "pid=,stat=,comm="], timeoutMs));
  if (cls.kind !== "ok") return { ok: false, kind: cls.kind };
  return { ok: true, value: parseProcessTable(cls.stdout) };
}

/** Read-only local system resources (macOS first). Absolute bins only; never throws. */
export async function loadSystemResources({
  platform = process.platform, nowMs = Date.now(),
  timeoutMs = SYSTEM_RESOURCES_TIMEOUT_MS, probeCommand = defaultProbeCommand
} = {}) {
  try {
    if (platform !== "darwin") {
      return envelope("unavailable", nowMs, ["system resources unsupported on this platform"]);
    }
    const diagnostics = [];
    const deadlineMs = Date.now() + timeoutMs;
    const memory = runProbe(probeMemory, probeCommand, deadlineMs);
    const swap = runProbe(probeSwap, probeCommand, deadlineMs);
    const disk = runProbe(probeDisk, probeCommand, deadlineMs);
    const processes = runProbe(probeProcesses, probeCommand, deadlineMs);
    for (const [label, result] of [["memory", memory], ["swap", swap], ["disk", disk], ["processes", processes]]) {
      if (!result.ok) diagnostics.push(`system ${label} ${result.kind}`);
    }
    const anyOk = memory.ok || swap.ok || disk.ok || processes.ok;
    if (!anyOk) {
      return envelope("error", nowMs, diagnostics.length ? diagnostics : ["system resources probe failed"]);
    }
    const available = memory.ok && swap.ok && disk.ok && processes.ok;
    return envelope(available ? "available" : "partial", nowMs, diagnostics, {
      memory: memory.ok ? memory.value : null,
      swap: swap.ok ? swap.value : null,
      disk: disk.ok ? disk.value : null,
      processes: processes.ok ? processes.value : emptyProcesses()
    });
  } catch {
    return envelope("error", nowMs, ["system resources error"]);
  }
}
