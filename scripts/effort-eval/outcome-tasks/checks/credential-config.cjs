const { check } = require('./_check.cjs');
check('credential-config', (api, assert, root, temp, fs, path) => {
  assert.throws(()=>api.resolveConfig({})); assert.throws(()=>api.resolveConfig({API_KEY:'  '})); const c=api.resolveConfig({API_KEY:' synthetic-value '}); assert.equal(c.key,'synthetic-value'); assert.equal(c.endpoint,'https://example.invalid'); assert.deepEqual(api.describe(c),{endpoint:'https://example.invalid',configured:true}); assert.ok(!JSON.stringify(api.describe(c)).includes('synthetic-value'));
});

