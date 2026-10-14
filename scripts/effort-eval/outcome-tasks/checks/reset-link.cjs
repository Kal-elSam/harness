const { check } = require('./_check.cjs');
check('reset-link', (api, assert, root, temp, fs, path) => {
  const digest=require('node:crypto').createHash('sha256').update('opaque-demo').digest('hex'); const rows=[{digest,expiresAt:20,used:false,userId:'u'}]; const before=JSON.stringify(rows); assert.equal(api.redeem(rows,'bad',10),null); assert.equal(JSON.stringify(rows),before); assert.equal(api.redeem(rows,'opaque-demo',20),null); assert.equal(JSON.stringify(rows),before); assert.equal(api.redeem(rows,'opaque-demo',19),'u'); assert.equal(rows[0].used,true); assert.equal(api.redeem(rows,'opaque-demo',19),null); assert.ok(!JSON.stringify(rows).includes('opaque-demo'));
});

