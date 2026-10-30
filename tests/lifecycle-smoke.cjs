const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { app, dialog } = require('electron');
const { evaluateSource } = require('./ui-driver.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-lifecycle-'));
const gui = path.join(root, 'gui'), pi = path.join(root, 'pi'), project = path.join(root, 'project'), pids = path.join(root, 'pids.jsonl');
for (const dir of [gui, pi, project]) fs.mkdirSync(dir);
Object.assign(process.env, { PI_GUI_TEST_MODE: '1', PI_GUI_DATA_DIR: gui, PI_CODING_AGENT_DIR: pi,
  PI_CODING_AGENT_SESSION_DIR: path.join(pi, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
  ZDOTDIR: root, PI_LIFECYCLE_PIDS: pids, ANTHROPIC_API_KEY: 'not-a-real-key' });
fs.writeFileSync(pids, '');
const extension = path.join(root, 'marker.ts');
fs.writeFileSync(extension, `export default function(pi) { pi.registerCommand('lifecycle-marker', { description:'Offline lifecycle test', handler:async()=> { pi.sendMessage({customType:'lifecycle-marker',content:'LIFECYCLE_CONTENT',display:true}); pi.appendEntry('lifecycle-marker',{value:1}); } }); }`);
fs.writeFileSync(path.join(pi, 'settings.json'), JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-6', quietStartup: true, packages: [], skills: [], extensions: [extension] }));
fs.writeFileSync(path.join(pi, 'mcp.json'), JSON.stringify({ mcpServers: { lifecycle: { command: 'node', args: [path.join(__dirname, 'lifecycle-mcp.cjs')] } } }));
fs.writeFileSync(path.join(gui, 'projects.json'), JSON.stringify({ version: 1, selectedId: 'p', projects: [{ id: 'p', name: 'Lifecycle', path: fs.realpathSync(project) }], preferences: { onboardingSeen: true, workspaceTheme: 'dark', sidebarTheme: 'dark', completionNotice: false, completionSound: false, confirmClose: false } }));
let controller, response = 1, confirmations = 0;
dialog.showMessageBox = async () => { confirmations++; return { response }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => controller.window.webContents.executeJavaScript(evaluateSource(source), true);
const children = () => fs.readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, label, timeout = 25000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await delay(80); } throw new Error('Timeout: ' + label); }
function sessionFiles(dir = path.join(pi, 'sessions')) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sessionFiles(path.join(dir, item.name)) : [path.join(dir, item.name) + ':' + fs.readFileSync(path.join(dir, item.name), 'utf8')]).sort();
}
function ptyDescriptors() {
  const output = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(process.pid), '-Fn'], { encoding: 'utf8' });
  return output.split('\n').filter(line => /^n\/dev\/(ptmx|ttys)/.test(line)).length;
}
(async () => {
  controller = await require('../build/main/app.cjs').startApp();
  require('./ui-driver.cjs').driveConfirmations(controller, options => dialog.showMessageBox(controller.window, options));
  await until(() => js('window.piGuiReady && !library.loading'), 'renderer');
  const nativeSpawn = require('node-pty').spawn;
  const shortPty = () => new Promise(resolve => {
    const proc = nativeSpawn('/bin/sh', ['-c', 'printf lifecycle'], { env: process.env, cols: 80, rows: 24 });
    proc.onData(() => {}); proc.onExit(resolve);
  });
  await shortPty(); await delay(80); // warm up the native watcher before measuring
  const baseline = ptyDescriptors(), fdBaseline = fs.readdirSync('/dev/fd').length, allPids = [];
  for (let i=0;i<40;i++) await shortPty();
  await delay(80);
  assert.equal(ptyDescriptors(), baseline, '40 natural PTY exits do not leak masters');
  assert(fs.readdirSync('/dev/fd').length <= fdBaseline + 2, '40 exits do not accumulate kqueue/slave descriptors');
  console.log('PASS 40 short-lived PTYs: master/slave/kqueue FD baseline stable');
  for (let round = 0; round < 6; round++) {
    const ephemeral = round % 2 === 0, before = sessionFiles(), childCount = children().length;
    const state = await js('window.piGui.createPi("p", {resume:false,ephemeral:' + ephemeral + '})'); allPids.push(state.pid);
    await until(() => controller.terminals.list().find(s => s.id === state.id)?.bridgeReady, 'Pi bridge round ' + round);
    await until(() => children().length === childCount + 2, 'MCP and detached worker');
    const owned = children().slice(childCount).map(item => item.pid); allPids.push(...owned);
    await js('activateTerminal(' + JSON.stringify(state.id) + ')');
    if (ephemeral) {
      assert.equal(controller.terminals.list().find(s => s.id === state.id).sessionFile, null);
      assert(await js('Boolean(document.querySelector(".ephemeral-badge"))'), 'temporary badge visible');
      controller.terminals.write(state.id, state.runId, '/lifecycle-marker\r');
      await until(() => js('(() => {const t=views.get(' + JSON.stringify(state.id) + ').term;return Array.from({length:t.buffer.active.length},(_,i)=>t.buffer.active.getLine(i).translateToString()).join("\\n").includes("LIFECYCLE_CONTENT");})()'), 'temporary content rendered');
      if (!round) {
        fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, '../artifacts/0.0.1-dark-temporary.png'), (await controller.window.webContents.capturePage()).toPNG());
        response = 0; await js('window.piGui.closeTerminal(' + JSON.stringify(state.id) + ')');
        assert(controller.terminals.list().some(s => s.id === state.id), 'cancel preserves temporary conversation'); response = 1;
      }
    }
    await js('window.piGui.closeTerminal(' + JSON.stringify(state.id) + ')');
    await until(() => [state.pid, ...owned].every(pid => !alive(pid)), 'all Pi/MCP/worker PIDs gone');
    await until(() => js('views.size === 0'), 'xterm views released');
    assert.equal(controller.terminals.records.size, 0, 'no retained terminal records');
    if (ephemeral) assert.deepEqual(sessionFiles(), before, 'temporary content never written into session JSONL');
    assert(ptyDescriptors() <= baseline, 'each round returns PTY descriptors to baseline');
    console.log('PASS lifecycle round ' + (round + 1) + ': ' + (ephemeral ? 'temporary' : 'normal') + ', 4 processes released');
  }
  assert.equal(confirmations, 4, 'temporary closes always confirm; normal close preference remains off');
  assert(ptyDescriptors() <= baseline, 'PTY descriptors return to baseline');
  assert(allPids.every(pid => !alive(pid)));
  console.log('PASS six real Pi + Shell + stdio MCP + detached-worker cycles, PTY/xterm cleanup and no-session persistence');
  await controller.shutdown(); fs.rmSync(root, { recursive: true, force: true });
})().catch(async error => {
  console.error(error);
  try { await controller?.terminals.stopAll(); } catch (cleanup) { console.error(cleanup); }
  for (const item of children()) { try { process.kill(item.pid, 'SIGKILL'); } catch {} }
  fs.rmSync(root, { recursive: true, force: true }); app.exit(1);
});
