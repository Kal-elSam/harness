const { check } = require('./_check.cjs');
check('session-expiry', (api, assert, root, temp, fs, path) => {
  assert.equal(api.allow({id:'s',userId:'u',expiresAt:11},10,[]),true); assert.equal(api.allow({id:'s',userId:'u',expiresAt:10},10,[]),false); assert.equal(api.allow({id:'s',userId:'u',expiresAt:11},10,['s']),false); assert.equal(api.allow(null,10,[]),false); assert.equal(api.allow({id:'s',expiresAt:11},10,[]),false); assert.equal(require(path.join(root,'rules.cjs')).expiry(10,10),false);
});

