const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function rcVersion(version) {
  const match = /^(\d+\.\d+\.\d+)-rc(?:\.([1-9]\d*))?$/.exec(version);
  if (!match || !match[1].split('.').every(part => String(Number(part)) === part) ||
      (match[2] && !Number.isSafeInteger(Number(match[2]) + 1))) throw new Error('版本必须为 x.y.z-rc 或 x.y.z-rc.N（N 从 1 开始）');
  return match;
}
function nextRc(version) {
  const match = rcVersion(version);
  return match[1] + '-rc.' + (Number(match[2] || 0) + 1);
}
function releaseVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:rc(?:\.[1-9]\d*)?|snapshot(?:\.[1-9]\d*)?))?$/.test(version) || !version.split('-')[0].split('.').every(part => Number.isSafeInteger(Number(part)))) throw new Error('无效的发布版本。');
  return version;
}
function releasePaths(version) {
  releaseVersion(version);
  const output = path.join(root, 'dist-v' + version);
  return { output, application: path.join(output, 'Pi Console-darwin-arm64/Pi Console.app'),
    archive: path.join(output, 'Pi-Console-' + version + '-macOS-arm64.zip'),
    checksums: path.join(output, 'SHA256SUMS.txt'), manifest: path.join(output, 'release.json') };
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...options });
}
function capture(command, args) { return run(command, args, { stdio: 'pipe' }).trim(); }
function cleanCommit() {
  if (capture('git', ['status', '--porcelain'])) throw new Error('请先提交源码和更新说明；只构建干净提交。');
  return capture('git', ['rev-parse', 'HEAD']);
}
function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function checksumText(archive, digest) { return digest + '  ' + path.basename(archive) + '\n'; }

function build(version) {
  const commit = cleanCommit();
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('当前安装包仅支持在 macOS Apple Silicon 构建。');
  const files = releasePaths(version);
  if (capture('ps', ['-axo', 'command=']).split('\n').some(command => command.includes(files.application + '/'))) {
    throw new Error('目标安装包仍在运行；退出后重建，或递增 rc 版本，禁止覆盖运行中的应用。');
  }
  for (const task of ['check', 'test:onboarding', 'test:i18n', 'test:smoke', 'test:sidebar', 'test:settings', 'test:lifecycle', 'test:relay']) run('npm', ['run', task]);
  run('npm', ['run', 'package'], { env: { ...process.env, PI_GUI_PACKAGE_OUT: files.output } });
  run('npm', ['run', 'test:packaged'], { env: { ...process.env, PI_GUI_PACKAGED_APP: files.application } });
  if (fs.existsSync(path.join(files.application, 'Contents/Resources/app/.git'))) throw new Error('安装包中不应包含 Git 数据。');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', files.application, files.archive]);
  const digest = sha256(files.archive);
  fs.writeFileSync(files.checksums, checksumText(files.archive, digest));
  fs.writeFileSync(files.manifest, JSON.stringify({ version, commit, platform: 'darwin-arm64',
    archive: path.basename(files.archive), sha256: digest, bytes: fs.statSync(files.archive).size }, null, 2) + '\n');
  console.log('已验证构建：' + files.archive);
}


function main(action) {
  const version = require('../package.json').version;
  releaseVersion(version);
  const lock = require('../package-lock.json');
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package.json 与 lockfile 版本不一致。');
  if (action === 'bump') {
    cleanCommit();
    run('npm', ['version', nextRc(version), '--no-git-tag-version', '--ignore-scripts']);
  } else if (action === 'build') build(version);
  else throw new Error('用法：node scripts/release.cjs bump|build');
}
if (require.main === module) {
  try { main(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { nextRc, rcVersion, releaseVersion, releasePaths };
