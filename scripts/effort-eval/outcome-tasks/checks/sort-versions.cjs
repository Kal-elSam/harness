const { check } = require('./_check.cjs');
check('sort-versions', (api, assert, root, temp, fs, path) => {
  const v=['1.10.0','2.0.0','1.2.9']; assert.deepEqual(api.sort(v),['1.2.9','1.10.0','2.0.0']); assert.deepEqual(v,['1.10.0','2.0.0','1.2.9']);
});

