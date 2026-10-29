const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerApplication, focusWindow, openProject } = require('../build/main/desktop-integration.cjs');

test('打开项目仅支持固定应用，目录独立传参；未安装和无效方式返回可见错误', async () => {
  const directory = '/tmp/中文 " $(touch nope)', calls = [];
  for (const [target, name] of Object.entries({ finder: 'Finder', vscode: 'Visual Studio Code', idea: 'IntelliJ IDEA', sourcetree: 'Sourcetree', terminal: 'Terminal' })) {
    await openProject(directory, target, async (...args) => calls.push(args));
    assert.deepEqual(calls.at(-1), ['/usr/bin/open', ['-a', name, directory]]);
  }
  await assert.rejects(openProject('relative', 'finder'), /目录/);
  for (const target of ['unknown', '__proto__', null, 'iterm']) await assert.rejects(openProject(directory, target), /打开方式/);
  await assert.rejects(openProject(directory, 'vscode', async () => { throw new Error('not found'); }), /Visual Studio Code.*已安装/);
});
test('注册精确的当前 bundle 路径，保留空格；注册失败不会被吞掉', async () => {
  const calls = [];
  await registerApplication('/a path/Pi Console.app', async (...args) => calls.push(args));
  assert.deepEqual(calls, [['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', '/a path/Pi Console.app']]]);
  await assert.rejects(registerApplication('Pi Console.app'), /路径/);
  await assert.rejects(registerApplication('/a/Pi Console'), /路径/);
  await assert.rejects(registerApplication('/a/Pi Console.app', async () => { throw new Error('registration failed'); }), /registration failed/);
});
test('通知、Dock 和第二实例统一唤回原窗口，最小化时先恢复，不创建窗口或进程', () => {
  const calls = [];
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'),
    show: () => calls.push('show'), focus: () => calls.push('window-focus') };
  const app = { focus: options => calls.push(options) };
  focusWindow(window, app);
  assert.deepEqual(calls, ['restore', 'show', 'window-focus', { steal: true }]);
  calls.length = 0; window.isMinimized = () => false;
  focusWindow(window, app);
  assert.deepEqual(calls, ['show', 'window-focus', { steal: true }]);
  calls.length = 0; window.isDestroyed = () => true;
  focusWindow(window, app); focusWindow(undefined, app);
  assert.deepEqual(calls, []);
});
test('打包应用以 UI agent 启动，只有实例锁拥有者能够显示 Dock 图标', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/app.cts'), 'utf8');
  const plist = fs.readFileSync(path.join(__dirname, '../assets/macos-info.plist'), 'utf8');
  const pkg = require('../package.json');
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\s*\/>/);
  assert(pkg.scripts.package.includes('--extend-info=assets/macos-info.plist'));
  assert(source.indexOf('app.requestSingleInstanceLock()') < source.indexOf('await app.dock?.show()'));
  assert(source.includes('app.dock?.hide(); app.quit(); return null;'));
  // The packaged smoke test also checks the final plist and a real duplicate launch.
});
test('改名保留旧配置和锁，通知注册仅由持锁正式应用执行，失败不发送原生通知', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/app.cts'), 'utf8');
  assert(source.includes("app.setName('Pi Console')"));
  assert(source.includes("path.join(app.getPath('appData'), 'Pi Session Console')"));
  assert(source.indexOf("app.setPath('userData'") < source.indexOf('app.requestSingleInstanceLock()'));
  assert(source.indexOf('app.requestSingleInstanceLock()') < source.indexOf('await desktop.registerApplication'));
  assert(source.indexOf('await registerNotifications();') < source.indexOf('new Notification('));
  assert(source.includes("process.platform !== 'darwin' || !app.isPackaged || testMode"));
  assert(source.includes('!notificationError && Notification.isSupported()'));
  assert(source.includes("send({ type: 'notice', message: notificationFailure() })"));
  assert.equal((source.match(/desktop.focusWindow\(window, app\)/g) || []).length, 3);
});
