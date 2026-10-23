const { check } = require('./_check.cjs');
check('sum-values', (api, assert, root, temp, fs, path) => {
  assert.equal(api.sum([2,'3',NaN,4,Infinity,null]), 6); assert.equal(api.sum([]), 0);
});

