const { check } = require('./_check.cjs');
check('dependency-order', (api, assert, root, temp, fs, path) => {
  assert.deepEqual(api.order({a:['z'],z:[],b:['z']}),['z','a','b']); assert.throws(()=>api.order({a:['b'],b:['a']})); assert.throws(()=>api.order({a:['missing']})); assert.deepEqual(api.order({}),[]);
});

