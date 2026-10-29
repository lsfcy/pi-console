const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { SessionStore } = require('../build/main/session-store.cjs');

function state() {
  return { id: '11111111-1111-4111-8111-111111111111', runId: 'run', projectId: 'p', cwd: '/tmp',
    kind: 'pi', pid: 123, running: true, status: 'idle', message: '', sessionFile: null, sessionKey: null,
    sessionId: 'session', bridgeReady: true, appearance: 'dark', cols: 80, rows: 24,
    updateTarget: null, label: '会话', startedAt: 1, ephemeral: false };
}
test('会话状态持久化、读取、清理与无效文件剔除', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = new EventEmitter();
  const item = state();
  manager.list = () => [item];
  manager.relayInfo = () => ({ token: 'token', socketPath: '/tmp/' + item.id + '.sock' });
  manager.adopt = () => item;
  const store = new SessionStore(dir, manager);
  store.start();
  t.after(() => store.stop());
  manager.emit('state', item);
  await new Promise(resolve => setTimeout(resolve, 300));
  const file = path.join(dir, item.id + '.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.token, 'token');
  assert.equal(saved.socketPath, '/tmp/' + item.id + '.sock');
  assert.equal(saved.bridgeReady, false);
  const entries = store.read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, item.id);
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  assert.equal(store.read().length, 1, 'invalid entries are removed');
  manager.emit('state', { ...item, running: false });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(file), false, 'exited sessions remove their record');
  store.clear();
  assert.deepEqual(fs.readdirSync(dir), []);
});
