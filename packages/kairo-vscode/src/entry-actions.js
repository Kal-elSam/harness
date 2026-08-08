"use strict";

const STATUS_RANK = Object.freeze({
  conflict: 0,
  error: 1,
  fail: 1,
  failed: 1,
  warning: 2,
  drift: 3,
  missing: 4,
  action: 5,
  note: 6,
  info: 7,
  unknown: 8
});

function action(id, label, command, kind = "run") {
  return { id, label, command, kind };
}

/**
 * Contextual buttons for an Entries row.
 * Commands open a terminal; never silent writes.
 */
function actionsForEntry(entry) {
  if (!entry || typeof entry !== "object") return [];
  const status = typeof entry.status === "string" ? entry.status : "unknown";
  const title = typeof entry.title === "string" ? entry.title : "";
  const detail = typeof entry.detail === "string" ? entry.detail : "";
  const actions = [];

  if (status === "conflict" || /sdd-core:skills/i.test(title)) {
    actions.push(
      action(
        "configure-sdd",
        "Fix SDD skills",
        "kairo components configure sdd-core --dry-run",
        "configure"
      ),
      action("doctor", "Doctor", "kairo doctor", "run")
    );
  } else if (status === "drift" || (/Repair|\bsync\b/i.test(title) && status === "action")) {
    actions.push(
      action("repair", "Repair", "kairo sync", "run"),
      action("doctor", "Doctor", "kairo doctor", "run")
    );
  } else if (/graphify/i.test(title) || /graphify update/i.test(detail)) {
    actions.push(
      action("update-graph", "Update graph", "graphify update .", "configure"),
      action("doctor", "Doctor", "kairo doctor", "run")
    );
  } else if (status === "note") {
    actions.push(
      action("guide-optional", "Why optional?", null, "guide"),
      action("doctor", "Doctor", "kairo doctor", "run")
    );
  } else if (status === "warning" || status === "missing" || status === "error") {
    actions.push(action("doctor", "Doctor", "kairo doctor", "run"));
  } else if (status === "action") {
    actions.push(
      action("repair", "Repair", "kairo sync", "run"),
      action("doctor", "Doctor", "kairo doctor", "run")
    );
  } else {
    actions.push(action("doctor", "Doctor", "kairo doctor", "run"));
  }

  actions.push(action("refresh", "Refresh", null, "refresh"));
  return actions;
}

function enrichEntry(entry) {
  return {
    ...entry,
    actions: actionsForEntry(entry)
  };
}

function sortEntries(entries) {
  return [...(entries ?? [])].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? STATUS_RANK.unknown;
    const rb = STATUS_RANK[b.status] ?? STATUS_RANK.unknown;
    if (ra !== rb) return ra - rb;
    return String(a.title ?? "").localeCompare(String(b.title ?? ""));
  });
}

module.exports = { actionsForEntry, enrichEntry, sortEntries, STATUS_RANK };
