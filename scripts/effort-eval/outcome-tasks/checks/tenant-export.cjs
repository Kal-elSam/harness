const { check } = require('./_check.cjs');
check('tenant-export', (api, assert, root, temp, fs, path) => {
  const rows=[{id:1,nombre:'A',org:'uno',clave:'oculta'},{id:2,nombre:'B',org:'dos',clave:'otra'}]; assert.deepEqual(api.exportRows({org:'uno'},rows),[{id:1,nombre:'A'}]); assert.deepEqual(api.exportRows(null,rows),[]); assert.deepEqual(api.exportRows({},rows),[]); assert.equal(rows[0].clave,'oculta');
});

