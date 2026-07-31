/** Pure task-flow prototype: Home → Setup → Overview. Mock only — no writes. */

export const SCREENS = { HOME: "home", SETUP: "setup", OVERVIEW: "overview" };
export const FOCUS = { PRIMARY: "primary", LIST: "list", DETAILS: "details" };
export const SETUP_STEPS = [
  { id: "detect", label: "Detect agents" },
  { id: "select", label: "Select governance" },
  { id: "review", label: "Review changes" },
  { id: "confirm", label: "Confirm" },
  { id: "receipt", label: "Receipt" }
];

export function resolveLayout(c = 80, r = 24) {
  if (c >= 120 && r >= 40) return "wide";
  if (c < 80 || r < 24) return "minimal";
  return "compact";
}

export function createTaskFlowState(init = {}) {
  const columns = init.columns ?? 80;
  const rows = init.rows ?? 24;
  return {
    screen: init.screen ?? SCREENS.HOME,
    setupStep: init.setupStep ?? 0,
    listIndex: init.listIndex ?? 0,
    focus: init.focus ?? FOCUS.PRIMARY,
    detailsOpen: Boolean(init.detailsOpen),
    columns,
    rows,
    exited: Boolean(init.exited),
    layout: resolveLayout(columns, rows)
  };
}

export function buildHomeModel() {
  return {
    title: "Home",
    callout: { tone: "warn", title: "Needs attention", body: "2 open alerts · monitor idle · 1 active run" },
    primary: { id: "start-setup", label: "Start setup · Cursor drift", detail: "Opens guided setup. Stale hooks detected." },
    secondary: [
      { id: "overview", label: "Open overview" },
      { id: "details", label: "Show details", hint: "paths · ids" }
    ],
    details: ["project: agentic-harness", "path hidden until Details"]
  };
}

export function buildSetupModel(stepIndex = 0) {
  const step = SETUP_STEPS[stepIndex] ?? SETUP_STEPS[0];
  const isConfirm = step.id === "confirm";
  const isReceipt = step.id === "receipt";
  return {
    title: "Setup",
    steps: SETUP_STEPS,
    stepIndex,
    callout: {
      tone: "info",
      title: step.label,
      body: isReceipt ? "Prototype receipt — no files written." : "Enter advances · Esc leaves setup."
    },
    primary: { label: isReceipt ? "Open overview" : isConfirm ? "Confirm (no write)" : "Continue" },
    confirm: isConfirm ? { summary: "Apply governance preview to Cursor hooks.", primaryLabel: "Confirm (no write)" } : null,
    receipt: isReceipt ? { title: "Receipt", lines: ["status: simulated", "wrote: none", "planId: proto-1"] } : null,
    details: [`step: ${step.id}`, "write: disabled"]
  };
}

export function buildOverviewModel() {
  return {
    title: "Overview",
    callout: { tone: "warn", title: "Attention first", body: "2 items need a decision before secondary metrics." },
    primary: { label: "Back to home priority" },
    metrics: [
      { id: "agents", label: "Protected agents · Cursor · Codex · Pi" },
      { id: "monitor", label: "Monitor · Disabled" },
      { id: "runs", label: "Active runs · 1" },
      { id: "usage", label: "Usage · Pi evidence only" }
    ],
    details: ["alert: alt-1", "run: run-1"]
  };
}

export function modelForState(state) {
  if (state.screen === SCREENS.SETUP) return buildSetupModel(state.setupStep);
  if (state.screen === SCREENS.OVERVIEW) return buildOverviewModel();
  return buildHomeModel();
}

/** Focus mark only when PRIMARY — list/details own their own markers. */
export function focusMarkFor(state, unicode = true) {
  return state.focus === FOCUS.PRIMARY ? (unicode ? "›" : ">") : " ";
}

/** Exactly one primary surface; confirm steps own the action (no duplicate line). */
export function resolvePrimaryPresentation(model, state, unicode = true) {
  const mark = focusMarkFor(state, unicode);
  if (model.confirm) {
    return { mode: "confirm", summary: model.confirm.summary, label: model.confirm.primaryLabel, mark };
  }
  return { mode: "primary", label: model.primary.label, detail: model.primary.detail ?? null, mark };
}

export function keyHintsFor(state) {
  const hints = [
    { keys: "↑↓", label: "Move" },
    { keys: "Enter", label: "Primary" },
    { keys: "Space", label: "Details" },
    { keys: "/", label: "Home" },
    { keys: "Esc", label: state.screen === SCREENS.SETUP ? "Home" : "Exit" }
  ];
  return state.layout === "minimal" ? hints.slice(0, 3) : hints;
}

export function reduceTaskFlow(state, event) {
  switch (event.type) {
    case "resize": {
      const columns = event.columns ?? state.columns;
      const rows = event.rows ?? state.rows;
      return { ...state, columns, rows, layout: resolveLayout(columns, rows) };
    }
    case "up": return moveList(state, -1);
    case "down": return moveList(state, 1);
    case "space": return { ...state, detailsOpen: !state.detailsOpen, focus: FOCUS.DETAILS };
    case "slash":
      return { ...state, screen: SCREENS.HOME, focus: FOCUS.PRIMARY, listIndex: 0, detailsOpen: false };
    case "escape":
      if (state.detailsOpen) return { ...state, detailsOpen: false, focus: FOCUS.PRIMARY };
      if (state.screen === SCREENS.SETUP) {
        return { ...state, screen: SCREENS.HOME, focus: FOCUS.PRIMARY, listIndex: 0 };
      }
      return { ...state, exited: true };
    case "enter": return activate(state);
    default: return state;
  }
}

function listLength(state) {
  if (state.screen === SCREENS.HOME) return 2;
  if (state.screen === SCREENS.OVERVIEW) return 4;
  return 0;
}

function moveList(state, delta) {
  const len = listLength(state);
  if (len <= 0) return { ...state, focus: FOCUS.PRIMARY };
  if (state.focus !== FOCUS.LIST) {
    return { ...state, listIndex: delta > 0 ? 0 : len - 1, focus: FOCUS.LIST };
  }
  return { ...state, listIndex: (state.listIndex + delta + len) % len, focus: FOCUS.LIST };
}

function activate(state) {
  if (state.screen === SCREENS.HOME) {
    if (state.focus === FOCUS.LIST) {
      const id = buildHomeModel().secondary[state.listIndex]?.id;
      if (id === "overview") {
        return { ...state, screen: SCREENS.OVERVIEW, focus: FOCUS.PRIMARY, listIndex: 0, detailsOpen: false };
      }
      if (id === "details") return { ...state, detailsOpen: !state.detailsOpen, focus: FOCUS.DETAILS };
    }
    return { ...state, screen: SCREENS.SETUP, setupStep: 0, focus: FOCUS.PRIMARY, listIndex: 0, detailsOpen: false };
  }
  if (state.screen === SCREENS.SETUP) {
    if (state.setupStep >= SETUP_STEPS.length - 1) {
      return { ...state, screen: SCREENS.OVERVIEW, focus: FOCUS.PRIMARY, listIndex: 0, detailsOpen: false };
    }
    return { ...state, setupStep: state.setupStep + 1, focus: FOCUS.PRIMARY, detailsOpen: false };
  }
  if (state.screen === SCREENS.OVERVIEW) {
    return { ...state, screen: SCREENS.HOME, focus: FOCUS.PRIMARY, listIndex: 0, detailsOpen: false };
  }
  return state;
}
