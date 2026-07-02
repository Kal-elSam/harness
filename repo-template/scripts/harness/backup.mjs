import fs from 'node:fs';
import path from 'node:path';
const snapshotDir = path.join('.harness', 'snapshots', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(snapshotDir, { recursive: true });
const targets = ['AGENTS.md','docs','.cursor','.codex','.claude','.opencode','.github','.gentle-ai','.pi'].filter((t) => fs.existsSync(t));
for (const target of targets) fs.cpSync(target, path.join(snapshotDir, target), { recursive: true });
console.log(`Harness snapshot created: ${snapshotDir}`);
