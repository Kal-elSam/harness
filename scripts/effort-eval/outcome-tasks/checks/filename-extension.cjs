const { check } = require('./_check.cjs');
check('filename-extension', (api, assert, root, temp, fs, path) => {
  assert.equal(api.extension('Report.TAR.GZ'), 'gz'); assert.equal(api.extension('.env'), ''); assert.equal(api.extension('README'), '');
});

