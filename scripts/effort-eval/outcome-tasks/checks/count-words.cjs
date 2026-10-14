const { check } = require('./_check.cjs');
check('count-words', (api, assert, root, temp, fs, path) => {
  assert.equal(api.count('  uno\tdos\n tres '),3); assert.equal(api.count(''),0);
});

