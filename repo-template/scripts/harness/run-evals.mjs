import fs from 'node:fs';
import path from 'node:path';
const roots = ['evals/golden','evals/tool-calls','evals/schema','evals/regression','evals/loop-regression'];
let total = 0;
let failed = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of fs.readdirSync(root).filter((f) => f.endsWith('.json'))) {
    total++;
    const full = path.join(root, file);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!data.id || !data.type || !data.severity) {
        console.error(`Invalid eval schema: ${full}`);
        failed++;
      }
    } catch {
      console.error(`Failed to parse eval file: ${full}`);
      failed++;
    }
  }
}
if (failed > 0) {
  console.error(`Eval validation failed: ${failed}/${total}`);
  process.exit(1);
}
console.log(`Eval validation passed: ${total} eval files checked.`);
