const { check } = require('./_check.cjs');
check('parse-boolean', (api, assert, root, temp, fs, path) => {
  assert.equal(api.parse(' FALSE '),false); assert.equal(api.parse('True'),true); assert.equal(api.parse('yes'),null); assert.equal(api.parse(1),null);
});

