import { LAYOUT_MODES } from "./layout.js";

/** Disk free% tone — never invents a percent. */
export function diskFreeTone(freePercent) {
  if (typeof freePercent !== "number" || !Number.isFinite(freePercent)) return null;
  if (freePercent < 10) return "critical";
  if (freePercent < 20) return "warning";
  return "healthy";
}

function formatBytesShort(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) return `${Math.round(gib * 10) / 10}G`;
  const mib = bytes / (1024 ** 2);
  return `${Math.round(mib)}M`;
}

function pctLabel(value, suffix = "% free") {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value}${suffix}`;
}

/**
 * Display-only System resource lines for Cockpit companion overlay.
 * Never invents metrics; never includes paths, args, or control affordances.
 */
export function formatSystemResourcesLines(resources, layoutMode = LAYOUT_MODES.COMPACT) {
  if (resources == null || typeof resources !== "object") {
    return ["System · unavailable"];
  }
  const state = typeof resources.state === "string" && resources.state.length > 0
    ? resources.state
    : "error";
  if (state !== "available" && state !== "partial") {
    return [`System · ${state}`];
  }

  const ram = pctLabel(resources.memory?.freePercent);
  const swapUsed = formatBytesShort(resources.swap?.usedBytes);
  const diskPct = resources.disk?.freePercent;
  const disk = pctLabel(diskPct);
  const tone = diskFreeTone(diskPct);

  const bits = ["System"];
  bits.push(ram ? `RAM ${ram}` : "RAM n/a");
  bits.push(swapUsed ? `Swap ${swapUsed} used` : "Swap n/a");
  bits.push(disk ? `Disk ${disk}` : "Disk n/a");
  if (tone && tone !== "healthy") bits.push(tone);

  const lines = [bits.join(" · ")];
  if (layoutMode === LAYOUT_MODES.MINIMAL) return lines;

  const ramFree = resources.memory?.freePercent;
  const memoryPressure = typeof ramFree === "number" && Number.isFinite(ramFree) && ramFree < 15;
  if (memoryPressure) {
    lines.push("  · Memory pressure · swap elevated relevance");
  } else {
    lines.push("  · Swap informational");
  }

  const proc = resources.processes && typeof resources.processes === "object"
    ? resources.processes
    : null;
  if (proc) {
    const total = Number.isInteger(proc.totalCount) ? proc.totalCount : null;
    const zombies = Number.isInteger(proc.zombieCount) ? proc.zombieCount : null;
    if (total != null && zombies != null) {
      lines.push(`  · Processes ${total} · zombies ${zombies}`);
    }
  }

  if (layoutMode !== LAYOUT_MODES.WIDE) return lines;

  const tracked = Array.isArray(proc?.tracked) ? proc.tracked : [];
  for (const entry of tracked.slice(0, 4)) {
    if (entry == null || typeof entry !== "object") continue;
    if (typeof entry.name !== "string" || !Number.isInteger(entry.count)) continue;
    lines.push(`  · ${entry.name} ×${entry.count}`);
  }
  const thermal = resources.thermal?.state ?? "unavailable";
  const ssd = resources.ssdWear?.state ?? "unavailable";
  lines.push(`  · Thermal · ${thermal}`);
  lines.push(`  · SSD wear · ${ssd}`);
  return lines;
}

/** Display-only advisor lines from deterministic recommendations. */
export function formatResourceAdviceLines(advice, layoutMode = LAYOUT_MODES.COMPACT) {
  const list = Array.isArray(advice?.recommendations) ? advice.recommendations : [];
  if (list.length === 0) return ["Advisor · quiet"];
  const top = list[0];
  const severity = typeof top.severity === "string" ? top.severity : "info";
  const title = typeof top.title === "string" ? top.title : "recommendation";
  const lines = [`Advisor · ${severity} · ${title}`];
  if (layoutMode === LAYOUT_MODES.MINIMAL) return lines;
  if (typeof top.detail === "string" && top.detail.length > 0) {
    lines.push(`  · ${top.detail.slice(0, 96)}`);
  }
  if (layoutMode === LAYOUT_MODES.WIDE) {
    for (const item of list.slice(1, 3)) {
      if (item == null || typeof item !== "object") continue;
      const sev = typeof item.severity === "string" ? item.severity : "info";
      const t = typeof item.title === "string" ? item.title : "recommendation";
      lines.push(`  · ${sev} · ${t}`);
    }
  }
  return lines;
}
