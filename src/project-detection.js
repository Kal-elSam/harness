import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

export async function detectProject(cwd) {
  const root = resolve(cwd);
  const packageJsonPath = resolve(root, "package.json");
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(await readFile(packageJsonPath, "utf8"))
    : null;

  const packageManager = detectPackageManager(root, packageJson);
  const scripts = packageJson?.scripts ?? {};

  return {
    root,
    name: packageJson?.name ?? basename(root),
    purpose: packageJson?.description ?? "AI-assisted software project",
    packageManager,
    stack: detectStack(root, packageJson),
    architecturePattern: detectArchitecture(root),
    commands: {
      install: installCommand(packageManager),
      dev: scriptCommand(packageManager, scripts, "dev"),
      lint: scriptCommand(packageManager, scripts, "lint"),
      format: scriptCommand(packageManager, scripts, "format"),
      typeCheck: scriptCommand(packageManager, scripts, "typecheck") ?? scriptCommand(packageManager, scripts, "type-check"),
      test: scriptCommand(packageManager, scripts, "test"),
      build: scriptCommand(packageManager, scripts, "build")
    }
  };
}

function detectPackageManager(root, packageJson) {
  if (existsSync(resolve(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(root, "yarn.lock"))) return "yarn";
  if (existsSync(resolve(root, "bun.lockb"))) return "bun";
  if (existsSync(resolve(root, "package-lock.json"))) return "npm";

  const declared = packageJson?.packageManager?.split("@")[0];
  return declared ?? "npm";
}

function detectStack(root, packageJson) {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };

  if (dependencies.next || existsSync(resolve(root, "next.config.js")) || existsSync(resolve(root, "next.config.mjs"))) return "Next.js";
  if (dependencies.vite || existsSync(resolve(root, "vite.config.js")) || existsSync(resolve(root, "vite.config.ts"))) return "Vite";
  if (dependencies.react) return "React";
  if (existsSync(resolve(root, "pyproject.toml"))) return "Python";
  if (existsSync(resolve(root, "go.mod"))) return "Go";
  if (existsSync(resolve(root, "Cargo.toml"))) return "Rust";
  if (packageJson) return "Node.js";
  return "Unknown";
}

function detectArchitecture(root) {
  if (existsSync(resolve(root, "src/domain")) || existsSync(resolve(root, "src/application"))) {
    return "Layered or Clean Architecture";
  }

  if (existsSync(resolve(root, "app")) || existsSync(resolve(root, "pages"))) {
    return "Framework-driven application";
  }

  return "To be documented";
}

function installCommand(packageManager) {
  if (packageManager === "pnpm") return "pnpm install";
  if (packageManager === "yarn") return "yarn install";
  if (packageManager === "bun") return "bun install";
  return "npm install";
}

function scriptCommand(packageManager, scripts, scriptName) {
  if (!scripts[scriptName]) return "Not configured";
  if (packageManager === "npm") return `npm run ${scriptName}`;
  return `${packageManager} ${scriptName}`;
}
