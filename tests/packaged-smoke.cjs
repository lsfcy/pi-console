const assert = require('node:assert/strict');
const { evaluateSource } = require('./ui-driver.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { terminateTree } = require('../build/main/process-tree.cjs');

const application = process.env.PI_GUI_PACKAGED_APP || path.resolve(__dirname, '../dist/Pi Console-darwin-arm64/Pi Console.app');
const executable = path.join(application, 'Contents/MacOS/Pi Console');
const artifacts = path.resolve(__dirname, '../artifacts');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-packaged-'));
const project = path.join(temporary, 'packaged-project');
const guiData = path.join(temporary, 'gui-config');
const piData = path.join(temporary, 'pi-config');
for (const directory of [project, guiData, piData, artifacts]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(guiData, 'projects.json'), JSON.stringify({
  version: 1, projects: [{ id: 'packaged-test', name: 'packaged-project', path: fs.realpathSync(project) }], selectedId: 'packaged-test'
}));
fs.writeFileSync(path.join(piData, 'settings.json'), JSON.stringify({
  defaultProvider: 'anthropic', defaultModel: 'claude-sonnet-4-6', quietStartup: true,
  packages: [], extensions: [], skills: []
}));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let socket;
let logs = '';
async function until(condition, name, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(100);
  }
  throw new Error('Timeout: ' + name);
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}

