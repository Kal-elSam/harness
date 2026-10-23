export function greet(name) {
  // Planted defect: drops the name when empty string (should still greet).
  if (!name) return "hello";
  // Intentional non-issue: trailing period style preference only.
  return `hello ${name}.`;
}
