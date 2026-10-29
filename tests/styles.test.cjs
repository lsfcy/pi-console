const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/styles.css'), 'utf8');

test('UI 字体不小于 11px', () => {
  assert.doesNotMatch(css, /font-size\s*:\s*(?:[0-9]|10)px\b/, 'font-size below 11px');
  assert.doesNotMatch(css, /font\s*:\s*(?:[0-9]|10)px\b/, 'font shorthand below 11px');
});
