const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

// Bundle source in memory: these regressions never build artifacts or start a PTY.
async function load(entry, mockPath, mockSource, globals = {}) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src/renderer', entry)],
    platform: 'node', bundle: true, format: 'cjs', write: false,
    plugins: [{ name: 'navigation-test-host', setup(build) {
      build.onResolve({ filter: mockPath }, () => ({ path: 'mock', namespace: 'navigation-test-host' }));
      build.onLoad({ filter: /.*/, namespace: 'navigation-test-host' }, () => ({ contents: mockSource, loader: 'js' }));
    } }]
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, structuredClone, setTimeout, clearTimeout,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], hasFocus: () => true }, ...globals
  });
  return module.exports;
}
const mockRegistry = `export class TerminalRegistry {
  views = new Map(); focused = [];
  requestLayout() {} dispose() {} focus(id) { this.focused.push(id); }
}`;
let controllerModule;
const loadController = () => controllerModule ||= load('state/workspace-controller.ts', /terminal-registry\.js$/, mockRegistry);
const terminal = (id, projectId, extra = {}) => ({
  id, runId: 'run-' + id, sessionId: 'session-' + id, sessionKey: 'key-' + id,
  projectId, kind: 'pi', running: true, status: 'idle', startedAt: 1, ...extra
});
const history = (state, modifiedAt) => ({
  key: state.sessionKey, id: state.sessionId, projectId: state.projectId,
  title: state.sessionId, firstMessage: '', modifiedAt
});
async function workspace(t, options = {}) {
  const { WorkspaceController } = await loadController();
  const creates = [], selections = [];
  const app = new WorkspaceController({
    createPi: async (...args) => { creates.push(args); return null; },
    selectProject: async id => { selections.push(id); },
    refreshLibrary: async () => {}
  });
  t.after(() => app.dispose());
  const a = terminal('a', 'alpha'), b = terminal('b', 'beta');
  app.projects = [{ id: 'alpha', name: 'Alpha', path: '/alpha' }, { id: 'beta', name: 'Beta', path: '/beta' }];
  app.selectedId = 'alpha';
  app.expandedProjects.add('alpha'); app.expandedProjects.add('beta');
  for (const state of options.states || [a, b]) app.workspace.apply(state);
  app.workspace.selectTab('alpha', 'a');
  app.sessionHistory = options.history || [history(a, 30), {
    key: 'closed-key', id: 'closed-session', projectId: 'alpha', title: 'Closed', firstMessage: '', modifiedAt: 20
  }, history(b, 10)];
  return { app, creates, selections, a, b };
}

test('项目槽位 selector 与侧栏一致：置顶稳定排序，名称、路径及会话搜索共同筛选', async t => {
  const { app } = await workspace(t);
  const { filteredProjects } = await load('state/selectors.ts', /terminal-registry\.js$/, mockRegistry);
  app.projects.push({ id: 'gamma', name: 'Gamma', path: '/gamma', pinned: true },
    { id: 'delta', name: 'Delta', path: '/needle/path' });
  app.projects[1].pinned = true;
  app.sessionHistory.push({ key: 'gamma-key', id: 'gamma-session', projectId: 'gamma', title: 'Needle history', firstMessage: '', modifiedAt: 50 });
  app.sessionHistory[0].firstMessage = 'Needle prompt';
  const ids = () => Array.from(filteredProjects(app), project => project.id);
  assert.deepEqual(ids(), ['beta', 'gamma', 'alpha', 'delta']);
  app.search = '  NEEDLE  ';
  assert.deepEqual(ids(), ['gamma', 'alpha', 'delta']);
  app.search = 'BETA'; assert.deepEqual(ids(), ['beta']);
  app.search = '/needle/path'; assert.deepEqual(ids(), ['delta']);
  app.search = 'gamma-session'; assert.deepEqual(ids(), ['gamma']);
  app.search = 'no matching project or session'; assert.deepEqual(ids(), []);
});

