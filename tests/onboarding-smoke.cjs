const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, Menu } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-onboarding-'));
const data = path.join(root, 'data'), agent = path.join(root, 'agent'), project = path.join(root, 'project');
const artifacts = path.resolve(__dirname, '../artifacts');
for (const directory of [data, agent, project, artifacts]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify({ version: 1, selectedId: 'p',
  projects: [{ id: 'p', name: 'Project', path: fs.realpathSync(project) }],
  preferences: { sidebarTheme: 'dark', workspaceTheme: 'dark' } }));
Object.assign(process.env, { PI_GUI_TEST_MODE: '1', PI_GUI_DATA_DIR: data, PI_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_SESSION_DIR: path.join(agent, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(40); }
  throw new Error('Timeout: ' + label);
}
(async () => {
  let spawned = 0;
  const errors = [];
  const controller = await require('../build/main/app.cjs').startApp({
    spawnPty: () => { spawned++; throw new Error('Guide must not start Pi'); },
    readVersion: async () => 'test-version'
  });
  const contents = controller.window.webContents;
  contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const js = source => contents.executeJavaScript(source, true);
  const ready = () => until(() => js('Boolean(window.piGuiReady && window.__consoleTest && !__consoleTest.library.loading)'), 'ready');
  const guideOpen = () => js('document.getElementById("onboarding-dialog").open');
  const step = () => js('Number(document.querySelector("[data-onboarding-step][aria-current]").dataset.onboardingStep)');
  const click = selector => js('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const assertHeadingFocus = async () => {
    assert.equal(await js('document.activeElement.id'), 'onboarding-step-title', 'step heading remains the screen-reader focus target');
    assert.equal(await js('getComputedStyle(document.getElementById("onboarding-step-title")).outlineStyle'), 'none', 'non-interactive titles have no selection-like focus box');
    assert.equal(await js('window.getSelection().toString()'), '', 'opening or changing steps does not select text');
  };
  const key = async (keyCode, modifiers = []) => {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(70);
  };
  const menuShortcut = async accelerator => {
    const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.accelerator === accelerator);
    assert(item, 'native menu has ' + accelerator); item.click(); await delay(80);
  };
  const reload = async () => {
    await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload(); });
    await ready();
  };
  const screenshot = async name => {
    await delay(80);
    fs.writeFileSync(path.join(artifacts, name + '.png'), (await contents.capturePage()).toPNG());
  };
  await ready();
  contents.debugger.attach('1.3');
  await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  assert.equal(await guideOpen(), true, 'existing profiles without a seen flag also get the guide');
  assert.equal(await step(), 0);
  await assertHeadingFocus();
  await key('Tab');
  assert.equal(await js('document.activeElement.tagName'), 'BUTTON');
  assert.equal(await js('document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle === "solid"'), true, 'keyboard users retain visible button focus');
  await screenshot('onboarding-dark-zh');
  await key('N', ['meta']);
  await key(',', ['meta']);
  await menuShortcut('Command+N'); await menuShortcut('Command+,');
  await js('__consoleTest.shortcut("new-temporary-tab"); __consoleTest.shortcut("end-all")');
  assert.equal(spawned, 0, 'guide cannot start sessions through native or renderer shortcuts');
  assert.equal(await js('__consoleTest.route'), 'project', 'settings accelerator does not change the page beneath the guide');
  await key('Right'); assert.equal(await step(), 1); await assertHeadingFocus();
  assert.equal(await js('document.querySelectorAll("[data-onboarding-shortcut^=project-]").length'), 10);
  await key('Right'); assert.equal(await step(), 2);
  await key('Left'); assert.equal(await step(), 1);
  await click('#onboarding-previous'); assert.equal(await step(), 0);
  for (let i = 0; i < 12; i++) {
    await key('Tab');
    assert.equal(await js('Boolean(document.activeElement.closest("#onboarding-dialog"))'), true, 'focus stays in the guide');
  }
  await key('Escape');
  await until(async () => !await guideOpen() && controller.projects.preferences().onboardingSeen, 'skip saved');
  await reload(); assert.equal(await guideOpen(), false, 'skip persists across renderer restarts');

  await js('__consoleTest.openSettings()');
  await click('#open-onboarding');
  assert.equal(await guideOpen(), true);
  assert.equal(await step(), 0, 'manual reopen starts at step one');
  await js('__consoleTest.savePreferences({shortcuts:{"new-tab":"Command+Y","next-attention":null}})');
  assert.equal(await js('document.querySelector("[data-onboarding-shortcut=new-tab]").textContent'), '⌘ Y');
  await click('[data-onboarding-step="2"]');
  assert.equal(await js('document.querySelector("[data-onboarding-shortcut=next-attention]").textContent'), '未设置');
  await menuShortcut('Command+W');
  await until(async () => !await guideOpen(), 'Command-W closes only the guide');
  assert.equal(await js('__consoleTest.route'), 'settings');
  assert.equal(spawned, 0);
  await js('__consoleTest.savePreferences({shortcuts:{},language:"en-US",workspaceTheme:"light",sidebarTheme:"light"})');
  controller.window.setContentSize(940, 620);
  await click('#open-onboarding');
  for (let page = 0; page < 4; page++) {
    await click('[data-onboarding-step="' + page + '"]');
    await assertHeadingFocus();
    assert.equal(await js('/[\u4e00-\u9fff]/.test(document.getElementById("onboarding-dialog").innerText)'), false, 'all guide pages are translated');
    const layout = await js('(() => { const dialog=document.getElementById("onboarding-dialog"), footer=document.querySelector(".onboarding-footer"), page=document.querySelector(".onboarding-page"); const d=dialog.getBoundingClientRect(), f=footer.getBoundingClientRect(); return {fits:d.top>=0 && d.bottom<=innerHeight,footer:f.top>=d.top && f.bottom<=d.bottom,overflow:page.scrollWidth>page.clientWidth}; })()');
    assert.equal(layout.fits, true); assert.equal(layout.footer, true); assert.equal(layout.overflow, false);
    if (page === 1) await screenshot('onboarding-light-en-navigation');
  }
  await click('[data-onboarding-step="1"]');
  await js('document.querySelector(".onboarding-page").scrollTop = 1000');
  assert(await js('document.querySelector(".onboarding-page").scrollTop > 0'), 'small windows can scroll the full guide content');
  await click('#onboarding-next');
  assert.equal(await js('document.querySelector(".onboarding-page").scrollTop'), 0, 'new pages start at the top');
  await click('[data-onboarding-step="3"]');
  await click('#onboarding-next');
  await until(async () => !await guideOpen(), 'complete closes guide');

  // Exercise completion, not just skip, as the first-run dismissal path.
  controller.projects.setPreferences({ onboardingSeen: false });
  await reload(); assert.equal(await guideOpen(), true);
  await click('[data-onboarding-step="3"]');
  await click('#onboarding-next');
  await until(() => controller.projects.preferences().onboardingSeen, 'completion saved');
  await reload(); assert.equal(await guideOpen(), false, 'completion persists across renderer restarts');
  assert.equal(spawned, 0);
  assert.deepEqual(errors, []);
  console.log('ok onboarding: first run, skip, complete, reopen, configured shortcuts, keyboard, focus, themes and locales');
  fs.rmSync(root, { recursive: true, force: true });
  app.exit(0);
})().catch(error => { console.error(error); fs.rmSync(root, { recursive: true, force: true }); app.exit(1); });
