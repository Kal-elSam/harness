import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFileBeforeChange } from '../backups.js';
import { writeAtomicText } from '../runtime/write-atomic-json.js';

const marker = 'Kairo quota pacing (managed)';
const owned = group => group?.hooks?.length === 1 && group.hooks[0].statusMessage === marker
  && /[/\\]codex-pacing-hook\.js['"]?$/.test(group.hooks[0].command ?? '');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const quote = value => process.platform === 'win32' ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`;

export function planCodexPacing(context, remove = false) {
  const path = join(context.homeDir, '.codex/hooks.json');
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  let document;
  try {
    document = current ? JSON.parse(current) : {};
    if (!object(document) || (document.hooks !== undefined && !object(document.hooks))) throw new Error();
    if (document.hooks?.UserPromptSubmit !== undefined && !Array.isArray(document.hooks.UserPromptSubmit)) throw new Error();
  } catch { throw new Error('Codex hooks.json is invalid; repair it before installing or removing Kairo.'); }
  const groups = document.hooks?.UserPromptSubmit ?? [];
  const others = groups.filter(group => !owned(group));
  if (remove && others.length === groups.length) return { path, current, next: current, changed: false };
  const packageRoot = context.packageRoot ?? fileURLToPath(new URL('../../../', import.meta.url));
  const handler = { type: 'command', command: `${quote(process.execPath)} ${quote(join(packageRoot, 'src/global/hosts/codex-pacing-hook.js'))}`, timeout: 4, statusMessage: marker };
  const nextGroups = remove ? others : [...others, { hooks: [handler] }];
  if (JSON.stringify(groups) === JSON.stringify(nextGroups)) return { path, current, next: current, changed: false };
  document.hooks ??= {};
  if (remove && !nextGroups.length) delete document.hooks.UserPromptSubmit;
  else document.hooks.UserPromptSubmit = nextGroups;
  const next = `${JSON.stringify(document, null, 2)}\n`;
  return { path, current, next, changed: next !== current };
}

export async function applyCodexPacing(context, plan) {
  if (!plan.changed) return null;
  // Re-read before mutation: never overwrite changes made after the preview.
  const current = existsSync(plan.path) ? readFileSync(plan.path, 'utf8') : '';
  if (current !== plan.current) throw new Error('Codex hooks changed after planning; retry the install.');
  const backup = await backupFileBeforeChange({ backupsDir: context.paths.backupsDir, homeDir: context.homeDir,
    filePath: plan.path, timestamp: context.timestamp, dryRun: context.dryRun });
  if (!context.dryRun) {
    await mkdir(dirname(plan.path), { recursive: true });
    const mode = existsSync(plan.path) ? statSync(plan.path).mode & 0o777 : 0o600;
    await writeAtomicText(plan.path, plan.next, { open: (path, flags) => open(path, flags, mode) });
  }
  return backup;
}
