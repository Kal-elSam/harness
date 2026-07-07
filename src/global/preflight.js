import { commandHeader } from "./brand/index.js";
import { SECTION_END, SECTION_START } from "./managed-section.js";

export function shouldShowPreflight({
  preflight = true,
  dryRun = false,
  json = false,
  applying = true
}) {
  return preflight && applying && !dryRun && !json;
}

export function printManagedPreflight({
  command,
  summary,
  changes,
  preserved,
  markers = {
    start: SECTION_START,
    end: SECTION_END
  },
  consentSource = "none",
  policyProfile = "none"
}) {
  console.log(commandHeader(`preflight — ${command}`));
  console.log(`Consent source: ${consentSource}`);
  console.log(`Policy profile: ${policyProfile}`);
  console.log(`Summary: ${summary}`);
  console.log("");
  console.log("Managed markers:");
  console.log(`  start: ${markers.start}`);
  console.log(`  end:   ${markers.end}`);
  console.log("");

  if (changes.length === 0) {
    console.log("Planned managed changes: none");
  } else {
    console.log("Planned managed changes:");
    for (const change of changes) {
      console.log(
        `  ${change.action} ${change.target} [${change.kind}]`
      );
    }
  }

  console.log("");
  if (preserved.length > 0) {
    console.log("User-owned content preserved (outside managed markers):");
    for (const entry of preserved) {
      console.log(`  ${entry.path}`);
    }
  } else {
    console.log("User-owned content preserved: none detected in affected configs.");
  }

  console.log("");
}

export function summarizeDiffPreflight(diffReport) {
  return {
    summary: diffReport.summary,
    changes: diffReport.changes,
    preserved: diffReport.preserved
  };
}
