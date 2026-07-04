export function buildManagedBody(context, adapter) {
  const sections = [
    "## Harness (managed)",
    "",
    `Managed by \`${context.packageName}\`. Content inside these markers is refreshed by`,
    "`harness sync`. Everything outside the markers is yours and is preserved."
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
    "- Run `harness doctor` to check ecosystem health.",
    "- Run `harness uninstall` to remove managed sections safely."
  );

  return sections.join("\n");
}
