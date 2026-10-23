const { check } = require('./_check.cjs');
check('clamp-range', (api, assert, root, temp, fs, path) => {
  assert.equal(api.clamp(12,0,10),10); assert.equal(api.clamp(-2,0,10),0); assert.equal(api.clamp(5,0,10),5); assert.throws(()=>api.clamp(2,5,1),RangeError);
});

