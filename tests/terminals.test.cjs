const test = require('node:test');
const assert = require('node:assert/strict');
const { TerminalManager, terminalEnvironment, dimensions } = require('../build/main/terminal-manager.cjs');
const { frame, FrameDecoder } = require('../build/main/bridge-protocol.cjs');
const { WorkspaceState } = require('../build/shared/workspace-state.js');
const { palettes } = require('../build/shared/terminal-theme.js');

function fake(t, options = {}) {
  const processes = [], calls = [];
  const manager = new TerminalManager({ env: { PATH: '/bin' }, shell: '/bin/zsh', ...options,
    spawn(...args) {
      const proc = { pid: 1000 + processes.length, writes: [], pauses: 0, resumes: 0,
        onData(fn) { this.data = fn; }, onExit(fn) { this.exit = fn; },
        write(value) { this.writes.push(value); }, resize() {}, pause() { this.pauses++; }, resume() { this.resumes++; } };
      processes.push(proc); calls.push(args); return proc;
    },
    async terminate(proc) { proc.exit({ exitCode: 143, signal: 15 }); }
  });
  t.after(() => manager.stopAll());
  const metadata = (index, values = {}) => {
    const state = manager.list().find(s => s.pid === processes[index].pid);
    const payload = { token: calls[index][2].env.PI_GUI_BRIDGE_TOKEN, cwd: state.cwd, sessionId: state.sessionId,
      sessionFile: state.sessionFile, appearance: 'dark', name: '', ...values };
    processes[index].data(frame(7502, payload)); return payload;
  };
  return { manager, processes, calls, metadata };
}
test('只清理已结束的更新记录，运行中禁止清除，普通会话不受影响', async t => {
  const {manager,processes}=fake(t);
  const update=manager.start(null,{kind:'update'});
  assert.throws(()=>manager.clearUpdateLog(),/更新结束/);
  processes[0].exit({exitCode:1});assert(manager.updateLog());manager.clearUpdateLog();
  assert.equal(manager.updateLog(),null);
  const session=manager.start({id:'p',path:'/tmp'});manager.clearUpdateLog();assert(manager.records.has(session.id));
});
test('同一项目可有多个 Pi 标签和独立 Shell；重复历史会话复用已有标签', t => {
  const { manager, processes } = fake(t);
  const project = { id: 'p', path: '/tmp' };
  const a = manager.start(project), b = manager.start(project);
  const shell = manager.start(project, { kind: 'shell' });
  assert.equal(manager.list().length, 3); assert.notEqual(a.id, b.id);
  const saved = manager.start(project, { sessionFile: '/tmp/a.jsonl', sessionId: 'saved' });
  assert.equal(manager.start(project, { sessionFile: '/tmp/a.jsonl', sessionId: 'saved' }).id, saved.id);
  assert.equal(processes.length, 4);
  manager.write(a.id, a.runId, 'one'); manager.write(b.id, b.runId, 'two'); manager.write(shell.id, shell.runId, 'shell');
  assert.deepEqual(processes.slice(0, 3).map(p => p.writes), [['one'], ['two'], ['shell']]);
});
test('分叉用原生 --fork 和全新 ID/文件身份，参数不进入 shell 命令文本', t => {
  const { manager, calls, metadata } = fake(t);
  const project = { id: 'p', path: '/tmp' }, file = '/tmp/引号 " $(touch nope).jsonl';
  const source = manager.start(project, { sessionFile: file, sessionId: 'source' });
  const copy = manager.start(project, { forkFile: file, label: '新分叉 "$(echo nope)"' });
  assert.notEqual(copy.id, source.id); assert.notEqual(copy.sessionId, source.sessionId);
  assert.equal(copy.sessionFile, null); assert.equal(copy.sessionKey, null);
  assert.match(calls[1][1][1], /--fork "\$2" --session-id "\$3" --name "\$4"/);
  assert(!calls[1][1][1].includes(file)); assert(!calls[1][1][1].includes('echo nope'));
  assert.deepEqual(calls[1][1].slice(4), [file, copy.sessionId, '新分叉 "$(echo nope)"']);
  assert.equal(manager.findSession({ file }).id, source.id, '分叉启动不会占用或复用源文件身份');
  metadata(1, { sessionFile: '/tmp/fork.jsonl' });
  assert.equal(manager.findSession({ file: '/tmp/fork.jsonl' }).id, copy.id);
  for (const invalid of [{ forkFile: 'relative' }, { forkFile: file, ephemeral: true },
    { forkFile: file, sessionFile: file }, { forkFile: file, sessionId: 'source' }, { forkFile: file, kind: 'shell' }])
    assert.throws(() => manager.start(project, invalid), /分叉|临时会话/);
});
test('临时会话使用 --no-session，禁止恢复或指定历史文件', t => {
  const { manager, calls, metadata } = fake(t);
  const state = manager.start({ id: 'p', path: '/tmp' }, { ephemeral: true });
  assert.equal(state.ephemeral, true); assert.match(state.label, /临时会话/);
  assert.match(calls[0][1][1], /--no-session/); assert(!calls[0][1][1].includes('--session-id'));
  metadata(0); assert.equal(manager.list()[0].sessionFile, null);
  metadata(0, { sessionFile: '/tmp/existing.jsonl', sessionId: 'saved' });
  assert.equal(manager.list()[0].sessionFile, null);
  assert.equal(manager.findSession({ file: '/tmp/existing.jsonl', id: 'saved', cwd: '/tmp' }), undefined);
  assert.throws(() => manager.start({ id: 'p', path: '/tmp' }, { ephemeral: true, sessionFile: '/tmp/saved.jsonl' }), /临时会话/);
  assert.throws(() => manager.start({ id: 'p', path: '/tmp' }, { ephemeral: true, kind: 'shell' }), /临时会话/);
});
test('自定义 session-id 可以跨项目重复；同 ID 的不同文件不能被误当成已有标签', t => {
  const { manager } = fake(t);
  const a = manager.start({ id: 'a', path: '/tmp' }, { sessionId: 'daily', sessionFile: '/tmp/a.jsonl' });
  const b = manager.start({ id: 'b', path: '/var' }, { sessionId: 'daily', sessionFile: '/var/b.jsonl' });
  const copy = manager.start({ id: 'a', path: '/tmp' }, { sessionId: 'daily', sessionFile: '/tmp/copy.jsonl' });
  assert.equal(new Set([a.id, b.id, copy.id]).size, 3);
});
test('关闭一个标签不会停止其他标签，结束的标签从注册表释放', async t => {
  const { manager } = fake(t); const p = { id: 'p', path: '/tmp' };
  const a = manager.start(p), b = manager.start(p);
  await Promise.all([manager.stop(a.id), manager.stop(a.id)]);
  assert.equal(manager.list().length, 1); assert.equal(manager.list()[0].id, b.id);
  assert(!manager.records.has(a.id));
});
test('旧运行 ID 的输入、状态、ACK 不会进入新标签', t => {
  const { manager, processes } = fake(t); const s = manager.start({ id: 'p', path: '/tmp' });
  manager.write(s.id, 'old', 'wrong'); manager.report(s.id, 'old', 'error', 'wrong');
  assert.deepEqual(processes[0].writes, []); assert.equal(manager.list()[0].status, 'running');
});
test('后台输出背压：超过阈值暂停，正确解析确认后恢复', t => {
  const { manager, processes } = fake(t); const s = manager.start({ id: 'p', path: '/tmp' });
  processes[0].data('x'.repeat(300 * 1024)); assert.equal(processes[0].pauses, 1);
  manager.acknowledge(s.id, 'old', 300 * 1024); assert.equal(processes[0].resumes, 0);
  manager.acknowledge(s.id, s.runId, 300 * 1024); assert.equal(processes[0].resumes, 1);
});
test('GUI 桥接校验 token/cwd，允许 /new、/resume 后同步真实会话身份', t => {
  const { manager, metadata, processes } = fake(t); const s = manager.start({ id: 'p', path: '/tmp' });
  metadata(0, { token: 'wrong', name: 'bad' }); assert.equal(manager.list()[0].bridgeReady, false);
  metadata(0, { cwd: '/different', name: 'bad' }); assert.equal(manager.list()[0].bridgeReady, false);
  metadata(0, { sessionId: 'next-session', sessionFile: '/tmp/next.jsonl', name: '真实名称' });
  const current = manager.list()[0];
  assert.equal(current.sessionId, 'next-session'); assert.equal(current.label, '真实名称');
  assert(manager.findSession({ id: 'next-session', file: '/tmp/next.jsonl' }));
  assert.equal(processes.length, 1); assert.equal(current.id, s.id);
});
test('桥接可处理拆包/合包，忽略伪造包，未完成载荷有上限', () => {
  const seen = [], decoder = new FrameDecoder('token', value => seen.push(value));
  const raw = frame(7502, { token: 'token', name: '中文' });
  decoder.feed('normal output' + raw.slice(0, 12)); decoder.feed(raw.slice(12) + frame(7502, { token: 'wrong' }));
  assert.equal(seen.length, 1); assert.equal(seen[0].name, '中文');
  decoder.feed('\x1b]7502;' + 'x'.repeat(40000)); assert(decoder.pending.length < 32768);
});
test('运行中重命名/主题命令使用独立 OSC，不插入编辑器回车或 /name 文本', async t => {
  const { manager, metadata, processes } = fake(t); const s = manager.start({ id: 'p', path: '/tmp' });
  const base = metadata(0);
  const result = manager.control(s.id, 'rename', { name: '新名字' });
  const raw = processes[0].writes.at(-1);
  assert(raw.startsWith('\x1b]7503;')); assert(!raw.includes('/name')); assert(!raw.includes('\r'));
  const command = JSON.parse(Buffer.from(raw.slice(raw.indexOf(';') + 1, -2), 'base64').toString());
  processes[0].data(frame(7502, { ...base, requestId: command.requestId, ok: true, name: '新名字' }));
  assert.equal((await result).label, '新名字');
});
test('pi update 不会在其他终端运行时启动；调用的是固定官方命令', async t => {
  const { manager, calls, processes } = fake(t); const s = manager.start({ id: 'p', path: '/tmp' }, { kind: 'shell' });
  assert.throws(() => manager.start(null, { kind: 'update' }), /先关闭/);
  await manager.stop(s.id);
  const update = manager.start(null, { kind: 'update' });
  assert.equal(calls.at(-1)[1][1], 'exec pi update --self');
  assert.equal(update.updateTarget, 'self');
  assert.throws(() => manager.start({ id: 'p', path: '/tmp' }), /正在更新/);
  processes.at(-1).data('some log'); assert.equal(manager.updateLog().output, 'some log');
  processes.at(-1).exit({ exitCode: 0 }); assert.equal(manager.updateLog().state.running, false);
  assert.equal(manager.updateLog().state.id, update.id);
});
test('插件与全部更新使用官方扩展参数，拒绝未知更新目标', async t => {
  const { manager, calls } = fake(t);
  manager.start(null, { kind: 'update', updateTarget: 'extensions' });
  assert.equal(calls.at(-1)[1][1], 'exec pi update --extensions');
  await manager.stopAll();
  manager.start(null, { kind: 'update', updateTarget: 'all' });
  assert.equal(calls.at(-1)[1][1], 'exec pi update --all');
  assert.throws(() => manager.start(null, { kind: 'update', updateTarget: 'other' }), /更新类型/);
});
test('更新日志有上限；更新有超时出口而不是自动重试循环', async t => {
  const { manager, processes } = fake(t, { updateTimeoutMs: 15 });
  manager.start(null, { kind: 'update' });
  processes[0].data('x'.repeat(200 * 1024));
  assert.equal(manager.updateLog().output.length, 128 * 1024);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(manager.updateLog().state.running, false);
  assert.match(manager.updateLog().state.message, /中止/);
});
test('父 Pi 身份和 iTerm 标记不泄漏到子终端，用户凭据仍可用', () => {
  const env = terminalEnvironment({ PATH: '/usr/bin', PI_SESSION_ID: 'old', PI_MODEL: 'old', PI_GUI_BRIDGE_TOKEN: 'old', ITERM_SESSION_ID: 'old', DEMO_API_KEY: 'dummy' });
  assert.equal(env.PI_SESSION_ID, undefined); assert.equal(env.PI_MODEL, undefined);
  assert.equal(env.PI_GUI_BRIDGE_TOKEN, undefined); assert.equal(env.ITERM_SESSION_ID, undefined);
  assert.equal(env.DEMO_API_KEY, 'dummy');
  assert.deepEqual(dimensions(10000, -1), { cols: 500, rows: 1 });
  assert.throws(() => dimensions(NaN, 10), /尺寸/);
});
test('关闭当前 Pi 返回上次访问的标签，最后一个 Pi 退出才回到历史并清理访问记录', () => {
  const state = new WorkspaceState();
  const a = { id: 'a', projectId: 'p', kind: 'pi', running: true };
  const b = { ...a, id: 'b' };
  state.apply(a); state.apply(b);
  state.apply({ ...b, running: false });
  assert.equal(state.activeId('p'), 'a'); assert.equal(state.list('p', 'pi').length, 1);
  state.apply({ ...a, running: false });
  assert.equal(state.activeId('p'), 'history'); assert.equal(state.tabVisits.has('p'), false);
});
test('关闭时按访问顺序而非标签排列回退，连续关闭跳过已关闭标签', () => {
  const state = new WorkspaceState();
  const terminals = ['a','b','c','d'].map(id=>({id,projectId:'p',kind:'pi',running:true}));
  terminals.forEach(terminal=>state.apply(terminal));
  state.activate('b'); state.activate('a'); state.activate('c');
  state.apply({...terminals[2],running:false});
  assert.equal(state.activeId('p'),'a','previously visited tab wins over adjacent b or d');
  state.apply({...terminals[0],running:false});
  assert.equal(state.activeId('p'),'b');
  state.apply({...terminals[1],running:false});
  assert.equal(state.activeId('p'),'d');
  assert.deepEqual(state.tabVisits.get('p'),['history','d']);
});
test('上次访问历史时回到历史，关闭后台 Pi 不切换当前标签或其他项目', () => {
  const state = new WorkspaceState();
  const a = {id:'a',projectId:'p',kind:'pi',running:true};
  const b = {...a,id:'b'}, other = {...a,id:'other',projectId:'q'};
  state.apply(a); state.apply(b); state.apply(other);
  state.showHistory('p'); state.activate('b');
  state.apply({...b,running:false});
  assert.equal(state.activeId('p'),'history','history is a real visited tab even with another Pi alive');
  state.activate('a'); state.apply(b);
  state.activate('a'); state.apply({...b,running:false});
  assert.equal(state.activeId('p'),'a','background exit does not change the active tab');
  assert.equal(state.activeId('q'),'other');
});
test('快捷键切换进入同一访问记录，重复状态快照不改变顺序或无限增长', () => {
  const state = new WorkspaceState();
  const a = {id:'a',projectId:'p',kind:'pi',running:true}, b = {...a,id:'b'};
  state.apply(a); state.apply(b);
  for (let i=0;i<100;i++) { state.step('p',-1); state.step('p',1); state.apply(a); state.apply(b); }
  assert.deepEqual(state.tabVisits.get('p'),['history','a','b']);
  state.apply({...b,running:false}); assert.equal(state.activeId('p'),'a');
});
test('查看完成会话清除未读蓝点，但保留完成状态；刷新或再次切换不复活蓝点', () => {
  const state = new WorkspaceState();
  const done = {id:'a',runId:'run',sessionId:'session',projectId:'p',kind:'pi',running:true,status:'done'};
  state.apply(done); assert(state.unreadCompletions.has('a'));
  state.activate('a');
  assert.equal(state.unreadCompletions.has('a'),false);
  assert.equal(state.terminals.get('a').status,'done');
  state.showHistory('p'); state.apply({...done,message:'metadata refresh'});
  assert.equal(state.unreadCompletions.has('a'),false);
  state.activate('a'); state.apply(done);
  assert.equal(state.unreadCompletions.has('a'),false);
  state.apply({...done,status:'working'}); state.apply(done);
  assert(state.unreadCompletions.has('a'),'a new completion can be unread again');
});
test('完成标识按会话独立确认，退出或新任务开始时释放，运行和会话身份变更不会复用旧确认', () => {
  const state = new WorkspaceState();
  const done = {id:'a',runId:'run',sessionId:'session',projectId:'p',kind:'pi',running:true,status:'done'};
  state.apply(done); state.apply({...done,id:'b'});
  state.acknowledgeCompletion('a');
  assert.deepEqual([...state.unreadCompletions],['b']);
  state.apply({...done,id:'b',status:'working'});
  assert.equal(state.unreadCompletions.size,0);
  state.apply({...done,sessionId:'new-session'});
  assert(state.unreadCompletions.has('a'));
  state.acknowledgeCompletion('a'); state.apply({...done,runId:'new-run'});
  assert(state.unreadCompletions.has('a'));
  state.apply({...done,running:false});
  assert.equal(state.unreadCompletions.size,0);
});
test('Pi 主标签：切换不关进程，关闭当前标签返回最近访问项', () => {
  const state = new WorkspaceState();
  const first = { id:'pi-one', projectId:'p', kind:'pi', running:true };
  const second = { id:'pi-two', projectId:'p', kind:'pi', running:true };
  state.apply(first); state.apply(second);
  assert.equal(state.activeId('p'),'pi-two','new Pi occupies the main workspace');
  assert.deepEqual(state.list('p').map(item=>item.id),['pi-one','pi-two']);
  state.activate('pi-one'); assert.equal(state.list('p').length,2,'switching away keeps the other Pi process');
  state.step('p',1); assert.equal(state.activeId('p'),'pi-two','keyboard navigation includes open Pi tabs');
  state.showHistory('p'); state.activate('pi-two');
  state.apply({...second,running:false});
  assert.equal(state.activeId('p'),'history','history remains a real visited tab');
  assert.equal(state.list('p').length,1);
  state.activate('pi-one');
});
test('标签切换包含历史页，跨项目记住各自当前标签', () => {
  const state = new WorkspaceState();
  state.apply({ id: 'a', projectId: 'p', kind: 'pi', running: true });
  state.apply({ id: 'b', projectId: 'q', kind: 'pi', running: true });
  state.step('p', -1); assert.equal(state.activeId('p'), 'history'); assert.equal(state.activeId('q'), 'b');
  state.step('p', 1); assert.equal(state.activeId('p'), 'a');
});
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
test('亮暗终端的正文及主要静态配色有足够对比度', () => {
  for (const mode of ['light', 'dark']) {
    const bg = luminance(palettes[mode].background), fg = luminance(palettes[mode].foreground);
    assert((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) >= 4.5);
  }
});