test('项目槽 0/9 按可见顺序切换，保留已有 activeTab 和 navHeld，清待确认且不创建 Pi', async t => {
  const { app, creates, selections } = await workspace(t);
  app.projects[1].pinned = true;
  app.projects.push(...Array.from({ length: 10 }, (_, index) => ({ id: 'project-' + index, name: 'Project ' + index, path: '/project-' + index })));
  app.workspace.apply(terminal('beta-sibling', 'beta'));
  app.workspace.selectTab('beta', 'b');
  app.expandedProjects.delete('beta'); app.route = 'recent'; app.statsVisible = true;
  app.navTarget = app.sessionHistory[1]; app.navPending = true; app.navHeld = true;
  app.selectProjectSlot(0);
  assert.equal(app.selectedId, 'beta'); assert.equal(app.route, 'project'); assert.equal(app.statsVisible, false);
  assert.equal(app.expandedProjects.has('beta'), true); assert.equal(app.workspace.activeId('beta'), 'b');
  assert.equal(app.terminals.focused.at(-1), 'b');
  assert.equal(app.navTarget, null); assert.equal(app.navPending, false); assert.equal(app.navHeld, true);
  app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, false);
  app.selectProjectSlot(9);
  assert.equal(app.selectedId, 'project-7'); assert.equal(app.expandedProjects.has('project-7'), true);
  assert.equal(app.workspace.activeId('project-7'), 'history'); assert.equal(app.navHeld, false);
  await Promise.resolve();
  assert.deepEqual(selections, ['beta', 'project-7']); assert.equal(creates.length, 0);
});

test('项目数字槽按当前搜索重编号且不清搜索，历史 activeTab 不被已有 Pi 抢占', async t => {
  const { app, creates } = await workspace(t);
  app.projects[1].pinned = true;
  app.sessionHistory[0].title = 'Shared Alpha'; app.sessionHistory[2].title = 'Shared Beta';
  app.search = '  SHARED  '; app.searchCursor = 2; app.workspace.showHistory('beta');
  app.navTarget = app.sessionHistory[1]; app.navPending = true;
  app.selectProjectSlot(0);
  assert.equal(app.selectedId, 'beta'); assert.equal(app.workspace.activeId('beta'), 'history');
  assert.equal(app.search, '  SHARED  '); assert.equal(app.searchCursor, 2);
  assert.equal(app.navTarget, null); assert.equal(app.navPending, false); assert.equal(app.navHeld, false);
  app.search = 'Shared Alpha'; app.selectProjectSlot(0);
  assert.equal(app.selectedId, 'alpha'); assert.equal(app.workspace.activeId('alpha'), 'a');
  assert.equal(app.search, 'Shared Alpha'); assert.equal(creates.length, 0);
});

test('无效项目槽、无搜索结果、弹窗及录制均完全 no-op，不清已有导航目标或启动进程', async t => {
  const { app, creates, selections } = await workspace(t);
  app.projects.push(...Array.from({ length: 10 }, (_, index) => ({ id: 'extra-' + index, name: 'Extra ' + index, path: '/extra-' + index })));
  app.navTarget = app.sessionHistory[1]; app.navPending = true; app.navHeld = true;
  const target = app.navTarget, expanded = [...app.expandedProjects];
  const unchanged = () => {
    assert.equal(app.selectedId, 'alpha'); assert.equal(app.workspace.activeId('alpha'), 'a');
    assert.equal(app.navTarget, target); assert.equal(app.navPending, true); assert.equal(app.navHeld, true);
    assert.deepEqual([...app.expandedProjects], expanded); assert.equal(app.terminals.focused.length, 0);
    assert.equal(selections.length, 0); assert.equal(creates.length, 0);
  };
  for (const index of [-1, 10, 99, 0.5, NaN, Infinity]) { app.selectProjectSlot(index); unchanged(); }
  app.search = 'no results'; app.selectProjectSlot(0); unchanged();
  assert.equal(app.search, 'no results'); app.search = '';
  app.confirmation = {}; app.selectProjectSlot(1); unchanged(); app.confirmation = null;
  app.recordingShortcut = 'project-1'; app.selectProjectSlot(1); unchanged(); app.recordingShortcut = null;
  await Promise.resolve(); unchanged();
});

