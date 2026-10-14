const { check } = require('./_check.cjs');
check('parse-records', (api, assert, root, temp, fs, path) => {
  assert.deepEqual(api.parse(' a = one=two\n\n b=3 '),{a:'one=two',b:'3'}); assert.throws(()=>api.parse('broken')); assert.throws(()=>api.parse('=x'));
});

