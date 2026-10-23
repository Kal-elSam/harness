const { check } = require('./_check.cjs');
check('redact-logs', (api, assert, root, temp, fs, path) => {
  const input={name:'demo',clave:'secreto',nested:[{contraseña:'oculta',código:'123',ok:2}]}; const result=api.redact(input); assert.deepEqual(result,{name:'demo',nested:[{ok:2}]}); assert.equal(input.clave,'secreto'); assert.ok(!JSON.stringify(result).includes('oculta'));
});

