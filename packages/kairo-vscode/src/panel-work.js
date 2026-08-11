"use strict";

/** Honest work viewport from kairo.next/v1 — never invents Goal/Now/Next. */
const NEXT_SCHEMA = "kairo.next/v1";

function emptyWork({
  integrationState = "missing",
  showRepair = false,
  emptyReason = "no_snapshot",
  detail = null
} = {}) {
  return {
    present: false, schema: null, goal: null, progress: [], now: null, blockers: [],
    next: null, team: null, conversationId: null, updatedAt: null,
    integrationState, showRepair: showRepair === true, emptyReason, detail
  };
}

function teamFromNext(team) {
  const members = (Array.isArray(team?.members) ? team.members : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const title = typeof row.title === "string" ? row.title : null;
      const workId = typeof row.workId === "string" ? row.workId : null;
      if (!title && !workId) return null;
      return {
        ...(workId ? { workId } : {}),
        ...(title ? { title } : {}),
        ...(row.role ? { role: row.role } : {}),
        ...(row.state ? { state: row.state } : {})
      };
    })
    .filter(Boolean);
  return members.length ? { members } : null;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function buildWorkViewport(nextReport) {
  if (!nextReport || nextReport.error || (nextReport.ok === false && !nextReport.schema)) {
    return emptyWork({
      integrationState: "missing",
      showRepair: false,
      emptyReason: "next_unavailable",
      detail: typeof nextReport?.error === "string"
        ? nextReport.error
        : "kairo next --json unavailable"
    });
  }

  if (nextReport.schema !== NEXT_SCHEMA) {
    return emptyWork({
      integrationState: "missing",
      showRepair: false,
      emptyReason: "next_unavailable",
      detail: "Unexpected next contract"
    });
  }

  const integration = nextReport.integration ?? {};
  const state = typeof integration.state === "string" ? integration.state : "missing";
  const showRepair = state === "broken" && integration.showRepair === true;
  const goal = typeof nextReport.goal === "string" && nextReport.goal.trim() ? nextReport.goal : null;
  const now = typeof nextReport.now === "string" && nextReport.now.trim() ? nextReport.now : null;
  const next = typeof nextReport.next === "string" && nextReport.next.trim() ? nextReport.next : null;
  if (!goal && !now && !next) {
    return emptyWork({
      integrationState: state,
      showRepair,
      emptyReason: "no_snapshot",
      detail: typeof integration.detail === "string" ? integration.detail : null
    });
  }

  return {
    present: true,
    schema: NEXT_SCHEMA,
    goal,
    progress: stringList(nextReport.progress),
    now,
    blockers: stringList(nextReport.blockers),
    next,
    team: teamFromNext(nextReport.team),
    conversationId: typeof nextReport.conversationId === "string" ? nextReport.conversationId : null,
    updatedAt: typeof nextReport.updatedAt === "string" ? nextReport.updatedAt : null,
    integrationState: state,
    showRepair,
    emptyReason: null,
    detail: typeof integration.detail === "string" ? integration.detail : null
  };
}

module.exports = { NEXT_SCHEMA, buildWorkViewport, emptyWork };
