import { createHost, detectDirs } from "./render.js";

// Pi roles are owned by gentle-pi (matrix L12); Kairo writes no role files there.
export default createHost({
  id: "pi",
  unsupportedReason: "owned-by-gentle-pi",
  caps: { namedRoles: "unverified", roleModelField: "unverified", perLaunchModel: "unverified", launchHook: "unverified", nativeProviders: "unverified", roleDir: null },
  detect: (context) => detectDirs({ adapterId: "pi", projectDirName: ".pi" }, context),
  format: () => ""
});
