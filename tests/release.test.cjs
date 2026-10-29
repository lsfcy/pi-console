const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nextRc, rcVersion, releaseVersion, releasePaths } = require('../scripts/release.cjs');

test('候选版从 rc 递增为 rc.1，此后仅递增 rc 数字', () => {
  assert.equal(nextRc('0.0.1-rc'), '0.0.1-rc.1');
  assert.equal(nextRc('0.0.1-rc.1'), '0.0.1-rc.2');
  assert.equal(nextRc('0.0.1-rc.9'), '0.0.1-rc.10');
  for (const value of ['0.0.1', 'v0.0.1-rc', '0.0.1-beta', '0.0.1-rc.0', '0.0.1-rc.01', '00.0.1-rc', '../rc', '0.0.1-rc.9007199254740991', '0.0.1-snapshot.0']) {
    assert.throws(() => rcVersion(value), /版本/);
  }
});
test('安装包路径由唯一版本源生成且不会覆盖不同候选版', () => {
  const first = releasePaths('0.0.1-rc'), next = releasePaths('0.0.1-rc.1');
  assert.notEqual(first.output, next.output);
  assert(first.application.startsWith(first.output + path.sep));
  assert.equal(path.basename(first.archive), 'Pi-Console-0.0.1-rc-macOS-arm64.zip');
});
test('版本来自主进程快照，GitHub 更新仓库显式配置且发布仍需人工确认', () => {
  const pkg = require('../package.json'), lock = require('../package-lock.json');
  assert.equal(pkg.private, false);
  assert.equal(pkg.name, 'pi-console');
  assert.equal(pkg.productName, 'Pi Console');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(path.basename(releasePaths(pkg.version).application), 'Pi Console.app');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.repository.url, 'https://github.com/lsfcy/pi-console.git');
  assert.equal(releaseVersion('0.0.1'), '0.0.1');
  assert.equal(path.basename(releasePaths('0.0.1').archive), 'Pi-Console-0.0.1-macOS-arm64.zip');
  assert.equal(releaseVersion('0.0.1-snapshot'), '0.0.1-snapshot');
  assert.equal(path.basename(releasePaths('0.0.1-snapshot').archive), 'Pi-Console-0.0.1-snapshot-macOS-arm64.zip');
  for (const value of ['../0.0.1', 'v0.0.1', '00.0.1', '0.0.1-beta']) assert.throws(() => releaseVersion(value));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.scripts['release:publish'], undefined);
  const main = fs.readFileSync(path.join(__dirname, '../src/main/app.cts'), 'utf8');
  assert(main.includes("require('../../package.json')"));
  assert(main.includes('const appVersion = metadata.version'));
  const source = fs.readFileSync(path.join(__dirname, '../scripts/release.cjs'), 'utf8');
  assert(!source.includes("'gh'"));
  assert(!source.includes('obsoleteAssets'));
});