(async () => {
  assert(fs.existsSync(executable), 'Run npm run package first');
  if (process.platform === 'darwin') execFileSync('codesign', ['--verify', '--deep', '--strict', application], {stdio:'pipe'});
  const debugPort = await port();
  child = spawn(executable, ['--remote-debugging-port=' + debugPort, '--remote-debugging-address=127.0.0.1'], {
    env: { ...process.env, PI_GUI_DATA_DIR: guiData, PI_CODING_AGENT_DIR: piData, PI_CODING_AGENT_SESSION_DIR: path.join(piData, 'sessions'),
      PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1', PI_GUI_TEST_MODE: '1', ANTHROPIC_API_KEY: 'not-a-real-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => { logs = (logs + data).slice(-256 * 1024); });
  child.stderr.on('data', data => { logs = (logs + data).slice(-256 * 1024); });
  let target;
  await until(async () => {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      target = targets.find(item => item.type === 'page' && item.url.startsWith('file:'));
      return Boolean(target);
    } catch { return false; }
  }, 'packaged renderer');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timeout); request.resolve(message); }
  });
  async function command(method, params) {
    const id = ++sequence;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 10000);
      pending.set(id, { resolve, timeout });
    });
    socket.send(JSON.stringify({ id, method, params }));
    const result = await response;
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression: evaluateSource(expression), awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await until(() => evaluate('window.piGuiReady === true'), 'packaged app ready');
  assert.equal(await evaluate('document.getElementById("app-version").textContent'), require('../package.json').version, 'tested package matches the release version');
  const duplicate = spawn(executable, [], { env: { ...process.env, PI_GUI_DATA_DIR: guiData, PI_GUI_TEST_MODE: '1' }, stdio: 'pipe' });
  let duplicateErrors = ''; duplicate.stderr.on('data', data => { duplicateErrors += data; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { duplicate.kill('SIGKILL'); reject(new Error('duplicate packaged app did not exit')); }, 10000);
    duplicate.once('error', error => { clearTimeout(timeout); reject(error); });
    duplicate.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('duplicate app failed: ' + duplicateErrors)); });
  });
  assert.equal(child.exitCode, null, 'the original packaged app retains the instance lock');
  await evaluate('window.piGui.hideWindow()');
  assert.equal(await evaluate('document.title'), 'Pi Console');
  assert.equal(await evaluate('document.querySelector(".brand strong").textContent'), 'Pi Console');
  assert(await evaluate('document.querySelector(".brand-mark").complete && document.querySelector(".brand-mark").naturalWidth === 1024'), 'console brand asset is packaged and loadable');
  if (process.platform === 'darwin') {
    const plist = path.join(application, 'Contents/Info.plist');
    const read = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist], { encoding: 'utf8' }).trim();
    assert(fs.readFileSync(path.join(application,'Contents/Resources/app/assets/menu-icons.png')).equals(fs.readFileSync(path.join(__dirname,'../assets/menu-icons.png'))),'native menu icon atlas is included in the signed package');
    assert.equal(read('CFBundleDisplayName'), 'Pi Console');
    assert.equal(read('CFBundleExecutable'), 'Pi Console');
    assert.equal(read('LSUIElement'), 'true', 'secondary copies are UI agents until they own the lock');
    assert.equal(read('CFBundleIdentifier'), 'dev.local.pi-session-console', 'persistent identity survives the display rename');
    assert(fs.readFileSync(path.join(application, 'Contents/Resources', read('CFBundleIconFile'))).equals(fs.readFileSync(path.join(__dirname, '../assets/icon.icns'))), 'Finder icon matches the new console asset');
  }
  assert.deepEqual(fs.readdirSync(path.join(application, 'Contents/Resources/app')).sort(),
    ['LICENSE', 'assets', 'build', 'node_modules', 'package.json'].sort(), 'package contains only the runtime allowlist');
  assert.equal(await evaluate('document.getElementById("recent-time-range")'), null);
  assert.equal(await evaluate('document.getElementById("open-iterm")'), null);
  assert.equal(await evaluate('typeof window.piGui.openIterm'), 'undefined');
  assert.equal(await evaluate('recentTimeRange'), 'month', 'statistics default to the last month');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".sidebar-actions .nav-icon"),b=>b.id)'), ['open-settings','recent-sessions']);
  assert(await evaluate('Array.from(document.querySelectorAll(".sidebar-actions .nav-icon"),b=>b.textContent.trim()).every(text=>!text)'), 'packaged navigation is icon-only');
  assert.equal(await evaluate('document.querySelectorAll(".nav-badge, .nav-entry").length'), 0, 'no numbers attached to navigation icons');
  assert(await evaluate('document.getElementById("running-count").parentElement.classList.contains("sidebar-bottom")'), 'independent runtime footer text');
  assert.equal(await evaluate('document.getElementById("running-count").textContent'), '运行中 0');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("running-count")).visibility'), 'visible');
  assert(await evaluate('Array.from(document.querySelectorAll(".shortcut-hints > span"),e=>getComputedStyle(e)).every(s=>s.visibility==="visible"&&s.display!=="none")'), 'packaged footer hints are always visible');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".shortcut-hints kbd"),e=>e.textContent).slice(0,2)'), ['⌘ K','⌘ N']);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("library-status")).display'), 'none', 'no reserved statistics row in the packaged sidebar');
  assert.equal(await evaluate('document.getElementById("library-status").textContent'), '');
  assert.equal(await evaluate('document.querySelector(".tab-select[data-tab-id=history]").textContent'), '会话历史');
  assert.equal(await evaluate('document.querySelector(".eyebrow, #history-title, #history-count, #history-layout-note, #history-explanation")'), null, 'packaged UI omits decorative and duplicate headings');
  assert.equal(await evaluate('document.querySelector(".tab-select[data-tab-id=history]").getAttribute("aria-label")'), '会话历史');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".chrome-heading")).borderBottomWidth'), '0px');
  assert.equal(await evaluate('document.querySelectorAll("#project-list .project-location, #project-list .status-label").length'), 0);
  assert(await evaluate('document.querySelector(".project-item").hasAttribute("aria-expanded")'), 'packaged folder is collapsible');
  assert.equal(await evaluate('typeof window.piGui.updateProject'), 'function');
  await evaluate('document.getElementById("new-tab").click()');
  let state;
  await until(async () => {
    const snapshot = await evaluate('window.piGui.snapshot()');
    state = snapshot.terminals.find(item => item.kind === 'pi');
    return state?.running && state.status === 'idle' && state.bridgeReady;
  }, 'packaged app launches a real Pi PTY');
  await until(() => evaluate('document.getElementById("running-count").textContent === "运行中 1"'), 'packaged independent Pi count updates');
  await until(() => evaluate('document.querySelectorAll(".sidebar-session").length >= 1'), 'packaged sidebar includes unsaved Pi');
  assert.equal(await evaluate('views.get('+JSON.stringify(state.id)+').rendererKind'),'webgl','fixed-cell renderer is bundled and active');
  assert.equal(await evaluate('document.getElementById("new-tab").textContent.trim()'),'','new entry is icon-only');
  const inputKey = async (key,code,modifiers=4) => {
    const windowsVirtualKeyCode = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
    await command('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
  };
  // Cmd+T opens the system Terminal; do not launch an external app during package tests.
  assert.equal(await evaluate('typeof window.piGui.openProject'), 'function');
  assert.equal(await evaluate('typeof window.piGui.checkAppUpdate'), 'function', 'packaged app exposes the update check');
  assert.equal(await evaluate('window.piGui.snapshot().then(s=>s.automaticAppUpdateCheck)'), false, 'test mode never makes startup network requests');
  assert.equal(await evaluate('document.getElementById("shell-panel")'), null, 'the package has no embedded Shell panel');
  assert.equal((await evaluate('window.piGui.snapshot()')).terminals.filter(item=>item.kind==='shell').length, 0);
  await evaluate('window.__reloadGuard=73;void 0');
  await inputKey('r','KeyR');
  await until(()=>evaluate('route==="recent" && recentFilter==="running" && document.querySelectorAll(".history-card").length===1'),'packaged Cmd+R opens running recent, not reload');
  assert.equal(await evaluate('window.__reloadGuard'),73);
  await evaluate('openSettings("shortcuts")');
  assert.equal(await evaluate('route'),'settings');
  assert.equal(await evaluate('document.getElementById("settings-dialog")'),null);
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),0);
  assert.equal(await evaluate('document.querySelectorAll(".shortcut-binding").length'),require('../build/shared/shortcuts.js').commands.length);
  const settingsScreenshot=await command('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'v070-packaged-settings.png'),Buffer.from(settingsScreenshot.data,'base64'));
  await evaluate('beginShortcutRecording("running-recent")');
  await inputKey('n','KeyN');
  assert((await evaluate('document.getElementById("shortcut-error").textContent')).includes('冲突'));
  assert.equal((await evaluate('window.piGui.snapshot()')).terminals.filter(item=>item.kind==='pi').length,1,'recording does not run commands');
  await inputKey('Escape','Escape',0);
  await evaluate('beginShortcutRecording("running-recent")');
  await inputKey('y','KeyY');
  await until(()=>evaluate('preferences.shortcuts["running-recent"]==="Command+Y"'),'packaged shortcut customization persists');
  await evaluate('selectProject("packaged-test",false)');
  await inputKey('r','KeyR'); assert.equal(await evaluate('route'),'project','old binding removed');
  await inputKey('y','KeyY');
  await until(()=>evaluate('route==="recent" && recentFilter==="running"'),'packaged custom binding');
  await evaluate('document.getElementById("navigate-back").click()');
  assert(await evaluate('route==="project" && workspace.activeId(selectedId)==='+JSON.stringify(state.id)),'packaged back returns to exact live Pi');
  await evaluate('document.getElementById("navigate-forward").click()');
  assert.equal(await evaluate('route'),'recent');
  await evaluate('openSettings("shortcuts")');
  await evaluate('saveShortcutOverrides({})');
  assert.equal(await evaluate('Object.keys(preferences.shortcuts).length'),0);
  await evaluate('window.piGui.setPreferences({sidebarCollapsed:true})');
  assert(await evaluate('Array.from(document.querySelectorAll(".window-navigation button"),el=>el.getBoundingClientRect()).every(r=>r.left>=100&&r.bottom<=48)'),'packaged chrome avoids native traffic lights when sidebar is hidden');
  const collapsedScreenshot=await command('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'v070-packaged-collapsed.png'),Buffer.from(collapsedScreenshot.data,'base64'));
  await evaluate('window.piGui.setPreferences({sidebarCollapsed:false})');
  await evaluate('selectProject("packaged-test",false)');
  await evaluate('window.piGui.setPreferences({completionSound:false,completionNotice:true})');
  await evaluate('window.__realHasFocus=document.hasFocus;document.hasFocus=()=>true;showRecent();window.piGui.reportStatus('+JSON.stringify(state.id)+','+JSON.stringify(state.runId)+',"working","");window.piGui.reportStatus('+JSON.stringify(state.id)+','+JSON.stringify(state.runId)+',"done","");void 0');
  await until(()=>evaluate('Boolean(document.getElementById("notice-open-session"))'),'packaged completion notification exposes a clickable action');
  await evaluate('document.getElementById("notice-open-session").click()');
  assert(await evaluate('route === "project" && workspace.activeId(selectedId) === '+JSON.stringify(state.id)), 'packaged notification jumps to its exact session');
  assert(await evaluate('document.getElementById("notice").hidden'), 'packaged notification dismisses on click');
  assert.equal((await evaluate('window.piGui.snapshot()')).terminals.filter(item=>item.kind==='pi').length,1,'click does not duplicate Pi');
  await evaluate('document.hasFocus=window.__realHasFocus;delete window.__realHasFocus;void 0');
  await evaluate('window.piGui.setPreferences({workspaceTheme:"light",sidebarTheme:"dark"})');
  await until(async () => (await evaluate('window.piGui.snapshot()')).terminals.find(item => item.id === state.id)?.appearance === 'light', 'packaged bridge accepts live theme commands');
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(artifacts, 'packaged.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('window.piGui.input(' + JSON.stringify(state.id) + ', ' + JSON.stringify(state.runId) + ', "\\u0004")');
  await until(async () => {
    const snapshot = await evaluate('window.piGui.snapshot()');
    return snapshot.terminals.every(item => item.kind !== 'pi');
  }, 'Pi exits cleanly');
  assert(await evaluate('document.getElementById("history-panel").hidden === false'), 'packaged Ctrl+D returns to history');
  await evaluate('window.piGui.updateProject("packaged-test",{name:"打包版项目编辑验证"})');
  assert.equal(await evaluate('window.piGui.snapshot().then(s=>s.projects.find(p=>p.id==="packaged-test").name)'), '打包版项目编辑验证', 'project edit IPC persists in the package');
  assert.equal(await evaluate('document.getElementById("start")'), null, 'duplicate new entry is absent in package');
  assert(await evaluate('Boolean(document.getElementById("recent-sessions"))'),'global recent entry is packaged');
  assert.equal(await evaluate('document.getElementById("sidebar").dataset.theme'), 'dark');
  const historyFile = path.join(piData, 'sessions', '--project--', 'packaged-history.jsonl');
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  const stamp = new Date(Date.now() - 45 * 86400000).toISOString();
  const usage = { input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0} };
  const entries = [{type:'session',version:3,id:'packaged-history',cwd:fs.realpathSync(project),timestamp:stamp}];
  let parentId = null;
  for (let i=1;i<=2;i++) {
    const id='q'+i;
    entries.push({type:'message',id,parentId,timestamp:stamp,message:{role:'user',content:'PACKAGED_QUESTION_'+i,timestamp:Date.parse(stamp)}});
    entries.push({type:'message',id:'a'+i,parentId:id,timestamp:stamp,message:{role:'assistant',content:[{type:'text',text:Array.from({length:50},(_,n)=>'本地回答 '+i+' · '+n).join('\n\n')}],api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',usage,stopReason:'stop',timestamp:Date.parse(stamp)}});
    parentId='a'+i;
  }
  fs.writeFileSync(historyFile, entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  await evaluate('window.piGui.setPreferences({confirmResume:false})');
  await evaluate('window.piGui.refreshLibrary()');
  const info = await evaluate('window.piGui.snapshot().then(snapshot=>snapshot.history.find(info=>info.id==="packaged-history"))');
  state = await evaluate('window.piGui.createPi("packaged-test",{resume:true,sessionKey:'+JSON.stringify(info.key)+'})');
  await until(async () => (await evaluate('window.piGui.snapshot()')).terminals.some(item=>item.id===state.id&&item.bridgeReady), 'packaged restored history ready');
  const directoryScreenshot = await command('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'v04-packaged-directory.png'),Buffer.from(directoryScreenshot.data,'base64'));
  await evaluate('window.piGui.input('+JSON.stringify(state.id)+','+JSON.stringify(state.runId)+',"\\u0004")');
  await until(async ()=>(await evaluate('window.piGui.snapshot()')).terminals.every(item=>item.kind!=='pi'),'packaged restored Pi exits');
  // Exercise the new filters inside the actual .app, using only temporary session files.
  fs.writeFileSync(historyFile, entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  function savedFixture(id, title, daysAgo, usage) {
    const timestamp = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const file = path.join(path.dirname(historyFile), id + '.jsonl');
    const items = [
      {type:'session',version:3,id,cwd:fs.realpathSync(project),timestamp},
      {type:'message',id:'q',parentId:null,timestamp,message:{role:'user',content:title,timestamp:Date.parse(timestamp)}},
      {type:'message',id:'a',parentId:'q',timestamp,message:{role:'assistant',content:[{type:'text',text:'Local fixture only; no model request.'}],api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',usage,stopReason:'stop',timestamp:Date.parse(timestamp)}}
    ];
    fs.writeFileSync(file,items.map(item=>JSON.stringify(item)).join('\n')+'\n');
    return file;
  }
  const fixtureFiles = [historyFile,
    savedFixture('recent','PACKAGED_RECENT',2,{input:100,output:50,cacheRead:50,cacheWrite:10,totalTokens:720,cost:{total:0.03}}),
    savedFixture('fortnight','PACKAGED_FORTNIGHT',14,{input:100,output:50,cacheRead:500,cacheWrite:10,totalTokens:1080,cost:{total:0.02}}),
    savedFixture('ancient','PACKAGED_ANCIENT',120,{input:100,output:50,cacheRead:200,cacheWrite:10,totalTokens:360,cost:{total:0.0018}})
  ];
  const fixtureBytes = fixtureFiles.map(file=>fs.readFileSync(file));
  await evaluate('window.piGui.refreshLibrary()');
  await evaluate('showRecent();setStatsVisible(true)');
  const choose = (id,value) => evaluate('(() => { const el=document.getElementById('+JSON.stringify(id)+');setInputValue(el,'+JSON.stringify(value)+'); })()');
  const values = () => evaluate('Array.from(document.querySelectorAll(".monitor-card-value"),el=>el.textContent)');
  const count = () => evaluate('document.querySelectorAll(".history-card").length');
  await until(async ()=>(await values())[0]==='2','packaged monitor defaults to recent month');
  assert.equal(await evaluate('document.getElementById("monitor-count")'),null);
  assert.equal((await values())[1],'1.8k');
  assert.equal((await values())[3],'$0.05');
  assert.equal(await evaluate('document.querySelector(\'label[for="monitor-sort"]\').firstChild.textContent'),'排序');
  assert.equal(await evaluate('document.getElementById("monitor-explanation")'),null);
  assert.match(await evaluate('document.getElementById("monitor-summary").title'), /非时间段内增量/);
  const monitorScreenshot = await command('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'v062-packaged-monitor-month.png'),Buffer.from(monitorScreenshot.data,'base64'));
  for (const [range,expected] of [['week','1'],['quarter','3'],['all','4']]) {
    await choose('monitor-time-range',range);
    assert.equal((await values())[0],expected,'packaged range: '+range);
  }
  for (const [sort,title] of [['totalTokens','PACKAGED_FORTNIGHT'],['cost','PACKAGED_RECENT'],['cache','PACKAGED_FORTNIGHT'],['activity','PACKAGED_RECENT']]) {
    await choose('monitor-sort',sort);
    assert.equal(await evaluate('document.querySelector(".monitor-session-title").textContent'),title,'packaged sorting: '+sort);
  }
  await evaluate('document.getElementById("recent-sessions").click();setStatsVisible(false)');
  assert.equal(await evaluate('document.getElementById("recent-time-range")'),null);
  assert.equal(await evaluate('document.getElementById("history-title")'),null);
  assert.equal(await count(),4,'all sessions has no activity-time cutoff');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#recent-filter [role=tab]"),el=>el.textContent)'),['全部','运行中','收藏']);
  await evaluate('document.getElementById("session-tab-favorites").click()');
  assert.equal(await count(),0,'favorites is an independent tab');
  await evaluate('document.getElementById("session-tab-all").click()');
  const recentScreenshot = await command('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(artifacts,'v062-packaged-recent-month.png'),Buffer.from(recentScreenshot.data,'base64'));
  await evaluate('setStatsVisible(true)');
  await choose('monitor-time-range','month');
  assert.equal(await evaluate('document.getElementById("monitor-time-range").value'),'month');
  await evaluate('setInputValue("search","FORTNIGHT");');
  assert.equal((await values())[0],'1');
  await choose('monitor-time-range','week');
  assert.equal((await values())[0],'0');
  assert.equal(await evaluate('document.getElementById("monitor-empty").hidden'),false);
  await choose('monitor-time-range','month');
  await evaluate('setInputValue("search","");document.querySelector(\'#monitor-filter [data-filter="running"]\').click()');
  assert.equal((await values())[0],'0');
  await evaluate('document.querySelector(\'#monitor-filter [data-filter="all"]\').click();setStatsVisible(false);selectProject("packaged-test",true)');
  assert.equal(await evaluate('document.getElementById("recent-filter").hidden'),true);
  assert.equal(await count(),4,'packaged project history is not time-filtered');
  fixtureFiles.forEach((file,index)=>assert(fs.readFileSync(file).equals(fixtureBytes[index]),'packaged filters do not modify session files'));
  console.log('PASS v' + require('../package.json').version + ': embedded settings, customizable shortcuts, Cmd+R, traffic-light safe area, exact back/forward navigation; external-terminal IPC without an embedded Shell panel; verified local code signature; packaged all/running/favorites session tabs without time limits, independent monitor month-default time filters, all ranges, scoped summaries, search/running combinations, sorting and unfiltered project history; clickable completion prompts navigate to the exact existing session; packaged collapsible session sidebar without state/path text, badge-free navigation, independent x running footer text, always-visible swapped shortcut hints; fixed-cell renderer and icon-only new entry work; real Pi restores, changes themes, exits to history, and renders tool events without file changes.');
})().catch(error => {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
}).finally(async () => {
  socket?.close();
  if (child?.pid && child.exitCode === null) {
    await terminateTree({ pid: child.pid, kill: signal => child.kill(signal) });
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
