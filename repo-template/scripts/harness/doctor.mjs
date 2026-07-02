import fs from 'node:fs';
const required = [
  'AGENTS.md',
  'docs/ai/governance.md',
  'docs/ai/adapter-parity.md',
  'docs/ai/enforcement.md',
  'docs/ai/quality-gates.md',
  'docs/ai/trust-policy.md',
  'docs/ai/eval-strategy.md',
  'docs/skills',
  'docs/specs',
  'evals'
];
const missing = required.filter((path) => !fs.existsSync(path));
if (missing.length) {
  console.error('Harness doctor failed. Missing:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}
console.log('Harness doctor passed.');
