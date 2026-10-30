const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-console-i18n-'));
const agent = path.join(root, 'agent');
const data = path.join(root, 'data');
const project = path.join(root, 'acme-web');
fs.mkdirSync(path.join(agent, 'sessions'), { recursive: true });
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(project, { recursive: true });
const canonicalProject = fs.realpathSync(project);
const now = Date.now();
const sessions = [['Fix login callback timeout', 'Web login intermittently returns 502. Find the timeout and suggest a minimal fix.', 1],
  ['Add search cache', 'Search QPS is high. Evaluate a 30 second cache and invalidation.', 2],
  ['Draft release checklist', 'Turn the pre-release regression, canary and rollback steps into a checklist.', 4]];
for (const [name, prompt, daysAgo] of sessions) {
  const id = 'web-' + Buffer.from(name).toString('hex').slice(0, 10);
  const at = new Date(now - daysAgo * 86_400_000).toISOString();
  const stamp = Date.parse(at);
  const entries = [{ type: 'session', id, cwd: canonicalProject, timestamp: at, version: 1 },
    { type: 'session_info', name, timestamp: at },
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: prompt, timestamp: stamp } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: { role: 'assistant', model: 'claude-sonnet-4-6', provider: 'anthropic',
      content: [{ type: 'text', text: 'Located the retry and pool contention. Here is the fix and verification plan.' }],
      usage: { input: 1800, output: 640, cacheRead: 12000, cacheWrite: 320, reasoning: 120, totalTokens: 15080,
        cost: { input: 0.0054, output: 0.0096, cacheRead: 0.0036, cacheWrite: 0.0008, total: 0.0194 } },
      stopReason: 'stop', durationMs: 8200, timestamp: stamp + 8200 } }];
  fs.writeFileSync(path.join(agent, 'sessions', id + '.jsonl'), entries.map(item => JSON.stringify(item)).join('\n') + '\n');
}
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify({ version: 1, selectedId: 'web',
  projects: [{ id: 'web', name: 'acme-web', path: canonicalProject }],
  preferences: { onboardingSeen: true, language: 'en-US', sidebarTheme: 'dark', workspaceTheme: 'dark', historyLayout: 'cards', cardColumns: 3,
    confirmResume: false, completionNotice: false, completionSound: false } }));
