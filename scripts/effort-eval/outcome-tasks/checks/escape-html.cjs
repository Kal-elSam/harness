const { check } = require('./_check.cjs');
check('escape-html', (api, assert, root, temp, fs, path) => {
  assert.equal(api.escape('A & <B>'), 'A &amp; &lt;B&gt;'); assert.equal(api.escape('plain'), 'plain');
});

