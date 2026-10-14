const { check } = require('./_check.cjs');
check('merge-settings', (api, assert, root, temp, fs, path) => {
  const d={a:1,b:2,c:3},o={a:undefined,b:false,c:null}; assert.deepEqual(api.merge(d,o),{a:1,b:false,c:null}); assert.deepEqual(d,{a:1,b:2,c:3});
});

