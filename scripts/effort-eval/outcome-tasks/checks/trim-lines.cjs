const { check } = require('./_check.cjs');
check('trim-lines', (api, assert, root, temp, fs, path) => {
  assert.deepEqual(api.clean(' a \n\n b\r\n '), ['a','b']); assert.deepEqual(api.clean(''), []);
});

