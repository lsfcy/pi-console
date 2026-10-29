const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('发布文件不包含个人绝对路径、私钥或常见访问令牌', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd:root, encoding:'utf8'}).split('\0');
  const patterns = [
    /\/Users\/[A-Za-z0-9._-]+\//,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/
  ];
  for (const file of new Set(files)) {
    if (!file || !fs.existsSync(path.join(root,file)) || !/\.(?:ts|tsx|cts|cjs|js|json|md|yml|yaml|html|css|svg)$/.test(file)) continue;
    const contents = fs.readFileSync(path.join(root,file),'utf8');
    for (const pattern of patterns) assert(!pattern.test(contents), file + ' contains a private path or credential pattern');
  }
});
