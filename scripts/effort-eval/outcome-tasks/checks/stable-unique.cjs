const { check } = require('./_check.cjs');
check('stable-unique', (api, assert, root, temp, fs, path) => {
  assert.deepEqual(api.unique(['b','a','b','c','a']), ['b','a','c']); assert.deepEqual(api.unique([]), []);
});

