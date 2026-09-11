"use strict";

const { spawn } = require("node:child_process");
const { isAbsolute, relative, resolve } = require("node:path");

function runKairoJson(args, { cwd, spawnFn = spawn } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnFn("kairo", [...args, "--json"], {
      cwd, shell: false, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Kairo exited with code ${code}.`));
        return;
      }
      try { resolvePromise(JSON.parse(stdout)); }
      catch { reject(new Error("Kairo returned invalid JSON.")); }
    });
  });
}

function exactPlanPath(cwd, plan) {
  const declared = plan?.artifacts?.plan;
  if (typeof declared !== "string" || !declared) throw new Error("Plan artifact path is missing.");
  if (typeof plan?.taskId !== "string" || declared !== `.ai/tasks/${plan.taskId}/plan.md`) {
    throw new Error("Plan artifact does not match its task id.");
  }
  const workspace = resolve(cwd);
  const projectRoot = resolve(plan?.projectRoot ?? workspace);
  const workspaceRel = relative(projectRoot, workspace);
  if (isAbsolute(workspaceRel) || workspaceRel === ".." || workspaceRel.startsWith("../")) {
    throw new Error("Plan project does not contain the active workspace.");
  }
  const path = resolve(projectRoot, declared);
  const rel = relative(projectRoot, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("../")) {
    throw new Error("Plan artifact escapes the workspace.");
  }
  return path;
}

async function openPlan(vscodeApi, cwd, plan) {
  const document = await vscodeApi.workspace.openTextDocument(exactPlanPath(cwd, plan));
  await vscodeApi.window.showTextDocument(document, { preview: false });
  return document;
}

async function choosePlan(vscodeApi, cwd, state, deps = {}) {
  const run = deps.runKairoJson ?? runKairoJson;
  const result = await run(["plans", "list", "--cwd", cwd], { cwd, spawnFn: deps.spawnFn });
  const plans = (result.plans ?? []).filter((plan) => !state || plan.state === state);
  if (!plans.length) {
    void vscodeApi.window.showInformationMessage(state ? `No ${state.replaceAll("_", " ")} plans.` : "No architecture plans.");
    return null;
  }
  const picked = await vscodeApi.window.showQuickPick(plans.map((plan) => ({
    label: plan.taskId,
    description: plan.state,
    detail: plan.artifacts?.plan,
    plan
  })), { placeHolder: "Select an architecture plan" });
  return picked?.plan ?? null;
}

function requireWorkspace(vscodeApi) {
  const folders = vscodeApi.workspace.workspaceFolders ?? [];
  if (folders.length !== 1 || vscodeApi.workspace.isTrusted !== true) {
    throw new Error("Kairo architecture requires one trusted local workspace folder.");
  }
  const folder = folders[0];
  if (folder.uri?.scheme && folder.uri.scheme !== "file") throw new Error("Kairo architecture requires a local workspace.");
  return folder.uri?.fsPath ?? folder.fsPath;
}

function createArchitectActions(vscodeApi, deps = {}) {
  const run = deps.runKairoJson ?? runKairoJson;
  const cwd = () => requireWorkspace(vscodeApi);
  const report = (error) => void vscodeApi.window.showErrorMessage(error?.message ?? String(error));

  const actions = {
    async architectTask(task) {
      try {
        const root = cwd();
        const normalized = typeof task === "string" ? task.trim() : "";
        if (!normalized) throw new Error("Architecture task is required.");
        const plan = await vscodeApi.window.withProgress({
          location: vscodeApi.ProgressLocation.Notification,
          title: "Codex is creating a read-only architecture plan…",
          cancellable: false
        }, () => run(["architect", "--task", normalized, "--cwd", root], { cwd: root, spawnFn: deps.spawnFn }));
        if (plan.planPath || plan.state !== "draft") await openPlan(vscodeApi, root, plan);
        return plan;
      } catch (error) { report(error); return null; }
    },

    async architect() {
      try {
        const task = await vscodeApi.window.showInputBox({
          title: "Kairo: Architecture Plan",
          prompt: "Describe the task Codex should analyze",
          ignoreFocusOut: true,
          validateInput: (value) => value.trim() ? null : "Task is required."
        });
        if (!task) return null;
        return actions.architectTask(task);
      } catch (error) { report(error); return null; }
    },

    async openPlanById(taskId) {
      try {
        const root = cwd();
        const plan = await run(["plans", "show", taskId, "--cwd", root], { cwd: root, spawnFn: deps.spawnFn });
        return openPlan(vscodeApi, root, plan);
      } catch (error) { report(error); return null; }
    },

    async openPlan() {
      try {
        const root = cwd();
        const plan = await choosePlan(vscodeApi, root, null, deps);
        return plan ? openPlan(vscodeApi, root, plan) : null;
      } catch (error) { report(error); return null; }
    },

    async decide(action) {
      try {
        const root = cwd();
        const plan = await choosePlan(vscodeApi, root, "awaiting_approval", deps);
        if (!plan) return null;
        const label = action === "approve" ? "Approve" : "Reject";
        const confirmed = await vscodeApi.window.showWarningMessage(
          `${label} architecture plan ${plan.taskId}?`, { modal: true }, label
        );
        if (confirmed !== label) return null;
        const result = await run(["plans", action, plan.taskId, "--cwd", root], {
          cwd: root, spawnFn: deps.spawnFn
        });
        await openPlan(vscodeApi, root, result);
        return result;
      } catch (error) { report(error); return null; }
    },

    async decideById(action, taskId) {
      try {
        const root = cwd();
        if (!new Set(["approve", "reject"]).has(action)) throw new Error("Invalid plan decision.");
        const label = action === "approve" ? "Approve" : "Reject";
        const confirmed = await vscodeApi.window.showWarningMessage(
          `${label} architecture plan ${taskId}? Approval does not start implementation.`,
          { modal: true }, label
        );
        if (confirmed !== label) return null;
        return run(["plans", action, taskId, "--cwd", root], { cwd: root, spawnFn: deps.spawnFn });
      } catch (error) { report(error); return null; }
    },

    async executeById(taskId) {
      try {
        const root = cwd();
        const label = "Execute with Claude";
        const confirmed = await vscodeApi.window.showWarningMessage(
          `Execute approved plan ${taskId} with Claude? Kairo will require subscription authentication and safe permissions.`,
          { modal: true }, label
        );
        if (confirmed !== label) return null;
        return run(["conversation", "execute", taskId, "--cwd", root], {
          cwd: root, spawnFn: deps.spawnFn
        });
      } catch (error) { report(error); return null; }
    },

    async cancelById(taskId) {
      try {
        const root = cwd();
        const label = "Cancel Claude run";
        const confirmed = await vscodeApi.window.showWarningMessage(
          `Cancel the Claude run for ${taskId}?`, { modal: true }, label
        );
        if (confirmed !== label) return null;
        return run(["conversation", "cancel", taskId, "--cwd", root], {
          cwd: root, spawnFn: deps.spawnFn
        });
      } catch (error) { report(error); return null; }
    },

    async implementPlan() {
      try {
        const root = cwd();
        const plan = await choosePlan(vscodeApi, root, "approved", deps);
        if (!plan) return null;
        await openPlan(vscodeApi, root, plan);
        void vscodeApi.window.showInformationMessage(
          "Approved plan opened. Use Cursor Auto with this exact artifact; Kairo does not inject undocumented chat commands."
        );
        return plan;
      } catch (error) { report(error); return null; }
    }
  };
  return actions;
}

module.exports = {
  choosePlan, createArchitectActions, exactPlanPath, openPlan, requireWorkspace, runKairoJson
};
