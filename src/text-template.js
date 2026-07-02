export function renderTemplate(input, project) {
  const replacements = {
    "[PROJECT_NAME]": project.name,
    "[PROJECT_PURPOSE]": project.purpose,
    "[STACK]": project.stack,
    "[PACKAGE_MANAGER]": project.packageManager,
    "[ARCHITECTURE_PATTERN]": project.architecturePattern,
    "[INSTALL_COMMAND]": project.commands.install,
    "[DEV_COMMAND]": project.commands.dev,
    "[LINT_COMMAND]": project.commands.lint,
    "[FORMAT_COMMAND]": project.commands.format,
    "[TYPE_CHECK_COMMAND]": project.commands.typeCheck,
    "[TEST_COMMAND]": project.commands.test,
    "[BUILD_COMMAND]": project.commands.build
  };

  let output = input;

  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }

  return output;
}
