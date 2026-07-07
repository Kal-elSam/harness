import { paint } from "./terminal.js";

const STATUS_STYLES = {
  detected: { label: "detected", style: "green" },
  selected: { label: "selected", style: "cyan" },
  managed: { label: "managed", style: "blue" },
  missing: { label: "missing", style: "gray" },
  drift: { label: "drift", style: "yellow" },
  planned: { label: "planned", style: "cyan" },
  error: { label: "error", style: "red" }
};

export function formatStatusBadge(status) {
  const entry = STATUS_STYLES[status] ?? { label: status, style: "gray" };
  return paint(` ${entry.label} `, entry.style);
}

export function formatStepHeader({ step, total, title }) {
  return [
    paint("Harness Setup", "bold"),
    paint(`Step ${step}/${total} · ${title}`, "cyan"),
    ""
  ].join("\n");
}

export function formatAgentLine({ label, status, selected = false, active = false }) {
  const marker = selected ? paint("[x]", "green") : paint("[ ]", "gray");
  const prefix = active ? paint("› ", "bold") : "  ";
  return `${prefix}${marker} ${label}${formatStatusBadge(status)}`;
}

export function formatComponentLine({ label, status, selected = false, active = false, defaultEnabled = false }) {
  const marker = selected ? paint("[x]", "green") : paint("[ ]", "gray");
  const prefix = active ? paint("› ", "bold") : "  ";
  const defaultHint = defaultEnabled ? paint(" default", "dim") : "";
  return `${prefix}${marker} ${label}${defaultHint}${formatStatusBadge(status)}`;
}

export function formatChangeLine(change) {
  return `  ${paint(change.action, "bold")} ${change.target} ${paint(`[${change.kind}]`, "dim")}`;
}

export function formatHelp(keys) {
  return paint(keys, "dim");
}