test('侧栏移动到同项目已打开 Pi 立即进入，松开不出现 Enter 且不创建进程', async t => {
  const a = terminal('a', 'alpha'), sibling = terminal('sibling', 'alpha');
  const { app, creates } = await workspace(t, { states: [a, sibling], history: [history(a, 30), history(sibling, 20)] });
  app.stepSidebarSession(1);
  assert.equal(app.workspace.activeId('alpha'), 'sibling');
  assert.equal(app.navTarget.terminalId, 'sibling');
  assert.equal(app.navHeld, false, 'moving immediately must not reveal the delayed hint layer');
  assert.equal(app.navPending, false);
  assert.equal(app.terminals.focused.at(-1), 'sibling');
  app.finishNav(); app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, false); assert.equal(app.navTarget, null);
  assert.equal(app.workspace.activeId('alpha'), 'sibling');
  assert.equal(creates.length, 0);
});

test('跨项目移动及全局会话页复用精确已有标签，不依赖 Enter', async t => {
  const { app, creates } = await workspace(t);
  app.stepSidebarSession(-1);
  assert.equal(app.selectedId, 'beta'); assert.equal(app.route, 'project');
  assert.equal(app.workspace.activeId('beta'), 'b');
  assert.equal(app.terminals.focused.at(-1), 'b');
  app.finishNav();
  app.route = 'recent';
  app.stepSidebarSession(1);
  assert.equal(app.selectedId, 'alpha'); assert.equal(app.route, 'project');
  assert.equal(app.workspace.activeId('alpha'), 'a');
  assert.equal(creates.length, 0);
});

test('搜索范围在跨项目连续两次移动及松开时保留，不跳入筛选外会话', async t => {
  const a = terminal('a', 'alpha'), b = terminal('b', 'beta'), sibling = terminal('sibling', 'alpha');
  const hidden = terminal('hidden', 'alpha');
  const { app, creates } = await workspace(t, {
    states: [a, b, sibling, hidden],
    history: [
      { ...history(a, 40), title: 'Shared alpha' },
      { ...history(hidden, 30), title: 'Unrelated hidden' },
      { ...history(sibling, 20), title: 'Shared sibling' },
      { ...history(b, 10), title: 'Shared beta' }
    ]
  });
  app.search = 'shared'; app.searchCursor = 2;
  app.stepSidebarSession(-1);
  assert.equal(app.selectedId, 'beta'); assert.equal(app.workspace.activeId('beta'), 'b');
  assert.equal(app.search, 'shared'); assert.equal(app.searchCursor, 2);
  app.stepSidebarSession(-1);
  assert.equal(app.selectedId, 'alpha'); assert.equal(app.workspace.activeId('alpha'), 'sibling');
  assert.equal(app.search, 'shared'); assert.equal(app.searchCursor, 2);
  app.finishNav();
  assert.equal(app.search, 'shared'); assert.equal(app.searchCursor, 2);
  assert.equal(app.workspace.activeId('alpha'), 'sibling');
  assert.equal(app.navPending, false); assert.equal(app.navTarget, null); assert.equal(creates.length, 0);
});

test('未打开历史只选中，松开后等待无修饰 Enter；取消不启动 Pi', async t => {
  const { app, creates } = await workspace(t);
  app.stepSidebarSession(1);
  assert.equal(app.navTarget.key, 'closed-key');
  assert.equal(app.workspace.activeId('alpha'), 'a');
  assert.equal(creates.length, 0);
  app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, true);
  assert.equal(creates.length, 0);
  app.cancelNav(); app.confirmNavTarget();
  assert.equal(app.navTarget, null); assert.equal(app.navPending, false); assert.equal(creates.length, 0);
  app.stepSidebarSession(1); app.finishNav(); app.confirmNavTarget();
  assert.equal(creates.length, 1);
  assert.equal(creates[0][0], 'alpha');
  assert.equal(creates[0][1].resume, true); assert.equal(creates[0][1].sessionKey, 'closed-key');
  assert.equal(app.navTarget, null); assert.equal(app.navPending, false);
});

