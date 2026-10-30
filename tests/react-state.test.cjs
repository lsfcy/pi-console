const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function load(entry, mockPath, mockSource, globals = {}) {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src/renderer', entry)], platform: 'node',
    bundle: true, format: 'cjs', write: false,
    plugins: [{ name: 'test-host', setup(build) {
      build.onResolve({ filter: mockPath }, () => ({ path: 'mock', namespace: 'test-host' }));
      build.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ contents: mockSource, loader: 'js' }));
    } }]
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, structuredClone, setTimeout, clearTimeout,
    document: { getElementById: () => null, querySelector: () => null, hasFocus: () => true }, ...globals
  });
  return module.exports;
}
const mockRegistry = `export class TerminalRegistry {
  views=new Map(); requestLayout(){} dispose(){this.disposed=true;} focus(){}
}`;
const loadController = (globals = {}) => load('state/workspace-controller.ts', /terminal-registry\.js$/, mockRegistry, globals);
const mockView = `export class TerminalView {
  constructor(state) { this.state=state; this.writes=[]; this.disposed=0; this.container={hidden:false};
    this.term={write:(data,done)=>{this.writes.push(data);done?.();}}; }
  fit(){this.fitted=(this.fitted||0)+1;}
  dispose(){this.disposed++;}
}`;
test('React 挂载前的输出有界缓存，过期运行输出不进入新 xterm', async () => {
  const { TerminalRegistry } = await load('terminal/terminal-registry.ts', /terminal-view\.js$/, mockView);
  const acknowledgements = [];
  const registry = new TerminalRegistry({ acknowledge: (...args) => acknowledgements.push(args) }, () => {});
  registry.write({ id: 't', runId: 'old', data: 'old', kind: 'pi' });
  registry.write({ id: 't', runId: 'new', data: 'draft', kind: 'pi' });
  const unmount = registry.mount({ id: 't', runId: 'new' }, {}, 'dark', 13);
  const view = registry.views.get('t');
  assert.deepEqual([...view.writes], ['draft']);
  assert.deepEqual(acknowledgements, [['t', 'old', 3], ['t', 'new', 5]]);
  registry.write({ id: 't', runId: 'old', data: 'stale', kind: 'pi' });
  assert.deepEqual([...view.writes], ['draft']);
  unmount(); unmount();
  assert.equal(view.disposed, 1);
  assert.equal(registry.views.size, 0);
});
test('终端布局合并到一个帧，释放时清理帧、xterm 与未挂载输出', async () => {
  const frames = new Map(), acknowledgements = []; let serial = 0;
  const { TerminalRegistry } = await load('terminal/terminal-registry.ts', /terminal-view\.js$/, mockView, {
    requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  const registry = new TerminalRegistry({ acknowledge: (...args) => acknowledgements.push(args) }, () => {});
  registry.mount({ id: 't', runId: 'r' }, {}, 'dark', 13);
  const view = registry.views.get('t');
  registry.requestLayout(); registry.requestLayout(); assert.equal(frames.size, 1);
  registry.write({ id: 'pending', runId: 'p', kind: 'pi', data: 'queued' });
  registry.dispose(); registry.dispose();
  assert.equal(frames.size, 0);
  assert.equal(view.disposed, 1);
  assert.deepEqual(acknowledgements, [['pending', 'p', 6]]);
});
test('窗口销毁后的异步初始快照不复活状态或订阅', async () => {
  const { WorkspaceController } = await loadController();
  let resolve, subscriptions = 0;
  const bridge = {
    onEvent: () => { subscriptions++; return () => subscriptions--; },
    snapshot: () => new Promise(done => { resolve = done; })
  };
  const app = new WorkspaceController(bridge);
  const starting = app.start();
  assert.equal(subscriptions, 1);
  app.dispose();
  resolve({});
  await starting;
  assert.equal(subscriptions, 0);
  assert.equal(app.ready, false);
  assert.equal(app.projects.length, 0);
});
test('首次展示引导，跳过或完成仅保存一次，刷新不重开，已查看可手动重开', async () => {
  const { WorkspaceController } = await loadController();
  for (const seen of [undefined, false, true]) {
    for (const projects of [[], [{id:'p',name:'Project',path:'/project'}]]) {
      const writes = [];
      const snapshot = {projects,terminals:[],history:[],selectedId:projects[0]?.id || null,library:{loading:false,roots:[],warnings:[]},
        preferences:{onboardingSeen:seen},appearance:'dark',sidebarAppearance:'dark',update:null,appVersion:'test'};
      const app = new WorkspaceController({
        onEvent: () => () => {}, snapshot: async () => snapshot,
        setPreferences: async patch => { writes.push(patch); return {preferences:patch,appearance:'dark',sidebarAppearance:'dark'}; }
      });
      await app.start();
      assert.equal(app.onboardingOpen, seen !== true);
      if (!app.onboardingOpen) app.openOnboarding();
      assert.equal(app.modalOpen(), true);
      app.dismissOnboarding(); app.dismissOnboarding(); await Promise.resolve();
      assert.equal(app.onboardingOpen, false);
      assert.equal(app.preferences.onboardingSeen, true);
      assert.equal(writes.length, seen === true ? 0 : 1);
      app.applySnapshot({...snapshot,preferences:app.preferences});
      assert.equal(app.onboardingOpen, false, 'library refresh does not restart the guide');
      app.openOnboarding(); assert.equal(app.onboardingOpen,true);
      app.dismissOnboarding(); await Promise.resolve();
      assert.equal(writes.length, seen === true ? 0 : 1, 'reopening needs no extra persistence');
      app.dispose();
    }
  }
});
test('保存引导标记失败时提示错误，不困住当前窗口也不自动重试', async () => {
  const { WorkspaceController } = await loadController();
  let writes = 0;
  const app = new WorkspaceController({setPreferences:async()=>{writes++;throw new Error('cannot save guide');}});
  app.openOnboarding(); app.dismissOnboarding();
  for (let i=0;i<4;i++) await Promise.resolve();
  assert.equal(app.onboardingOpen,false);
  assert.equal(writes,1);
  assert.match(app.notices.value.message,/cannot save guide/);
  app.dispose();
});
test('仅已打包且允许检查的窗口启动时自动查一次，沙箱与用户关闭不联网', async () => {
  const { WorkspaceController } = await loadController();
  for (const [automatic, enabled, expected] of [[true,true,1],[true,false,0],[false,true,0]]) {
    let calls = 0;
    const app = new WorkspaceController({
      onEvent: () => () => {},
      snapshot: async () => ({projects:[],terminals:[],history:[],selectedId:null,library:{loading:false,roots:[],warnings:[]},
        preferences:{checkAppUpdates:enabled},appearance:'light',sidebarAppearance:'light',update:null,appVersion:'0.0.1-rc.1',automaticAppUpdateCheck:automatic}),
      checkAppUpdate: async () => { calls++; return {currentVersion:'0.0.1-rc.1',latestVersion:'0.0.1-rc.1',available:false,channel:'prerelease',url:'https://example.com'}; }
    });
    await app.start(); await Promise.resolve();
    assert.equal(calls,expected); app.dispose();
  }
});
test('自动检查每小时执行，失败不密集重试，关闭或销毁取消计时且同一版本不重复提示', async () => {
  const timers = new Map(); let serial = 0, calls = 0, fail = false;
  const { WorkspaceController } = await loadController({
    setTimeout: (callback, ms) => { const id = ++serial; timers.set(id,{callback,ms}); return id; },
    clearTimeout: id => { timers.delete(id); }
  });
  const release = {currentVersion:'0.0.1-rc.1',latestVersion:'0.0.1-rc.2',available:true,url:'https://example.com',channel:'prerelease'};
  const app = new WorkspaceController({onEvent:()=>()=>{},
    snapshot:async()=>({projects:[],terminals:[],history:[],selectedId:null,library:{loading:false,roots:[],warnings:[]},
      preferences:{checkAppUpdates:true},appearance:'light',sidebarAppearance:'light',update:null,appVersion:'0.0.1-rc.1',automaticAppUpdateCheck:true}),
    checkAppUpdate:async()=>{calls++; if (fail) throw new Error('offline'); return release;}
  });
  const flush = async () => { for (let i=0;i<6;i++) await Promise.resolve(); };
  const tick = async () => {
    assert.equal(timers.size,1); const [id,timer] = [...timers][0]; assert.equal(timer.ms,3600000);
    timers.delete(id); timer.callback(); await flush();
  };
  await app.start(); await flush(); assert.equal(calls,1); assert(app.notices.value);
  app.dismissNotice(); await tick(); assert.equal(calls,2); assert.equal(app.notices.value,null, 'same release is not repeatedly announced');
  fail = true; await tick(); assert.equal(calls,3); assert.equal(app.appUpdateError,''); assert.equal(timers.size,1, 'failure waits an hour');
  app.applyPreferences({checkAppUpdates:false}); assert.equal(timers.size,0, 'disabling cancels the timer immediately');
  fail = false; app.applyPreferences({checkAppUpdates:true}); await flush(); assert.equal(calls,4, 're-enabling checks immediately');
  assert.equal(timers.size,1); app.dispose(); assert.equal(timers.size,0, 'dispose cancels the timer');
});
test('自动检查不打扰其他通知，关闭设置或销毁窗口后不弹出；失败可手动重试', async () => {
  const { WorkspaceController } = await loadController();
  let resolve, fail = false, calls = 0;
  const release = {currentVersion:'0.0.1-rc.1',latestVersion:'0.0.1-rc.2',available:true,url:'https://github.com/lsfcy/pi-console/releases/tag/v0.0.1-rc.2',channel:'prerelease'};
  const app = new WorkspaceController({checkAppUpdate: () => { calls++; return fail ? Promise.reject(new Error('offline')) : new Promise(done=>{resolve=done;}); }});
  app.notify('已有通知');
  let request = app.checkAppUpdate(false, true); resolve(release); await request;
  assert.equal(app.notices.value.message, '已有通知'); assert.equal(app.appRelease.latestVersion,'0.0.1-rc.2');
  app.dismissNotice(); request = app.checkAppUpdate(false, true); app.preferences.checkAppUpdates = false; resolve(release); await request;
  assert.equal(app.notices.value,null, 'disabling while a request is in flight suppresses its notice');
  fail = true; await app.checkAppUpdate(false,true); assert.equal(app.appUpdateError,'', 'background failure is silent');
  await app.checkAppUpdate(true); assert.match(app.appUpdateError,/offline/, 'manual failure is visible');
  fail = false; request = app.checkAppUpdate(true); app.dispose(); resolve(release); await request;
  assert.equal(app.notices.value,null); assert.equal(calls,5);
});
test('折叠项目删除临时展示数量，重开恢复默认且不影响其他项目', async () => {
  const { WorkspaceController } = await loadController();
  const app = new WorkspaceController({});
  try {
    app.sidebarSessionLimits.set('alpha', 25); app.sidebarSessionLimits.set('beta', 15);
    app.setProjectExpanded('alpha', true); app.setProjectExpanded('beta', true);
    assert.equal(app.sidebarSessionLimits.get('alpha'), 25, '重复展开不清除当前数量');
    app.setProjectExpanded('alpha', false);
    assert.equal(app.expandedProjects.has('alpha'), false);
    assert.equal(app.sidebarSessionLimits.has('alpha'), false);
    app.setProjectExpanded('alpha', true);
    assert.equal(app.expandedProjects.has('alpha'), true);
    assert.equal(app.sidebarSessionLimits.get('alpha'), undefined, '回到 sidebarSessions 默认的五个');
    assert.equal(app.sidebarSessionLimits.get('beta'), 15);
    assert.equal(app.expandedProjects.has('beta'), true);
    app.setProjectExpanded('alpha', false); app.setProjectExpanded('alpha', false);
    assert.equal(app.sidebarSessionLimits.has('alpha'), false, '重复折叠是幂等的');
  } finally { app.dispose(); }
});
test('项目新建 Pi 使用指定项目，等待时去重，成功后展开并激活且清除筛选', async () => {
  const { WorkspaceController } = await loadController();
  let resolve;
  const requests = [];
  const app = new WorkspaceController({
    createPi: (id, options) => { requests.push([id, options]); return new Promise(done => { resolve = done; }); },
    selectProject: async () => {}
  });
  try {
    app.projects = [{ id: 'alpha' }, { id: 'beta' }]; app.selectedId = 'alpha'; app.route = 'settings'; app.search = 'Beta';
    const pending = app.createPi(false, undefined, 'beta');
    await app.createPi(false, undefined, 'beta');
    assert.equal(requests.length, 1, '同一项目等待时不重复发起创建');
    assert.equal(requests[0][0], 'beta'); assert.equal(requests[0][1].resume, false);
    assert.equal(app.pendingProjects.has('beta'), true);
    assert.equal(app.selectedId, 'alpha'); assert.equal(app.route, 'settings', '创建成功前不切走');
    resolve({ id: 'new-beta', runId: 'run', sessionId: 'session', projectId: 'beta', kind: 'pi', running: true, status: 'idle' });
    await pending;
    assert.equal(app.pendingProjects.size, 0);
    assert.equal(app.selectedId, 'beta'); assert.equal(app.route, 'project');
    assert.equal(app.workspace.activeId('beta'), 'new-beta');
    assert.equal(app.expandedProjects.has('beta'), true);
    assert.equal(app.search, '', '新会话不会被旧筛选隐藏');
  } finally { app.dispose(); }
});
test('项目新建失败或取消不切换页面，并释放等待状态供人工重试', async () => {
  const { WorkspaceController } = await loadController();
  let fail = true;
  const app = new WorkspaceController({ createPi: async () => { if (fail) throw new Error('启动失败'); return null; } });
  try {
    app.projects = [{ id: 'alpha' }, { id: 'beta' }]; app.selectedId = 'alpha'; app.route = 'recent';
    await app.createPi(false, undefined, 'beta');
    assert.equal(app.pendingProjects.size, 0);
    assert.equal(app.selectedId, 'alpha'); assert.equal(app.route, 'recent');
    assert.equal(app.expandedProjects.has('beta'), false);
    fail = false; await app.createPi(false, undefined, 'beta');
    assert.equal(app.pendingProjects.size, 0); assert.equal(app.workspace.terminals.size, 0);
    assert.equal(app.selectedId, 'alpha'); assert.equal(app.route, 'recent');
  } finally { app.dispose(); }
});
test('完成提醒只处理一次状态转换，静音偏好与当前前台会话免打扰生效', async () => {
  const { WorkspaceController } = await loadController();
  const attention = [];
  const app = new WorkspaceController({ attention: async payload => { attention.push(payload); } });
  try {
    app.projects = [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]; app.selectedId = 'alpha';
    app.preferences.completionNotice = false;
    const beta = { id: 'b', runId: 'r', sessionId: 's', projectId: 'beta', kind: 'pi', running: true, status: 'working' };
    app.handleState(beta); app.handleState({ ...beta, status: 'done' }); app.handleState({ ...beta, status: 'done' });
    await Promise.resolve();
    assert.equal(attention.length, 1, '重复完成状态不重复提醒');
    assert.equal(attention[0].sound, true);
    app.preferences.completionSound = false;
    app.handleState(beta); app.handleState({ ...beta, status: 'done' });
    await Promise.resolve();
    assert.equal(attention.length, 2); assert.equal(attention[1].sound, false, '静音不委托播放提示音');
    app.workspace.activate('b'); app.selectedId = 'beta';
    app.handleState(beta); app.handleState({ ...beta, status: 'done' });
    await Promise.resolve();
    assert.equal(attention.length, 2, '当前前台会话不提醒自己');
  } finally { app.dispose(); }
});
test('手动标记当前会话未读不被状态/快照刷新清除，显式重新打开才确认', async () => {
  const { WorkspaceController } = await loadController();
  const reads = [];
  let resolveRead;
  const app = new WorkspaceController({
    selectProject: async () => {},
    setSessionUnread: (...args) => { reads.push(args); return new Promise(resolve => { resolveRead = resolve; }); }
  });
  try {
    const state = { id: 't', runId: 'r', sessionId: 's', sessionKey: 'key-s', projectId: 'alpha', kind: 'pi', running: true, status: 'working' };
    app.projects = [{ id: 'alpha' }]; app.selectedId = 'alpha';
    app.handleState(state);
    app.unreadSessions = [{ projectId: 'alpha', sessionKey: 'key-s' }];
    app.syncCurrent(); app.handleState({ ...state, message: 'metadata refresh' });
    app.applySnapshot({ projects: app.projects, selectedId: 'alpha', history: [], terminals: [state],
      preferences: app.preferences, appearance: 'dark', sidebarAppearance: 'dark',
      library: app.library, unreadSessions: app.unreadSessions, update: null });
    app.acknowledgeCurrentCompletion(false);
    assert.equal(reads.length, 0, '当前视图的被动刷新及原生菜单归还焦点不取消人工标记');
    assert(app.isSessionUnread({ projectId: 'alpha', id: 's', key: 'key-s', terminalId: 't' }));
    assert.equal(app.isMarkedUnread('beta', 'key-s'), false, '同名会话不跨项目混淆');
    assert.equal(app.isSessionUnread({ projectId: 'alpha', id: 's', key: 'copied-file' }), false, '同一项目内相同 session-id 的副本按文件身份区分');
    app.activateTerminal('t'); app.activateTab('t');
    await Promise.resolve();
    assert.equal(reads.length, 1, '同一确认请求等待期间去重');
    assert.deepEqual(reads[0], ['alpha', 'key-s', false]);
    resolveRead({}); await Promise.resolve();
  } finally { app.dispose(); }
});
test('会话三视图不限活动时间，收藏/置顶独立，监控时间与状态筛选不串页', async () => {
  const {WorkspaceController}=await loadController();
  const selectors=await load('state/selectors.ts',/unused-test-mock/,'');
  const app=new WorkspaceController({});
  try {
    app.projects=[{id:'alpha',name:'Alpha',path:'/alpha'},{id:'beta',name:'Beta',path:'/beta',pinned:true}];
    app.sessionHistory=[{id:'same',key:'old',title:'老收藏',firstMessage:'',projectId:'alpha',modifiedAt:1},
      {id:'same',key:'other-file',title:'独立副本',firstMessage:'',projectId:'alpha',modifiedAt:2},
      {id:'beta',key:'beta',title:'全局置顶',firstMessage:'',projectId:'beta',modifiedAt:3}];
    app.sessionMarks=[{projectId:'alpha',sessionKey:'old',favorite:true,pinned:true},{projectId:'beta',sessionKey:'beta',favorite:true}];
    app.expandedProjects.add('alpha');
    assert.deepEqual(Array.from(selectors.sidebarSessionSlots(app), info=>info.key),['old','other-file'],'sidebar navigation follows expanded sidebar order');
    app.workspace.apply({id:'t',runId:'r',sessionId:'same',sessionKey:'old',projectId:'alpha',kind:'pi',running:true,status:'done',startedAt:4});
    app.route='recent';app.recentTimeRange='week';
    assert.deepEqual(Array.from(selectors.globalRows(app),r=>r.key),['beta','other-file','old'],'all includes old history; favorites do not reorder; an open Pi does not fake recent activity');
    app.recentFilter='running';assert.deepEqual(Array.from(selectors.globalRows(app),r=>r.key),['old'],'done but open Pi counts as running');
    app.recentFilter='favorites';assert.deepEqual(Array.from(selectors.globalRows(app),r=>r.key),['beta','old'],'favorite lookup uses the file key, not repeated session-id');
    app.search='Beta';assert.equal(selectors.globalRows(app).length,1,'favorites still apply the active search');
    app.search='';assert.deepEqual(Array.from(selectors.filteredProjects(app),p=>p.id),['beta','alpha']);
    app.route='project';app.selectedId='alpha';assert.deepEqual(Array.from(selectors.historyRows(app).visible,r=>r.key),['old','other-file']);
    app.statsVisible=true;app.monitorFilter='all';assert.equal(selectors.globalRows(app).length,0,'statistics alone retains its activity range');
    app.recentTimeRange='all';assert.equal(selectors.globalRows(app).length,3);
    app.monitorFilter='running';assert.equal(selectors.globalRows(app).length,1);
    assert.equal(app.recentFilter,'favorites','monitor filters never overwrite the session tab');
  } finally {app.dispose();}
});
test('历史和未保存会话都使用同一管理菜单入口，菜单参数含真实身份与未读状态', async () => {
  const { WorkspaceController } = await loadController();
  const menus = [];
  const app = new WorkspaceController({ historyMenu: async (...args) => { menus.push(args); } });
  try {
    const state = { id: 't', runId: 'r', sessionId: 's', sessionKey: 'key-s', projectId: 'alpha', kind: 'pi', running: true, status: 'working' };
    app.workspace.apply(state); app.unreadSessions = [{ projectId: 'alpha', sessionKey: 'key-s' }];
    app.openSessionMenu({ projectId: 'alpha', id: 's', key: null, terminalId: 't' });
    app.openSessionMenu({ projectId: 'alpha', id: 'saved', key: 'saved-key' });
    await Promise.resolve();
    assert.equal(menus.length, 2);
    assert.equal(menus[0][1], null); assert.equal(menus[0][2].terminalId, 't');
    assert.equal(menus[0][2].runId, 'r'); assert.equal(menus[0][2].sessionId, 's'); assert.equal(menus[0][2].sessionKey, 'key-s'); assert.equal(menus[0][2].unread, true);
    assert.equal(menus[1][1], 'saved-key'); assert.equal(menus[1][2].unread, false);
  } finally { app.dispose(); }
});
