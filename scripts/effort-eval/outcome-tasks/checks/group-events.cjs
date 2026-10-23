const { check } = require('./_check.cjs');
check('group-events', (api, assert, root, temp, fs, path) => {
  const events=[{kind:'x',id:1},{kind:'x',id:2},{kind:'__proto__',id:3}]; const g=api.group(events); assert.deepEqual(g.x,[1,2]); assert.deepEqual(g.__proto__,[3]); assert.equal(events.length,3);
});