test('失焦式 finishNav(false) 清除目标但不回滚已进入标签，不创建历史进程', async t => {
  const { app, creates } = await workspace(t);
  app.stepSidebarSession(-1);
  app.finishNav(false);
  assert.equal(app.selectedId, 'beta'); assert.equal(app.workspace.activeId('beta'), 'b');
  assert.equal(app.navHeld, false); assert.equal(app.navPending, false); assert.equal(app.navTarget, null);
  app.stepSidebarSession(-1); // The unopened alpha history precedes beta's current session.
  assert.equal(app.navTarget.key, 'closed-key');
  app.finishNav(false); app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, false); assert.equal(app.navTarget, null);
  assert.equal(creates.length, 0);
});

test('主进程 nav-release 兜底默认提交选择，commit:false 可取消已待确认目标', async t => {
  const { app, creates } = await workspace(t);
  app.stepSidebarSession(1);
  app.onEvent({ type: 'nav-release' });
  assert.equal(app.navHeld, false); assert.equal(app.navPending, true);
  app.onEvent({ type: 'nav-release', commit: false });
  assert.equal(app.navPending, false); assert.equal(app.navTarget, null);
  assert.equal(creates.length, 0);
});

test('导航层不覆盖弹窗或快捷键录制，重新按住 Option 清除旧 Enter 提示', async t => {
  const { app } = await workspace(t);
  app.confirmation = {};
  app.setNavHeld(true); assert.equal(app.navHeld, false);
  app.confirmation = null; app.recordingShortcut = 'sidebar-next';
  app.setNavHeld(true); assert.equal(app.navHeld, false);
  app.recordingShortcut = null;
  app.stepSidebarSession(1); app.finishNav();
  assert.equal(app.navPending, true);
  app.setNavHeld(true);
  assert.equal(app.navHeld, true); assert.equal(app.navPending, false);
  app.setNavHeld(true);
  assert.equal(app.navTarget.key, 'closed-key');
});

test('已选 Pi 在松开前退出时重新检查 running，不把旧快照自动恢复成新进程', async t => {
  const { app, creates, b } = await workspace(t);
  app.stepSidebarSession(-1);
  assert.equal(app.navTarget.state.running, true);
  app.workspace.apply({ ...b, running: false });
  app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, true);
  assert.equal(app.workspace.activeId('beta'), 'history');
  assert.equal(creates.length, 0);
  app.confirmNavTarget();
  assert.equal(creates.length, 1); assert.equal(creates[0][0], 'beta');
  assert.equal(creates[0][1].sessionKey, b.sessionKey);
});

test('已保存 Pi 在按住期间 /new 后保持原历史待确认，Enter 恢复原 key 而非复用新会话', async t => {
  const { app, creates, b } = await workspace(t);
  app.stepSidebarSession(-1);
  app.workspace.apply({ ...b, sessionId: 'replacement-session', sessionKey: 'replacement-key' });
  app.finishNav();
  assert.equal(app.navHeld, false); assert.equal(app.navPending, true);
  assert.equal(app.navTarget.key, b.sessionKey);
  assert.equal(creates.length, 0);
  app.confirmNavTarget();
  assert.equal(creates.length, 1); assert.equal(creates[0][0], 'beta');
  assert.equal(creates[0][1].sessionKey, b.sessionKey);
  assert.equal(app.navTarget, null); assert.equal(app.navPending, false);
});

