const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { renameClosedSession, validateName } = require('../build/main/session-actions.cjs');
const { ITERM_SCRIPT } = require('../build/main/desktop-integration.cjs');
function fixture(t, tail, version = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-actions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, JSON.stringify({ type: 'session', version, id: 'session', cwd: root }) + '\n' + tail);
  return { file, id: 'session' };
}
test('关闭会话重命名只追加标准 session_info，原对话字节保持不变，父节点正确', t => {
  const info = fixture(t, JSON.stringify({ type: 'message', id: 'leaf', parentId: null, message: { role: 'user', content: '原始对话' } }) + '\n');
  const before = fs.readFileSync(info.file);
  renameClosedSession(info, '新的名称');
  const after = fs.readFileSync(info.file);
  assert(after.subarray(0, before.length).equals(before));
  const last = JSON.parse(after.toString().trimEnd().split('\n').at(-1));
  assert.equal(last.type, 'session_info'); assert.equal(last.parentId, 'leaf'); assert.equal(last.name, '新的名称');
});
test('有效但未带换行的末条记录可重命名；损坏末行拒绝且不修改文件', t => {
  const info = fixture(t, JSON.stringify({ type: 'session_info', id: 'name', parentId: null, name: 'old' }));
  renameClosedSession(info, 'new'); assert(fs.readFileSync(info.file, 'utf8').includes('"name":"new"'));
  fs.appendFileSync(info.file, '{"incomplete":');
  const before = fs.readFileSync(info.file);
  assert.throws(() => renameClosedSession(info, 'bad'), /不完整/);
  assert(fs.readFileSync(info.file).equals(before));
});
test('磁盘短写时撤销本次追加，原对话不会留下损坏半行', t => {
  const info = fixture(t, JSON.stringify({ type: 'session_info', id: 'leaf', name: 'old' }) + '\n');
  const before = fs.readFileSync(info.file);
  const original = fs.writeSync;
  fs.writeSync = (fd, buffer, offset, length, position) => original(fd, buffer, offset, Math.floor(length / 2), position);
  try { assert.throws(() => renameClosedSession(info, 'new'), /不完整/); }
  finally { fs.writeSync = original; }
  assert(fs.readFileSync(info.file).equals(before));
});
test('旧版/已替换会话拒绝直接改写，名称长度与控制字符受控', t => {
  const info = fixture(t, '', 1);
  assert.throws(() => renameClosedSession(info, 'new'), /旧版/);
  assert.equal(validateName(' hello\nworld '), 'hello world');
  assert.throws(() => validateName(''), /字符/); assert.throws(() => validateName('x'.repeat(161)), /字符/);
});
test('收藏/置顶等待历史校验期间项目目录变更，拒绝把旧会话标记写入新目录', async () => {
  const {createSessionController}=require('../build/main/session-controller.cjs');
  let project={id:'p',path:'/old'}, resume, ready;
  const waiting=new Promise(resolve=>{ready=resolve;}), barrier=new Promise(resolve=>{resume=resolve;}), writes=[];
  const {setSessionMark}=createSessionController({
    projects:{get:()=>({...project}),setSessionMark:(...args)=>writes.push(args)},
    catalog:{lookup:async()=>{ready();await barrier;return {file:'/old/session.jsonl',key:'key'};}},
    refreshLibrary:async()=>{},snapshot:()=>({}),publishProjects:()=>{}
  });
  const pending=setSessionMark('p','key','favorite',true);
  await waiting;project.path='/new';resume();
  await assert.rejects(pending,/项目目录已变更/);assert.deepEqual(writes,[]);
});
test('外部 iTerm AppleScript 固定脚本，目录通过 argv 与 quoted form 传递', () => {
  assert(ITERM_SCRIPT.includes('item 1 of argv')); assert(ITERM_SCRIPT.includes('quoted form of workDir'));
  assert(!ITERM_SCRIPT.includes('/Users/'));
});