Object.assign(process.env, { PI_GUI_TEST_MODE: '1', PI_GUI_DATA_DIR: data, PI_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_SESSION_DIR: path.join(agent, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(100); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  const controller = await require('../build/main/app.cjs').startApp({ spawnPty: () => { throw new Error('no pty in i18n smoke'); } });
  const js = source => controller.window.webContents.executeJavaScript(source, true);
  await until(() => js('Boolean(window.__consoleTest && window.piGuiReady)'), 'renderer');
  await until(() => js('!__consoleTest.library.loading'), 'library');
  controller.window.setContentSize(1440, 960);
  // Keep native input and screenshots deterministic without stealing the user's keyboard focus.
  controller.window.webContents.debugger.attach('1.3');
  await controller.window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await delay(400);
  const chinese = async label => {
    const text = await js(`(() => {
      const parts = [document.body.innerText];
      for (const node of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
        for (const name of ['placeholder', 'title', 'aria-label', 'alt']) { const value = node.getAttribute(name); if (value) parts.push(value); }
      }
      return parts.join(String.fromCharCode(10));
    })()`);
    const found = [...new Set((text.match(/[\u4e00-\u9fff][^\n]*/g) || []).map(value => value.trim()))];
    assert.deepEqual(found, [], label + ' 仍有中文：' + found.join(' | '));
    console.log('ok', label);
  };
  const menuLabels = [];
  const walkMenu = menu => { for (const item of menu.items) { if (item.label) menuLabels.push(item.label); if (item.submenu) walkMenu(item.submenu); } };
  const applicationMenu = Menu.getApplicationMenu();
  assert.ok(applicationMenu, 'application menu is missing');
  walkMenu(applicationMenu);
  assert.deepEqual([...new Set(menuLabels.filter(label => /[\u4e00-\u9fff]/.test(label)))], [], '原生菜单仍有中文：' + menuLabels.join(' | '));
  console.log('ok menu');
  await chinese('project');
  await js('__consoleTest.openOnboarding()');
  for (let step = 0; step < 4; step++) {
    await js('document.querySelector(\'[data-onboarding-step="' + step + '"]\').click()');
    await delay(80); await chinese('quick-start-' + step);
  }
  await js('document.getElementById("onboarding-next").click()'); await delay(100);
  await js('__consoleTest.showRecent()'); await delay(350); await chinese('sessions');
  await js('__consoleTest.savePreferences({historyLayout:"list"})'); await delay(350);
  const overlap = await js('(() => { const card=document.querySelector(".history-card"); const actions=card.querySelector(".card-actions")?.getBoundingClientRect(); if (!actions) return false; return [...card.querySelectorAll(".history-meta, .history-action")].some(node => { const rect=node.getBoundingClientRect(); return !(actions.right<=rect.left || actions.left>=rect.right || actions.bottom<=rect.top || actions.top>=rect.bottom); }); })()');
  assert.equal(overlap, false, 'list card actions do not overlap the footer');
  await js('__consoleTest.savePreferences({historyLayout:"cards"})'); await delay(250);
  const nativeKey = (type, keyCode, modifiers = []) => controller.window.webContents.sendInputEvent({ type, keyCode, modifiers });
  const pressKey = async (keyCode, modifiers = []) => {
    nativeKey('keyDown', keyCode, modifiers);
    if (keyCode === 'Return') nativeKey('char', '\r', modifiers);
    nativeKey('keyUp', keyCode, modifiers); await delay(80);
  };
  await until(() => js('document.hasFocus()'), 'keyboard test window focused');
  await js('document.activeElement?.blur()');
  nativeKey('keyDown', 'Meta'); await delay(200);
  assert.equal(await js('document.getElementById("sidebar").classList.contains("command-nav")'), false, 'Command hints stay hidden before the half-second hold');
  await until(() => js('document.getElementById("sidebar").classList.contains("command-nav")'), 'holding Command reveals the TUI navigation layer', 2500);
  assert(await js('document.querySelector(".command-nav-hud") !== null'), 'the global navigation HUD is visible');
  nativeKey('keyUp', 'Meta'); await delay(80);
  assert.equal(await js('document.getElementById("sidebar").classList.contains("command-nav")'), false, 'releasing Command hides navigation mode');
  nativeKey('keyDown', 'Alt'); await delay(1100);
  assert.equal(await js('__consoleTest.navHeld'), false, 'Option alone never shows NAV');
  nativeKey('keyUp', 'Alt');
  await js('__consoleTest.recordingShortcut = null; __consoleTest.publish()');
  await js('window.__oldOpen = __consoleTest.openHistoryItem; __consoleTest.openHistoryItem = info => { window.__navOpened = info.title; }; true');
  nativeKey('keyDown', 'Meta'); await delay(300);
  nativeKey('keyDown', 'Down', ['meta']); nativeKey('keyUp', 'Down', ['meta']); await delay(150);
  assert(await js('Boolean(__consoleTest.navTarget)'), 'moving with Command selects a sidebar target');
  assert.equal(await js('window.__navOpened || null'), null, 'unopened history is not started while navigating');
  nativeKey('keyUp', 'Meta'); await delay(250);
  assert.equal(await js('window.__navOpened || null'), null, 'releasing Command does not start unopened history');
  assert(await js('Boolean(document.querySelector(".nav-enter-prompt"))'), 'releasing Command shows the Enter prompt for unopened history');
  assert.equal(await js('document.getElementById("sidebar").classList.contains("command-nav")'), false, 'releasing Command after moving hides navigation mode');
  await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))'); await delay(200);
  assert(await js('Boolean(window.__navOpened)'), 'Enter opens exactly the selected session');
  assert.equal(await js('document.querySelector(".nav-enter-prompt")'), null, 'Enter dismisses the prompt');
  await js('__consoleTest.openHistoryItem = window.__oldOpen; delete window.__oldOpen; delete window.__navOpened');
  await js('__consoleTest.toggleSessionFavorite(__consoleTest.sessionHistory[0])'); await delay(300);
  assert(await js('document.querySelector(".session-favorite") !== null'), 'favorite star is rendered');
  await chinese('favorites');
  await js('__consoleTest.toggleSessionFavorite(__consoleTest.sessionHistory[0])'); await delay(250);
  await js('__consoleTest.showRecent(); __consoleTest.setStatsVisible(true)'); await delay(350); await chinese('statistics');
  await js('__consoleTest.openPalette()'); await delay(250); await chinese('palette');
  await js('__consoleTest.closePalette()');
  for (const section of ['appearance', 'sessions', 'shortcuts', 'updates', 'about']) {
    await js('__consoleTest.openSettings(' + JSON.stringify(section) + ')'); await delay(350); await chinese('settings:' + section);
  }
  await js('__consoleTest.projectEditTarget = "web"; __consoleTest.publish()'); await delay(300); await chinese('dialog:project');
  await js('__consoleTest.projectEditTarget = null; __consoleTest.publish(); __consoleTest.statsTarget = __consoleTest.sessionHistory[0]; __consoleTest.publish()');
  await delay(300); await chinese('dialog:stats');
  await js('__consoleTest.statsTarget = null; __consoleTest.renameTarget = { projectId: "web", key: __consoleTest.sessionHistory[0].key, title: "Audit rename" }; __consoleTest.publish()');
  await delay(300); await chinese('dialog:rename');
  const confirmationUI = () => js(`(() => {
    const dialog = document.getElementById('confirmation-dialog');
    if (!dialog) return null;
    const probe = document.createElement('span'); probe.hidden = true; dialog.append(probe);
    const tokens = Object.fromEntries(['surface', 'border', 'text', 'accent', 'danger'].map(name => {
      probe.style.color = 'var(--' + name + ')'; return [name, getComputedStyle(probe).color];
    }));
    probe.remove();
    return { open: dialog.open, theme: document.documentElement.dataset.theme, tokens,
      focusedResponse: document.activeElement?.getAttribute('data-confirm-response'),
      buttons: [...dialog.querySelectorAll('[data-confirm-response]')].map(button => {
        const style = getComputedStyle(button), rect = button.getBoundingClientRect();
        return { response: Number(button.dataset.confirmResponse), text: button.innerText.trim(), classes: [...button.classList],
          border: style.borderColor, borderStyle: style.borderStyle, borderWidth: style.borderWidth,
          color: style.color, background: style.backgroundColor,
          visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' &&
            rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          textFits: button.scrollWidth <= button.clientWidth };
      }) };
  })()`);
  const assertConfirmationUI = (ui, label, labels, dangerIds, accentIds = [], defaultId = 0) => {
    assert.ok(ui?.open, label + ': confirmation is open');
    assert.deepEqual(ui.buttons.map(button => button.text), labels, label + ': visible labels distinguish keeping Pi from ending it');
    assert.deepEqual(ui.buttons.map(button => button.response), labels.map((_, index) => index), label + ': response order is unchanged');
    assert.equal(ui.focusedResponse, String(defaultId), label + ': the configured default button keeps focus');
    assert.deepEqual(ui.buttons.filter(button => button.classes.includes('button-danger')).map(button => button.response), dangerIds,
      label + ': only the requested responses are destructive');
    assert.deepEqual(ui.buttons.filter(button => button.classes.includes('button-accent')).map(button => button.response), accentIds,
      label + ': remaining warning actions use the accent treatment');
    for (const button of ui.buttons) {
      const role = dangerIds.includes(button.response) ? 'danger' : accentIds.includes(button.response) ? 'accent' : 'secondary';
      const message = label + ': response ' + button.response;
      assert.ok(button.classes.includes('button-' + role), message + ' has the correct semantic class');
      assert.ok(button.visible && button.textFits, message + ' and its full label are visible');
      assert.equal(button.borderStyle, 'solid', message + ' has a visible border');
      assert.ok(parseFloat(button.borderWidth) > 0, message + ' has a nonzero border');
      assert.equal(button.border, ui.tokens[role === 'secondary' ? 'border' : role], message + ' uses the theme border token');
      assert.equal(button.color, ui.tokens[role === 'secondary' ? 'text' : role], message + ' uses the theme text token');
      assert.equal(button.background, ui.tokens.surface, message + ' keeps the neutral surface background');
    }
  };
  await js(`window.__confirmationBridge = __consoleTest.bridge; window.__confirmationAnswers = [];
    __consoleTest.bridge = { ...__consoleTest.bridge, answerConfirmation: async (id, result) => {
      window.__confirmationAnswers.push({ id, ...result }); __consoleTest.confirmation = null; __consoleTest.publish();
    } }; true;`);
  await js('__consoleTest.renameTarget = null; __consoleTest.confirmation = { id: "audit", type: "warning", message: "Close this session?", detail: "The process keeps running in the background.", buttons: ["Cancel", "Close"], cancelId: 0, defaultId: 1, checkboxLabel: "Do not ask again" }; __consoleTest.publish()');
  await delay(300); await chinese('dialog:confirmation');
  assertConfirmationUI(await confirmationUI(), 'legacy two-button warning', ['Cancel', 'Close'], [1], [], 1);
  await js('document.querySelector("#confirmation-dialog input").focus()');
  await pressKey('Left');
  assert.equal(await js('document.activeElement?.type'), 'checkbox', 'arrow navigation never steals focus from the checkbox');
  await js('__consoleTest.confirmation = null; __consoleTest.publish()');
  const artifacts = path.resolve(__dirname, '../artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const originalWorkspaceTheme = await js('__consoleTest.preferences.workspaceTheme');
  const quitLabels = ['Cancel', 'Keep Pi running and quit', 'End Pi and quit'];
  for (const theme of ['light', 'dark']) {
    await js('__consoleTest.savePreferences({workspaceTheme:' + JSON.stringify(theme) + '})');
    await until(() => js('document.documentElement.dataset.theme === ' + JSON.stringify(theme)), 'quit confirmation workspace theme: ' + theme);
    await js(`__consoleTest.confirmation = { id: ${JSON.stringify('audit-quit-' + theme)}, type: 'warning',
      message: '退出 Pi Console？', detail: 'Keep Pi running in the background, or end every Pi process and its children. Saved Pi history is kept.',
      buttons: ['取消', '保留 Pi 并退出', '结束 Pi 并退出'], cancelId: 0, defaultId: 1, destructiveId: 2 }; __consoleTest.publish()`);
    await delay(300); await chinese('dialog:quit:' + theme);
    const ui = await confirmationUI();
    assert.equal(ui.theme, theme, 'quit confirmation inherits the ' + theme + ' workspace theme');
    assertConfirmationUI(ui, theme + ' quit', quitLabels, [2], [1], 1);
    for (const [key, response] of [['Right', 2], ['Left', 1], ['Left', 0], ['Left', 2], ['Right', 0], ['Right', 1]]) {
      await pressKey(key);
      assert.equal((await confirmationUI()).focusedResponse, String(response), theme + ': ' + key + ' moves focus to ' + response);
    }
    await pressKey('Tab');
    assert.equal((await confirmationUI()).focusedResponse, '2', theme + ': native Tab navigation remains available');
    await pressKey('Tab', ['shift']);
    assert.equal((await confirmationUI()).focusedResponse, '1', theme + ': Shift+Tab returns to the middle action');
    assert.equal(new Set(ui.buttons.map(button => button.border)).size, 3, theme + ': cancel, keep and end borders are all different');
    assert.equal(new Set(ui.buttons.map(button => button.color)).size, 3, theme + ': cancel, keep and end text colors are all different');
    const rect = await js(`(() => {
      const bounds = document.getElementById('confirmation-dialog').getBoundingClientRect();
      const x = Math.max(0, Math.floor(bounds.left) - 8), y = Math.max(0, Math.floor(bounds.top) - 8);
      return { x, y, width: Math.min(innerWidth - x, Math.ceil(bounds.width) + 16), height: Math.min(innerHeight - y, Math.ceil(bounds.height) + 16) };
    })()`);
    const image = await controller.window.webContents.capturePage(rect);
    assert.equal(image.isEmpty(), false, theme + ': quit confirmation screenshot is not empty');
    const screenshot = path.join(artifacts, 'quit-confirmation-' + theme + '.png');
    if (fs.existsSync(screenshot)) fs.readFileSync(screenshot);
    fs.writeFileSync(screenshot, image.toPNG());
    console.log('ok screenshot', screenshot);
    await pressKey('Return');
    assert.equal(await confirmationUI(), null, theme + ': Enter answers and dismisses the dialog');
    assert.equal(await js('window.__confirmationAnswers.at(-1).response'), 1, theme + ': Enter uses the default keep-Pi action');
    // Moving the destructive choice to index 1 must move red styling with it, not leave the last button red.
    await js(`__consoleTest.confirmation = { type: 'warning', message: '退出 Pi Console？', cancelId: 0, id: ${JSON.stringify('audit-quit-reordered-' + theme)},
      buttons: ['取消', '结束 Pi 并退出', '保留 Pi 并退出'], defaultId: 2, destructiveId: 1 }; __consoleTest.publish()`);
    await delay(300); await chinese('dialog:quit:reordered:' + theme);
    assertConfirmationUI(await confirmationUI(), theme + ' reordered quit', [quitLabels[0], quitLabels[2], quitLabels[1]], [1], [2], 2);
    await pressKey('Left'); await pressKey('Return');
    assert.equal(await js('window.__confirmationAnswers.at(-1).response'), 1, theme + ': Enter activates the arrow-selected action, not the original default');
    await js(`__consoleTest.confirmation = { id: ${JSON.stringify('audit-quit-escape-' + theme)}, type: 'warning',
      message: '退出 Pi Console？', buttons: ['取消', '保留 Pi 并退出', '结束 Pi 并退出'], cancelId: 0, defaultId: 1, destructiveId: 2 }; __consoleTest.publish()`);
    await delay(150); await pressKey('Escape');
    assert.equal(await confirmationUI(), null, theme + ': Escape dismisses the dialog');
    assert.equal(await js('window.__confirmationAnswers.at(-1).response'), 0, theme + ': Escape still cancels regardless of default focus');
  }
  await js('__consoleTest.bridge = window.__confirmationBridge; delete window.__confirmationBridge; delete window.__confirmationAnswers');
  await js('__consoleTest.savePreferences({workspaceTheme:' + JSON.stringify(originalWorkspaceTheme) + '})');
  // Project slots are renderer-only: never add fake projects to the on-disk store.
  const backendPi = () => controller.snapshot().terminals.filter(state => state.kind === 'pi' && state.running).length;
  const originalBackendPi = backendPi(), storedProjectIds = controller.snapshot().projects.map(item => item.id);
  await js(`(() => {
    const app = __consoleTest;
    window.__projectOptionFixture = {
      state: Object.fromEntries(['projects', 'selectedId', 'route', 'search', 'searchCursor', 'navHeld', 'navPending', 'navTarget',
        'statsVisible', 'preferences', 'appearance', 'sidebarMode', 'bridge'].map(key => [key, app[key]])),
      expanded: [...app.expandedProjects]
    };
    app.bridge = { ...app.bridge, selectProject: async () => null };
    app.projects = Array.from({ length: 12 }, (_, index) => ({
      id: 'option-project-' + index, name: 'Option project ' + String(index + 1).padStart(2, '0'), path: '/renderer-only/option-project-' + index
    }));
    Object.assign(app, { selectedId: app.projects[0].id, route: 'project', search: '', searchCursor: 0,
      navHeld: false, navPending: false, navTarget: null, statsVisible: false });
    app.expandedProjects.clear(); document.activeElement?.blur(); app.publish();
  })()`);
  const projectBadges = () => js(`Array.from(document.querySelectorAll('.project-shortcut'), node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { digit: node.textContent.trim(), command: node.dataset.shortcut, project: node.closest('[data-project-id]')?.dataset.projectId,
      hidden: node.getAttribute('aria-hidden'), inIcon: Boolean(node.closest('.project-icon')),
      visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight && style.visibility === 'visible' && style.display !== 'none' };
  })`);
  try {
    await delay(150);
    assert.deepEqual(await projectBadges(), [], 'project badges are absent before holding Command');
    for (const theme of ['light', 'dark']) {
      await js('__consoleTest.applyPreferences({sidebarTheme:' + JSON.stringify(theme) + ',workspaceTheme:' + JSON.stringify(theme) + '},' + JSON.stringify(theme) + ',' + JSON.stringify(theme) + ')');
      nativeKey('keyDown', 'Meta'); await delay(60);
      assert.deepEqual(await projectBadges(), [], theme + ': a quick Command tap does not flash project digits');
      await until(() => js('__consoleTest.navHeld'), theme + ': holding Command reveals project slots', 2500);
      const badges = await projectBadges();
      assert.equal(badges.length, 10, theme + ': 12 projects expose only ten shortcuts');
      assert.deepEqual(badges.map(item => item.digit), [...'1234567890'], theme + ': visible slot digits are 1..9/0');
      assert.deepEqual(badges.map(item => item.command), [...'1234567890'].map(digit => 'project-' + digit));
      assert.deepEqual(badges.map(item => item.project), Array.from({ length: 10 }, (_, index) => 'option-project-' + index));
      assert(badges.every(item => item.hidden === 'true' && item.inIcon && item.visible), theme + ': badges occupy visible folder-icon positions and are decorative');
      await chinese('project shortcuts:' + theme);
      const image = await controller.window.webContents.capturePage();
      assert.equal(image.isEmpty(), false, theme + ': project shortcut screenshot is not empty');
      const screenshot = path.join(artifacts, 'project-option-shortcuts-' + theme + '.png');
      if (fs.existsSync(screenshot)) fs.readFileSync(screenshot);
      fs.writeFileSync(screenshot, image.toPNG()); console.log('ok screenshot', screenshot);
      nativeKey('keyUp', 'Meta');
      await until(async () => (await projectBadges()).length === 0, theme + ': release hides project shortcuts');
    }
    await js('__consoleTest.preferences = {...__consoleTest.preferences, shortcuts: {"project-1": null, "project-2": "Command+1"}}; __consoleTest.publish()');
    nativeKey('keyDown', 'Meta'); await until(() => js('__consoleTest.navHeld'), 'custom project shortcuts appear');
    const customBadges = await projectBadges();
    assert.equal(customBadges.length, 9, 'clearing a project binding removes its badge');
    assert.equal(customBadges[0].digit, '1');
    assert.equal(customBadges[0].project, 'option-project-1', 'reassigned digits appear on the actual bound project');
    nativeKey('keyDown', '1', ['meta']); nativeKey('keyUp', '1', ['meta']);
    await until(() => js('__consoleTest.selectedId === "option-project-1"'), 'native reassigned Command+1 follows its displayed badge');
    nativeKey('keyUp', 'Meta');
    await js('__consoleTest.preferences = {...__consoleTest.preferences, shortcuts: window.__projectOptionFixture.state.preferences.shortcuts}; __consoleTest.selectProjectSlot(0); __consoleTest.publish()');
    nativeKey('keyDown', 'Meta');
    for (const [index, digit] of [...'1234567890'].entries()) {
      nativeKey('keyDown', digit, ['meta']); nativeKey('keyUp', digit, ['meta']);
      await until(() => js('__consoleTest.selectedId === ' + JSON.stringify('option-project-' + index)), 'native Command+' + digit + ' selects its project');
      assert.equal(await js('__consoleTest.workspace.activeId(__consoleTest.selectedId)'), 'history', 'project shortcuts never create a Pi tab');
      assert.equal(await js('__consoleTest.navPending'), false, 'project shortcuts do not leave an Enter prompt');
    }
    assert.equal(backendPi(), originalBackendPi, 'native project shortcuts do not create backend Pi processes');
    assert.deepEqual(controller.snapshot().projects.map(item => item.id), storedProjectIds, 'fake projects never enter the project store');
    nativeKey('keyUp', 'Meta');
    await until(async () => (await projectBadges()).length === 0, 'release after project selection hides badges');
    nativeKey('keyDown', 'Meta'); await until(() => js('__consoleTest.navHeld'), 'Command held before blur', 2500);
    await js('window.dispatchEvent(new Event("blur"))');
    await until(async () => (await projectBadges()).length === 0, 'blur clears project badges');
    assert.equal(await js('__consoleTest.navHeld || __consoleTest.navPending'), false, 'blur cancels project navigation');
  } finally {
    nativeKey('keyUp', 'Meta');
    await js(`(() => {
      const app = __consoleTest, fixture = window.__projectOptionFixture;
      Object.assign(app, fixture.state); app.expandedProjects.clear();
      for (const id of fixture.expanded) app.expandedProjects.add(id);
      delete window.__projectOptionFixture; app.syncCurrent(); app.publish();
    })()`);
  }
  // Renderer-only live fixtures exercise native keys and xterm focus without starting a PTY.
  await js(`(() => {
    const app = __consoleTest;
    app.sessionHistory.slice(0, 2).forEach((info, index) => app.workspace.apply({
      id: 'nav-live-' + index, runId: 'nav-run-' + index, kind: 'pi', running: true, status: 'idle',
      projectId: info.projectId, sessionId: info.id, sessionKey: info.key, label: info.title, startedAt: 1
    }));
    app.activateTerminal('nav-live-0');
  })()`);
  await delay(150);
  nativeKey('keyDown', 'Meta');
  nativeKey('keyDown', 'Down', ['meta']); nativeKey('keyUp', 'Down', ['meta']);
  await until(() => js('__consoleTest.workspace.activeId("web") === "nav-live-1"'), 'Command Down immediately switches an open Pi once');
  assert.equal(await js('__consoleTest.navPending'), false, 'open Pi never waits for Enter');
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'quick Command Down switches without flashing the HUD');
  assert.equal(await js('__consoleTest.navHeld'), false, 'direction navigation cannot bypass the hold timer');
  nativeKey('keyUp', 'Meta'); await delay(1100);
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'releasing a quick switch cancels its delayed hint');
  assert.equal(await js('document.querySelector(".nav-enter-prompt")'), null, 'open Pi has no Enter prompt after release');
  nativeKey('keyDown', 'Meta');
  nativeKey('keyDown', 'Up', ['meta']); nativeKey('keyUp', 'Up', ['meta']);
  await until(() => js('__consoleTest.workspace.activeId("web") === "nav-live-0"'), 'Command Up returns to the prior open Pi once');
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'each new Command hold starts with hidden hints');
  nativeKey('keyDown', 'Right', ['meta']); nativeKey('keyUp', 'Right', ['meta']);
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'quick Command Right does not reveal hints');
  nativeKey('keyDown', 'Left', ['meta']); nativeKey('keyUp', 'Left', ['meta']);
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'quick Command Left does not reveal hints');
  await until(() => js('__consoleTest.navHeld'), 'holding Command through navigation reveals hints after half a second', 2500);
  nativeKey('keyUp', 'Meta'); await delay(100);
  assert.equal(await js('document.querySelector(".command-nav-hud")'), null, 'release hides long-hold hints');
  await chinese('live navigation');
  // Real xterm mouse input verifies OSC 8 ownership without opening a browser or starting Pi.
  await js(`(() => {
    const app = __consoleTest;
    window.__linkFixture = { bridge: app.bridge, terminalBridge: app.terminals.bridge, opened: [], revealed: [], input: [] };
    app.terminals.bridge = app.bridge = { ...app.bridge,
      openExternal: async uri => { window.__linkFixture.opened.push(uri); },
      revealTerminalPath: async (id, runId, uri) => { window.__linkFixture.revealed.push({id, runId, uri}); },
      input: (_id, _runId, data) => { window.__linkFixture.input.push(data); }
    };
  })()`);
  const uri = 'https://example.com/source';
  const terminalMouse = (type, point = { x: 0, y: 0 }, modifiers = []) => js(`
    __consoleTest.views.get('link-fixture').term.element.querySelector('.xterm-screen').dispatchEvent(
      new MouseEvent(${JSON.stringify(type)}, { bubbles: true, clientX: ${point.x}, clientY: ${point.y},
        button: 0, buttons: ${type === 'mousedown' ? 1 : 0}, altKey: ${modifiers.includes('alt')} }));`);
  for (const [label, mouse, plain, modifiers, expectedLocal, expectedMouse, target = uri, expectedReveal = 0] of [
    ['normal OSC 8', false, false, [], 1, 0],
    ['fullscreen Pi OSC 8', true, false, [], 0, 2],
    ['forced local selection OSC 8', true, false, ['alt'], 1, 0],
    ['fullscreen plain URL', true, true, [], 1, 2],
    ['fullscreen relative file OSC 8', true, false, [], 0, 0, 'dist-local/archive%20name.zip', 1],
    ['normal file OSC 8', false, false, [], 0, 0, 'file:///tmp/example.zip', 1],
    ['fullscreen file URL OSC 8', true, false, [], 0, 0, 'file:///tmp/example.zip', 1]
  ]) {
    await js(`__consoleTest.workspace.apply({ id: 'link-fixture', runId: ${JSON.stringify(label)}, kind: 'pi', running: true, status: 'idle',
      projectId: 'web', sessionId: 'link-session', label: 'Link fixture', startedAt: 1 }); __consoleTest.activateTerminal('link-fixture');`);
    await until(() => js('__consoleTest.views.get("link-fixture")?.state.runId === ' + JSON.stringify(label)), label + ': fresh terminal mounted');
    const output = '\x1b[?1003l\x1b[?1006l\x1b[2J\x1b[H' + (mouse ? '\x1b[?1003h\x1b[?1006h' : '') +
      (plain ? target : '\x1b]8;;' + target + '\x1b\\Source link\x1b]8;;\x1b\\');
    await js('new Promise(resolve => __consoleTest.views.get("link-fixture").term.write(' + JSON.stringify(output) + ', resolve))');
    await delay(100);
    const point = await js(`(() => {
      const view = __consoleTest.views.get('link-fixture'), rect = view.term.element.querySelector('.xterm-screen').getBoundingClientRect();
      window.__linkFixture.opened = []; window.__linkFixture.revealed = []; window.__linkFixture.input = [];
      return { x: Math.round(rect.left + 3 * rect.width / view.term.cols), y: Math.round(rect.top + .5 * rect.height / view.term.rows) };
    })()`);
    await terminalMouse('mousemove', { x: point.x + 240, y: point.y }, modifiers);
    await terminalMouse('mousemove', point, modifiers); await delay(100);
    assert(await js('__consoleTest.views.get("link-fixture").term.element.querySelector(".xterm-screen").classList.contains("xterm-cursor-pointer")'),
      label + ': a real terminal link is hovered before clicking');
    await terminalMouse('mousedown', point, modifiers);
    await terminalMouse('mouseup', point, modifiers); await delay(150);
    assert.equal(await js('window.__linkFixture.opened.length'), expectedLocal, label + ': only the intended local opener runs');
    assert.equal(await js('window.__linkFixture.input.filter(data => data.startsWith("\\x1b[<0;")).length'), expectedMouse,
      label + ': Pi receives exactly one press/release pair, or none for local selection');
    if (expectedLocal) assert.equal(await js('window.__linkFixture.opened[0]'), target, label + ': link target is preserved');
    assert.equal(await js('window.__linkFixture.revealed.length'), expectedReveal, label + ': local path has exactly one owner');
    if (expectedReveal) assert.deepEqual(await js('window.__linkFixture.revealed[0]'), {id:'link-fixture',runId:label,uri:target});
    console.log('ok link', label);
  }
  for (const [label, setup, expectedMouse] of [
    ['wheel without mouse mode', '\x1b[?1003l\x1b[?1006l', false],
    ['wheel with fullscreen mouse mode', '\x1b[?1003h\x1b[?1006h', true]
  ]) {
    await js('new Promise(resolve => __consoleTest.views.get("link-fixture").term.write(' + JSON.stringify(setup) + ', resolve))');
    const result = await js(`(() => {
      const view = __consoleTest.views.get('link-fixture'), screen = view.term.element.querySelector('.xterm-screen');
      const rect = screen.getBoundingClientRect(); window.__linkFixture.input = [];
      const event = new WheelEvent('wheel', {bubbles:true,cancelable:true,deltaY:120,
        clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2});
      screen.dispatchEvent(event); return {prevented:event.defaultPrevented};
    })()`);
    await delay(100);
    const data = await js('window.__linkFixture.input');
    if (expectedMouse) assert(data.some(value => value.startsWith('\x1b[<65;')), label + ': Pi receives a wheel report');
    else { assert.equal(result.prevented, true); assert.deepEqual(data, [], label + ': no Up/Down history keys'); }
    console.log('ok', label);
  }
  await js(`(() => {
    const app = __consoleTest;
    app.workspace.apply({ ...app.workspace.terminals.get('link-fixture'), running: false });
    app.bridge = window.__linkFixture.bridge; app.terminals.bridge = window.__linkFixture.terminalBridge;
    delete window.__linkFixture; app.syncCurrent(); app.publish();
  })()`);
  await controller.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('i18n smoke passed');
})().catch(async error => {
  console.error(error);
  try { await app.quit(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
