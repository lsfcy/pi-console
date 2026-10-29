const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSessionController } = require('../build/main/session-controller.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = { id: 'p', path: root }, info = { file: path.join(root, 'source.jsonl'), id: 'source', key: 'key', title: '原会话' };
  fs.writeFileSync(info.file, 'original bytes');
  const calls = [], state = { owner: null, lookup: async () => info };
  const controller = createSessionController({
    projects: { get: () => ({ ...project }), preferences: () => ({ confirmResume: true }) },
    terminals: { findSession: () => state.owner, sessionBusy: () => state.owner, start: (p, options) => { calls.push({ p, options }); return { id: 'fork' }; } },
    catalog: { lookup: (...args) => state.lookup(...args) },
    confirm: async () => { throw new Error('分叉不应要求原会话的恢复确认'); },
    refreshLibrary: async () => ({}), appearance: () => 'light'
  });
  return { controller, state, project, info, calls };
}
test('分叉已打开/已关闭的历史都启动新标签，不走恢复去重，不改源文件', async t => {
  const f = fixture(t);
  for (const owner of [null, { id: 'original', bridgeReady: true, status: 'idle' }, { id: 'original', bridgeReady: true, status: 'done' }]) {
    f.state.owner = owner;
    assert.equal((await f.controller.createPi('p', { resume: false, sessionKey: 'key', fork: true })).id, 'fork');
    const { options } = f.calls.at(-1);
    assert.equal(options.forkFile, f.info.file); assert.equal(options.label, '原会话 · 分叉');
    assert.equal(options.sessionFile, undefined); assert.equal(options.sessionId, undefined);
    assert.equal(fs.readFileSync(f.info.file, 'utf8'), 'original bytes');
  }
});
test('分叉校验布尔值、历史身份与任务状态，失败不启动标签', async t => {
  const f = fixture(t);
  for (const options of [{ resume: false, fork: 'true' }, { resume: false, fork: true },
    { resume: true, fork: true, sessionKey: 'key' }, { resume: false, ephemeral: true, fork: true, sessionKey: 'key' }])
    await assert.rejects(f.controller.createPi('p', options), /分叉/);
  for (const status of ['working', 'blocked', 'running', 'stopping']) {
    f.state.owner = { bridgeReady: true, status };
    await assert.rejects(f.controller.createPi('p', { resume: false, fork: true, sessionKey: 'key' }), /任务结束/);
  }
  f.state.owner = { bridgeReady: false, status: 'idle' };
  await assert.rejects(f.controller.createPi('p', { resume: false, fork: true, sessionKey: 'key' }), /任务结束/);
  f.state.owner = null; f.state.lookup = async () => null;
  await assert.rejects(f.controller.createPi('p', { resume: false, fork: true, sessionKey: 'key' }), /未找到/);
  assert.equal(f.calls.length, 0);
});
test('历史校验期间目录变更时拒绝跨目录分叉', async t => {
  const f = fixture(t);
  f.state.lookup = async () => { f.project.path = os.tmpdir(); return f.info; };
  await assert.rejects(f.controller.createPi('p', { resume: false, fork: true, sessionKey: 'key' }), /目录已变更/);
  assert.equal(f.calls.length, 0);
});
