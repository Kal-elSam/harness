const { check } = require('./_check.cjs');
check('payment-replay', (api, assert, root, temp, fs, path) => {
  const s={total:0,ids:{}}; const a=api.charge(s,{id:'x',cents:125}); assert.deepEqual(a,{total:125,ids:{x:125}}); assert.deepEqual(api.charge(a,{id:'x',cents:125}),a); assert.throws(()=>api.charge(a,{id:'x',cents:200})); assert.throws(()=>api.charge(a,{id:'y',cents:-1})); assert.throws(()=>api.charge(a,{id:'y',cents:1.5})); assert.deepEqual(s,{total:0,ids:{}}); assert.deepEqual(a,{total:125,ids:{x:125}});
});

