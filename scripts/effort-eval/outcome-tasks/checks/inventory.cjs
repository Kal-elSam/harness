const { check } = require('./_check.cjs');
check('inventory', (api, assert, root, temp, fs, path) => {
  const s={a:4,b:1}; assert.deepEqual(api.reserve(s,[{sku:'a',qty:1},{sku:'a',qty:2}]),{a:1,b:1}); assert.deepEqual(s,{a:4,b:1}); assert.throws(()=>api.reserve(s,[{sku:'a',qty:5}])); assert.throws(()=>api.reserve(s,[{sku:'z',qty:1}])); assert.throws(()=>api.reserve(s,[{sku:'a',qty:-1}])); assert.deepEqual(s,{a:4,b:1});
});