test('无 key 的临时 Pi 已退出或标签运行身份变更时，Enter 只通知关闭而不创建进程', async t => {
  for (const replacement of [false, true]) {
    const a = terminal('a', 'alpha');
    const temporary = terminal('temp', 'alpha', { ephemeral: true, sessionKey: null, startedAt: 40 });
    const { app, creates } = await workspace(t, { states: [a, temporary], history: [history(a, 30)] });
    const notices = []; app.notify = value => notices.push(value);
    app.stepSidebarSession(-1);
    assert.equal(app.workspace.activeId('alpha'), 'temp');
    app.workspace.apply(replacement
      ? { ...temporary, runId: 'replacement-run', sessionId: 'replacement-session' }
      : { ...temporary, running: false });
    app.finishNav();
    assert.equal(app.navPending, true); assert.equal(app.navTarget.terminalId, 'temp');
    app.confirmNavTarget();
    assert.equal(creates.length, 0, 'unavailable temporary sessions must never resume without a key');
    assert.equal(notices.length, 1); assert.match(notices[0], /已关闭/);
    assert.equal(app.navTarget, null); assert.equal(app.navPending, false);
  }
});

test('未保存临时 Pi 可立即进入；重复 session-id 的历史副本不能冒认打开状态', async t => {
  const a = terminal('a', 'alpha');
  const temporary = terminal('temp', 'alpha', { ephemeral: true, sessionKey: null, startedAt: 40 });
  const copy = { ...history(a, 20), key: 'copied-history-file' };
  const { app, creates } = await workspace(t, { states: [a, temporary], history: [history(a, 30), copy] });
  app.stepSidebarSession(-1);
  assert.equal(app.workspace.activeId('alpha'), 'temp');
  assert.equal(app.navTarget.terminalId, 'temp');
  app.finishNav();
  assert.equal(app.navPending, false);
  app.workspace.selectTab('alpha', 'a');
  app.stepSidebarSession(1);
  assert.equal(app.navTarget.key, 'copied-history-file');
  assert.equal(app.workspace.activeId('alpha'), 'a');
  app.finishNav(); assert.equal(app.navPending, true);
  assert.equal(creates.length, 0);
});

test('侧栏展开超过九项时第十项仍可进入并循环，不残留数字快捷键上限', async t => {
  const states = Array.from({ length: 10 }, (_, index) => terminal(index ? 'item-' + index : 'a', 'alpha'));
  const { app, creates } = await workspace(t, { states, history: states.map((state, index) => history(state, 100 - index)) });
  app.sidebarSessionLimits.set('alpha', 15);
  for (let index = 1; index < states.length; index++) {
    app.stepSidebarSession(1);
    assert.equal(app.workspace.activeId('alpha'), states[index].id);
  }
  app.stepSidebarSession(1);
  assert.equal(app.workspace.activeId('alpha'), 'a');
  assert.equal(creates.length, 0);
});

class Element {
  constructor(tag = 'div', xterm = false) { this.tag = tag; this.xterm = xterm; this.id = ''; }
  matches() { return ['input', 'textarea', 'select', 'contenteditable'].includes(this.tag); }
  closest(selector) { return selector === '.xterm' ? (this.xterm ? this : null) : this.matches() ? this : null; }
}
async function windowEnvironment(t, app) {
  const listeners = new Map(), timers = new Map(), cleanups = [];
  let now = 0, serial = 0;
  const { useWindowEnvironment } = await load('hooks/useWindowEnvironment.ts', /^react$/,
    'export function useLayoutEffect() {} export function useEffect(effect) { globalThis.__cleanups.push(effect()); }', {
      Element, __cleanups: cleanups,
      window: {
        addEventListener(type, listener) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
      },
      setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); }
    });
  useWindowEnvironment(app);
  const cleanup = () => { for (const dispose of cleanups.splice(0)) dispose?.(); };
  t.after(() => { cleanup(); assert.equal(timers.size, 0); assert([...listeners.values()].every(set => !set.size)); });
  return {
    cleanup,
    event(type, extra = {}) {
      const event = { key: 'Meta', metaKey: true, target: new Element(), ...extra };
      for (const listener of listeners.get(type) || []) listener(event);
    },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); now = timer.at; timer.callback();
      }
      now = end;
    }
  };
}

