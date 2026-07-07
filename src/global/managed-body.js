import { formatCliCommand } from "./brand/cli.js";
import { BRAND } from "./brand/index.js";

export function buildManagedBody(context, adapter) {
  const sections = [
    `## ${BRAND.displayName} (managed)`,
    "",
    `Managed by \`${context.packageName}\`. Content inside these markers is refreshed by`,
    `\`${formatCliCommand("sync")}\`. Everything outside the markers is yours and is preserved.`
  ];

  if (context.components.length === 0) {
    sections.push("", "_No optional components installed. Core plumbing only._");
    return sections.join("\n");
  }

  for (const component of context.components) {
    sections.push("", component.buildManagedSection(context, adapter));
  }

  sections.push(
    "",
    `- Run \`${formatCliCommand("doctor")}\` to check ecosystem health.`,
    `- Run \`${formatCliCommand("uninstall")}\` to remove managed sections safely.`
  );

  return sections.join("\n");
}
