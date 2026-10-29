const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-console-shots-'));
const agent = path.join(root, 'agent');
const data = path.join(root, 'data');
const images = path.join(__dirname, '..', 'docs', 'images');
const projects = [
  { id: 'web', name: 'acme-web', path: path.join(root, 'acme-web') },
  { id: 'api', name: 'billing-api', path: path.join(root, 'billing-api') }
];
for (const project of projects) { fs.mkdirSync(project.path, { recursive: true }); project.path = fs.realpathSync(project.path); }
fs.mkdirSync(path.join(agent, 'sessions'), { recursive: true });
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(images, { recursive: true });

const now = Date.now();
const sessions = [
  ['web', '修复登录回调超时', 'Web 端登录偶发 502，帮助我定位回调超时并给出最小修复。', 42_000, 1],
  ['web', '为搜索增加缓存', '搜索接口 QPS 偏高，评估 30 秒缓存与失效策略。', 128_000, 2],
  ['web', '梳理发布检查清单', '把发布前的回归、灰度与回滚步骤整理成清单。', 76_000, 4],
  ['api', '核对账单差异', '对比 10 月账单与支付流水，找出 3 笔差异。', 210_000, 1],
  ['api', '拆分退款服务', '把退款逻辑从单体里拆出来，先给出边界与迁移步骤。', 96_000, 3],
  ['api', '补充幂等测试', '为退款接口补充幂等与重试测试。', 54_000, 6]
];
for (const [projectId, name, prompt, costMicro, daysAgo] of sessions) {
  const project = projects.find(item => item.id === projectId);
  const id = projectId + '-' + Buffer.from(name).toString('hex').slice(0, 10);
  const at = new Date(now - daysAgo * 86_400_000 - 3_600_000).toISOString();
  const stamp = Date.parse(at);
  const entries = [
    { type: 'session', id, cwd: fs.realpathSync(project.path), timestamp: at, version: 1 },
    { type: 'session_info', name, timestamp: at },
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: prompt, timestamp: stamp } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: { role: 'assistant', model: 'claude-sonnet-4-6', provider: 'anthropic',
      content: [{ type: 'text', text: '已定位到回调重试与连接池竞争的问题，下面是修复方案与验证步骤。' }],
      usage: { input: 1800, output: 640, cacheRead: 12000, cacheWrite: 320, reasoning: 120, totalTokens: 15080,
        cost: { input: 0.0054, output: 0.0096, cacheRead: 0.0036, cacheWrite: 0.0008, total: 0.0194 } },
      stopReason: 'stop', durationMs: 8200, timestamp: stamp + 8200 } }
  ];
  fs.writeFileSync(path.join(agent, 'sessions', projectId + '-' + id + '.jsonl'), entries.map(item => JSON.stringify(item)).join('\n') + '\n');
}
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify({ version: 1, selectedId: 'web', projects,
  preferences: { sidebarTheme: 'dark', workspaceTheme: 'dark', historyLayout: 'cards', cardColumns: 3, confirmResume: false, completionNotice: false, completionSound: false } }));

Object.assign(process.env, { PI_GUI_TEST_MODE: '1', PI_GUI_DATA_DIR: data, PI_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_SESSION_DIR: path.join(agent, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  const controller = await require('../build/main/app.cjs').startApp({ spawnPty: () => { throw new Error('screenshot mode does not spawn PTYs'); } });
  await until(() => controller.window.webContents.executeJavaScript('Boolean(window.__consoleTest && window.piGuiReady)'), 'renderer ready');
  await until(() => controller.window.webContents.executeJavaScript('!__consoleTest.library.loading'), 'library');
  controller.window.show();
  controller.window.setContentSize(1440, 960);
  await delay(600);
  const js = source => controller.window.webContents.executeJavaScript(source, true);
  const shot = async name => {
    await delay(350);
    // Screenshots use synthetic projects; do not publish this machine's temporary paths.
    await js(`(() => {
      const root = ${JSON.stringify(fs.realpathSync(root))};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      window.__screenshotPaths = [];
      while (walker.nextNode()) {
        const node = walker.currentNode, old = node.nodeValue;
        if (old && old.includes(root)) { window.__screenshotPaths.push([node, old]); node.nodeValue = old.split(root).join('/example'); }
      }
    })()`);
    try {
      const image = await controller.window.webContents.capturePage();
      fs.writeFileSync(path.join(images, name), image.resize({ width: 1080 }).toPNG());
    } finally {
      await js('for (const [node, value] of window.__screenshotPaths || []) node.nodeValue = value; delete window.__screenshotPaths;');
    }
    console.log('wrote', name);
  };
  await js('__consoleTest.selectProject("web")');
  await delay(400);
  await shot('main-dark.png');
  await js('__consoleTest.setNavHeld(true)');
  await shot('keyboard-nav-dark.png');
  await js('__consoleTest.setNavHeld(false)');
  await js('__consoleTest.navTarget = __consoleTest.sessionHistory[0]; __consoleTest.navPending = true; __consoleTest.publish()');
  await shot('keyboard-enter-dark.png');
  await js('__consoleTest.cancelNav()');
  await js('__consoleTest.showRecent()');
  await delay(400);
  await shot('sessions-dark.png');
  await js('__consoleTest.openPalette()');
  await delay(250);
  await shot('palette-dark.png');
  await js('__consoleTest.closePalette(); __consoleTest.savePreferences({sidebarTheme:"light",workspaceTheme:"light"})');
  await delay(500);
  await js('__consoleTest.showRecent(); __consoleTest.setStatsVisible(true)');
  await delay(400);
  await shot('monitor-light.png');
  await js('__consoleTest.openSettings("appearance")');
  await delay(500);
  await shot('settings-light.png');
  await js('__consoleTest.savePreferences({language:"en-US"})');
  await delay(600);
  await shot('settings-en.png');
  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
})().catch(async error => {
  console.error(error);
  try { await app.quit(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
