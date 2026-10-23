const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const manifest = require('../manifest.json');

function tree(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = path.posix.join(prefix, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'symlinks are forbidden');
    return entry.isDirectory() ? tree(root, name) : [name];
  }).sort();
}
exports.check = (id, verify) => {
  let temp;
  try {
    const root = path.resolve(process.argv[2] || '.');
    const task = manifest.tasks.find(task => task.id === id);
    const baseline = path.resolve(__dirname, '..', task.fixture);
    const before = tree(baseline);
    function checkScope() {
      const after = tree(root);
      for (const name of new Set([...before, ...after])) {
        if (task.scope.includes(name)) continue;
        assert.ok(before.includes(name) && after.includes(name), 'file outside scope: ' + name);
        assert.deepEqual(fs.readFileSync(path.join(root,name)), fs.readFileSync(path.join(baseline,name)), 'change outside scope: ' + name);
      }
    }
    checkScope();
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-check-'));
    verify(require(path.join(root,'task.cjs')), assert, root, temp, fs, path);
    checkScope();
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
};

