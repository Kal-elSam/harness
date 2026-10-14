const { check } = require('./_check.cjs');
check('owner-guard', (api, assert, root, temp, fs, path) => {
  assert.equal(api.canRead(null,{ownerId:'u'}),false); assert.equal(api.canRead({id:'u',roles:[]},{ownerId:'u'}),true); assert.equal(api.canRead({id:'v',roles:[]},{ownerId:'u'}),false); assert.equal(api.canRead({id:'v',roles:['admin']},{ownerId:'u'}),true); assert.equal(api.canRead({id:'',roles:[]},{ownerId:''}),false);
});

