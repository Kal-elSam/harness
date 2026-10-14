const { check } = require('./_check.cjs');
check('invoice-rounding', (api, assert, root, temp, fs, path) => {
  const rows=[{unitCents:101,qty:3},{unitCents:50,qty:1}]; assert.equal(api.total(rows,10),318); assert.equal(api.total(rows,100),0); assert.equal(require(path.join(root,'rules.cjs')).subtotal(rows),353); assert.throws(()=>api.total(rows,101)); assert.throws(()=>api.total([{unitCents:1,qty:0}],0)); assert.deepEqual(rows,[{unitCents:101,qty:3},{unitCents:50,qty:1}]);
});