test('Command 导航立即生效但满 500ms 才显示提示，方向键和 repeat 不提前显示或重置计时', async t => {
  const { app } = await workspace(t);
  const env = await windowEnvironment(t, app);
  env.event('keydown'); env.tick(400);
  app.stepSidebarSession(-1);
  assert.equal(app.workspace.activeId('beta'), 'b'); assert.equal(app.navHeld, false);
  env.event('keydown', { key: 'ArrowUp', repeat: true });
  env.event('keydown', { repeat: true });
  env.tick(99); assert.equal(app.navHeld, false);
  env.tick(1); assert.equal(app.navHeld, true);
  env.event('keyup', { metaKey: false });
  assert.equal(app.navHeld, false); assert.equal(app.navTarget, null); assert.equal(app.navPending, false);
});

test('每次快速切换各自计时，松开后不延迟闪出提示且不丢失未打开历史的 Enter 确认', async t => {
  const { app, creates } = await workspace(t);
  const env = await windowEnvironment(t, app);
  for (let index = 0; index < 2; index++) {
    env.event('keydown'); env.tick(300); app.stepSidebarSession(-1);
    assert.equal(app.navHeld, false);
    env.event('keyup', { metaKey: false }); env.tick(1100);
    assert.equal(app.navHeld, false);
  }
  app.cancelNav(); app.activateTerminal('a');
  env.event('keydown'); app.stepSidebarSession(1); env.tick(100);
  assert.equal(app.navTarget.key, 'closed-key'); assert.equal(app.navHeld, false);
  env.event('keyup', { metaKey: false });
  assert.equal(app.navPending, true);
  app.finishNav(); assert.equal(app.navPending, true, 'the main-process release fallback is idempotent');
  env.tick(1000); assert.equal(app.navHeld, false); assert.equal(creates.length, 0);
});

test('短按期间 Esc、点击、失焦和卸载均取消待展示提示，不在取消后重新弹出', async t => {
  for (const cancel of ['Escape', 'pointerdown', 'blur', 'cleanup']) {
    const { app } = await workspace(t);
    const env = await windowEnvironment(t, app);
    env.event('keydown'); env.tick(250); app.stepSidebarSession(1);
    if (cancel === 'Escape') { env.event('keydown', { key: 'Escape' }); app.cancelNav(); }
    else if (cancel === 'cleanup') env.cleanup();
    else env.event(cancel);
    env.tick(1500); assert.equal(app.navHeld, false, cancel);
    if (cancel !== 'cleanup') { assert.equal(app.navTarget, null, cancel); assert.equal(app.navPending, false, cancel); }
  }
});

