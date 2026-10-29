const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function terminal(t, { kind = 'pi', platform = 'MacIntel' } = {}) {
  const bundle = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../src/renderer/terminal/terminal-view.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'terminal-host', setup(build) {
      build.onResolve({ filter: /^@xterm\// }, args => ({ path: args.path, namespace: 'terminal-host' }));
      build.onLoad({ filter: /.*/, namespace: 'terminal-host' }, () => ({ contents: `
        export class Terminal {
          constructor(options) { this.options = options; }
          modes = { mouseTrackingMode: 'none' };
          cols = 100; rows = 20; buffer = { active: { viewportY: 0 } };
          element = { querySelector: () => ({ getBoundingClientRect: () => ({left:0,top:0,right:100,bottom:20,width:100,height:20}) }) };
          parser = { registerOscHandler() {} };
          loadAddon(addon) { if (addon.handler) this.webLink = addon.handler; }
          open() {} onData() {} onResize() {} attachCustomKeyEventHandler() {} attachCustomWheelEventHandler(handler) { this.wheel = handler; } dispose() {}
        }
        export class FitAddon {}
        export class WebglAddon {}
        export class WebLinksAddon { constructor(handler) { this.handler = handler; } }
      `, loader: 'js' }));
    } }]
  });
  const module = { exports: {} }, listeners = {}, containerListeners = {};
  const container = { dataset: {}, classList: { add() {} }, remove() {}, contains: () => true,
    addEventListener: (name, fn) => { containerListeners[name] = fn; }, removeEventListener: name => { delete containerListeners[name]; } };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, Error, navigator: { platform },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } },
    document: { createElement: () => container }
  });
  const opened = [], notices = [], revealed = [];
  const bridge = { openExternal: async uri => { opened.push(uri); }, revealTerminalPath: async (...args) => { revealed.push(args); } };
  const view = new module.exports.TerminalView({ id: 'test', runId: 'run', kind }, { append() {} }, {
    bridge, appearance: 'dark', fontSize: 13, notify: notice => notices.push(notice)
  });
  t.after(() => view.dispose());
  return { view, opened, notices, bridge, revealed, listeners, containerListeners,
    activate(extra = {}, uri = 'https://example.com/source') { view.term.options.linkHandler.activate({ altKey: false, shiftKey: false, ...extra }, uri); }
  };
}

test('全屏 Pi 捕获鼠标时 OSC 8 链接只由 Pi 打开，Console 不重复打开', async t => {
  const { view, opened, activate } = await terminal(t);
  for (const mode of ['vt200', 'drag', 'any']) {
    view.term.modes.mouseTrackingMode = mode;
    activate(); assert.deepEqual(opened, [], mode);
  }
  view.term.modes.mouseTrackingMode = 'none';
  activate(); activate();
  assert.equal(opened.length, 2, '普通终端由 Console 打开，独立点击不做时间去重');
});

test('macOS Option 与非 macOS Shift 强制本地选择时由 Console 打开，不丢链接', async t => {
  for (const [platform, modifier] of [['MacIntel', 'altKey'], ['Linux x86_64', 'shiftKey']]) {
    const { view, opened, activate } = await terminal(t, { platform });
    view.term.modes.mouseTrackingMode = 'any';
    activate({ [modifier]: true }); assert.equal(opened.length, 1, platform);
  }
});

test('纯文本 URL 和非 Pi 终端仍由 Console 打开，不受鼠标模式影响', async t => {
  const { view, opened } = await terminal(t);
  view.term.modes.mouseTrackingMode = 'any';
  view.term.webLink({}, 'https://example.com/plain');
  assert.deepEqual(opened, ['https://example.com/plain']);
  const shell = await terminal(t, { kind: 'shell' });
  shell.view.term.modes.mouseTrackingMode = 'any'; shell.activate();
  assert.equal(shell.opened.length, 1);
});

test('本地 OSC 链接由 Console 独占，交给对应会话定位；拖动不打开', async t => {
  const { view, revealed, activate, containerListeners, listeners } = await terminal(t);
  assert.equal(view.term.options.linkHandler.allowNonHttpProtocols, true);
  activate({}, 'dist/archive.zip');
  assert.deepEqual(revealed, [['test', 'run', 'dist/archive.zip']]);
  view.term.modes.mouseTrackingMode = 'any';
  const uri = 'dist/archive.zip'; view.term.options.linkHandler.hover({}, uri, {start:{x:1,y:11},end:{x:20,y:11}});
  const event = (x=10) => ({button:0,clientX:x,clientY:10,target:{}, preventDefault(){this.prevented=true;}, stopImmediatePropagation(){this.stopped=true;}});
  const outside = event(30); containerListeners.mousedown(outside); assert.equal(outside.prevented, undefined, 'stale hover does not intercept other terminal cells');
  let down = event(), up = event(); containerListeners.mousedown(down); listeners.mouseup(up);
  assert(down.prevented && down.stopped && up.prevented && up.stopped);
  assert.deepEqual(revealed.at(-1), ['test', 'run', uri]); assert.equal(revealed.length, 2);
  down = event(); up = event(30); containerListeners.mousedown(down); listeners.mouseup(up);
  assert.equal(revealed.length, 2, 'dragging does not reveal a file');
  view.term.options.linkHandler.leave({}, uri);
  down = event(); containerListeners.mousedown(down); assert.equal(down.prevented, undefined);
});
test('Pi 无鼠标滚轮协议时不把滚轮翻译成上下键；有协议或 Shell 保持原行为', async t => {
  const { view } = await terminal(t);
  const wheel = () => ({ prevented:false, preventDefault() { this.prevented=true; } });
  for (const mode of ['none', 'x10']) {
    view.term.modes.mouseTrackingMode = mode; const event = wheel();
    assert.equal(view.term.wheel(event), false); assert.equal(event.prevented, true);
  }
  for (const mode of ['vt200', 'drag', 'any']) {
    view.term.modes.mouseTrackingMode = mode; const event = wheel();
    assert.equal(view.term.wheel(event), true); assert.equal(event.prevented, false);
  }
  const shell = await terminal(t, {kind:'shell'}), event = wheel();
  assert.equal(shell.view.term.wheel(event), true); assert.equal(event.prevented, false);
});
test('Console 打开链接失败仍显示错误，允许再次点击重试', async t => {
  const { bridge, activate, notices } = await terminal(t);
  bridge.openExternal = async () => { throw new Error('open failed'); };
  activate(); await Promise.resolve();
  assert.deepEqual(notices, ['open failed']);
  activate(); await Promise.resolve(); assert.equal(notices.length, 2);
});
