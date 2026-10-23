const { check } = require('./_check.cjs');
check('paginate', (api, assert, root, temp, fs, path) => {
  const items=[1,2,3,4,5]; assert.deepEqual(api.page(items,1,2),[1,2]); assert.deepEqual(api.page(items,3,2),[5]); assert.deepEqual(api.page(items,9,2),[]); assert.throws(()=>api.page(items,0,2),RangeError); assert.throws(()=>api.page(items,1,1.5),RangeError); assert.deepEqual(items,[1,2,3,4,5]);
});

