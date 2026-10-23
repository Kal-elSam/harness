const { check } = require('./_check.cjs');
check('recovery-at-rest', (api, assert, root, temp, fs, path) => {
  const f=path.join(temp,'codes.json'); api.save(f,['sol-luna-123','mar-456']); const raw=fs.readFileSync(f,'utf8'); assert.ok(!raw.includes('sol-luna-123')&&!raw.includes('mar-456')); assert.deepEqual(JSON.parse(raw),['sol-luna-123','mar-456'].map(x=>require('node:crypto').createHash('sha256').update(x).digest('hex'))); assert.equal(api.consume(f,'wrong'),false); assert.equal(fs.readFileSync(f,'utf8'),raw); assert.equal(api.consume(f,'sol-luna-123'),true); assert.equal(api.consume(f,'sol-luna-123'),false); assert.equal(api.consume(f,'mar-456'),true);
});

