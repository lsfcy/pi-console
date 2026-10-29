const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveLocalLink } = require('../build/main/local-link.cjs');

test('相对路径以会话工作目录解析，绝对路径、file URL 和编码字符可定位', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-local-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'a b#中.zip'); fs.writeFileSync(file, 'fixture');
  assert.equal(resolveLocalLink('a%20b%23%E4%B8%AD.zip', root), file);
  assert.equal(resolveLocalLink('a%20b%23%E4%B8%AD.zip#L10', root), file);
  assert.equal(resolveLocalLink(file.replace('#', '%23'), root), file);
  assert.equal(resolveLocalLink(pathToFileURL(file).href, root), file);
  assert.equal(resolveLocalLink('.', root), root);
});
test('拒绝网络文件、危险协议、控制字符、无效编码和不存在的文件', () => {
  for (const value of ['file://remote/tmp/a', '//remote/a', '\\\\remote\\a', 'javascript:alert(1)', 'data:text/html,x', 'https://example.com/a', '%00', '%ZZ', '#only-anchor', '', 'a\ncommand']) {
    assert.throws(() => resolveLocalLink(value, '/tmp'), value);
  }
  assert.throws(() => resolveLocalLink('missing-pi-console-file-123456', '/tmp'), /不存在/);
});