async function keyboard(t, overrides = {}) {
  const listeners = [], cleanups = [], calls = [];
  const document = {
    addEventListener(type, listener, capture = false) { listeners.push({ type, listener, capture }); },
    removeEventListener(type, listener) {
      const index = listeners.findIndex(item => item.type === type && item.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
  const { useShortcuts } = await load('hooks/useShortcuts.ts', /^react$/, 'export function useEffect(effect) { globalThis.__cleanups.push(effect()); }', {
    document, Element, __cleanups: cleanups
  });
  const app = {
    preferences: { shortcuts: overrides }, route: 'project', selectedId: 'alpha',
    recordingShortcut: null, navHeld: false, navPending: false, paletteOpen: false, modal: false,
    modalOpen() { return this.modal; },
    workspace: { step: (...args) => calls.push(['tab', ...args]) },
    stepSidebarSession: direction => calls.push(['sidebar', direction]),
    selectProjectSlot: index => calls.push(['project', index]),
    syncCurrent() {}, publish() {}, focusActive() {},
    cancelNav() { calls.push(['cancel']); this.navHeld = false; this.navPending = false; },
    confirmNavTarget() { calls.push(['confirm']); this.navPending = false; },
    changeShortcut: (...args) => calls.push(['record', ...args])
  };
  useShortcuts(app);
  t.after(() => { for (const cleanup of cleanups) cleanup?.(); assert.equal(listeners.length, 0); });
  const key = (code, extra = {}) => {
    const event = {
      type: 'keydown', key: code, code, altKey: false, metaKey: true, ctrlKey: false, shiftKey: false,
      repeat: false, isComposing: false, target: new Element('textarea', true), prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra
    };
    for (const { listener } of [...listeners].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      listener(event); if (event.stopped) break;
    }
    return event;
  };
  return { app, calls, key };
}

test('Command 方向切换，单独 Option 和 Ctrl 原样交给 Pi', async t => {
  const {calls,key} = await keyboard(t);
  for (const [code,expected] of [['ArrowUp',['sidebar',-1]],['ArrowDown',['sidebar',1]],['ArrowLeft',['tab','alpha',-1]],['ArrowRight',['tab','alpha',1]]]) {
    const event=key(code);
    assert.equal(event.prevented,true); assert.equal(event.stopped,true); assert.deepEqual(calls.at(-1),expected);
    for (const extra of [{metaKey:false,altKey:true},{altKey:true},{metaKey:false,ctrlKey:true},{isComposing:true}]) {
      const unhandled=key(code,extra); assert.equal(unhandled.prevented,false);
    }
    const input=key(code,{target:new Element('input')}); assert.equal(input.prevented,false);
  }
});
test('项目数字使用 Command，不截获 Option 数字，重复触发不重复派发', async t => {
  const {calls,key,app}=await keyboard(t);
  for (const [index,digit] of [...'1234567890'].entries()) {
    const event=key('Digit'+digit,{key:digit,altKey:false});
    assert.equal(event.prevented,true); assert.deepEqual(calls.at(-1),['project',index]);
    const before=calls.length;
    assert.equal(key('Digit'+digit,{key:digit,altKey:false,repeat:true}).prevented,true);
    assert.equal(calls.length,before);
    assert.equal(key('Digit'+digit,{key:digit,metaKey:false,altKey:true}).prevented,false);
  }
  app.preferences.shortcuts={'project-1':null};
  assert.equal(key('Digit1',{altKey:false}).prevented,false);
});
test('文本框保留方向编辑，弹窗和输入法不触发导航', async t => {
  const {app,calls,key}=await keyboard(t);
  for (const tag of ['input','textarea','select','contenteditable'])
    for (const code of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])
      assert.equal(key(code,{target:new Element(tag)}).prevented,false);
  assert.equal(key('ArrowUp',{isComposing:true}).prevented,false);
  app.modal=true; assert.equal(key('ArrowUp').prevented,false); assert.equal(calls.length,0);
});
test('引导阻止原生菜单快捷键穿透，关闭引导不关闭 Pi 标签', async t => {
  const {app,calls,key}=await keyboard(t);
  app.onboardingOpen=true; app.modal=true;
  app.dismissOnboarding=()=>{calls.push(['dismiss-guide']);app.onboardingOpen=false;};
  for (const command of ['new-tab','new-temporary-tab','settings','about','search','sidebar-next','end-all']) app.dispatchShortcut(command);
  assert.equal(key('ArrowRight',{metaKey:false}).prevented,false, 'unmodified page navigation belongs to the guide');
  assert.equal(calls.length,0);
  app.dispatchShortcut('close-tab');
  assert.deepEqual(calls,[['dismiss-guide']]);
});
test('录制只接收 Command，待进入历史仅无修饰 Enter 确认', async t => {
  const {app,calls,key}=await keyboard(t);
  app.navPending=true;
  assert.equal(key('Enter',{altKey:false,metaKey:false}).prevented,true);
  assert.deepEqual(calls.at(-1),['confirm']);
  app.recordingShortcut='sidebar-next';
  assert.equal(key('ArrowDown').prevented,true);
  assert.deepEqual(calls.at(-1),['record','sidebar-next','Command+Down']);
});
