import { createHost, detectDirs } from "./render.js";

// Kimi agent files have no model field and hooks cannot rewrite the model (matrix L12).
export default createHost({
  id: "kimi",
  unsupportedReason: "no-model-field",
  caps: { namedRoles: "unverified", roleModelField: false, perLaunchModel: false, launchHook: false, nativeProviders: ["kimi"], roleDir: null },
  detect: (context) => detectDirs({ homeDirName: ".kimi", projectDirName: ".kimi" }, context),
  format: () => ""
});
