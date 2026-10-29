const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectStore } = require('../build/main/project-store.cjs');
const { descendantGroups } = require('../build/main/process-tree.cjs');
const { modifiedEnter, parseProgramStatus } = require('../build/shared/terminal-utils.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, '项目 alpha'); const b = path.join(root, 'beta');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const file = path.join(root, 'config', 'projects.json');
  return { root, a, b, file, store: new ProjectStore(file) };
}
test('项目持久化支持中文/空格，符号链接去重，文件只对当前用户可读写', t => {
  const { root, a, file, store } = fixture(t);
  const alias = path.join(root, 'alias'); fs.symlinkSync(a, alias);
  const first = store.add(a); assert.equal(store.add(alias).id, first.id);
  assert.equal(new ProjectStore(file).snapshot().projects.length, 1);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test('隐藏只修改 GUI 配置，不删除项目；手动添加可恢复', t => {
  const { a, store } = fixture(t); const first = store.add(a);
  store.remove(first.id); store.synchronize([a]); assert.equal(store.snapshot().projects.length, 0);
  assert(fs.existsSync(a)); store.add(a); assert.equal(store.snapshot().projects.length, 1);
  assert.throws(() => store.select('missing'), /不存在/);
});
test('损坏的项目配置不会被静默覆盖', t => {
  const { file } = fixture(t);
  fs.mkdirSync(path.dirname(file)); const value = '{"version":42,"projects":[]}'; fs.writeFileSync(file, value);
  assert.throws(() => new ProjectStore(file), /无效/); assert.equal(fs.readFileSync(file, 'utf8'), value);
});
test('排序是完整置换，刷新追加新项目不打乱已有顺序', t => {
  const { a, b, root, store, file } = fixture(t);
  const one = store.add(a), two = store.add(b);
  store.reorder([two.id, one.id]);
  const extra = path.join(root, 'extra'); fs.mkdirSync(extra);
  store.synchronize([a, b, extra]);
  assert.deepEqual(store.snapshot().projects.slice(0, 2).map(p => p.id), [two.id, one.id]);
  assert.deepEqual(new ProjectStore(file).snapshot().projects.slice(0, 2).map(p => p.id), [two.id, one.id]);
  assert.throws(() => store.reorder([one.id, one.id, two.id]), /顺序/);
  assert.throws(() => store.reorder([one.id]), /顺序/);
  store.move(one.id, -1); assert.equal(store.snapshot().projects[0].id, one.id);
});
test('编辑项目名称保留身份、顺序和选中状态，自动发现的项目改名后不丢失', t => {
  const { a, b, store, file } = fixture(t);
  store.synchronize([a, b]);
  const first = store.snapshot().projects[0], second = store.snapshot().projects[1];
  store.select(second.id);
  store.update(first.id, { name: '  自定义名称  ' });
  assert.equal(store.get(first.id).name, '自定义名称');
  assert.equal(store.get(first.id).source, 'manual');
  assert.equal(store.snapshot().selectedId, second.id);
  assert.deepEqual(store.snapshot().projects.map(p => p.id), [first.id, second.id]);
  store.synchronize([b]);
  assert.equal(new ProjectStore(file).get(first.id).name, '自定义名称');
});
test('改目录仅修改配置，旧目录不自动重新出现，也可显式添加恢复', t => {
  const { root, a, store, file } = fixture(t);
  const nextDirectory = path.join(root, '新的目录'); fs.mkdirSync(nextDirectory);
  const first = store.add(a);
  fs.writeFileSync(path.join(a, 'keep.txt'), 'untouched');
  store.update(first.id, { name: '保留身份', path: nextDirectory });
  assert.equal(store.get(first.id).path, fs.realpathSync(nextDirectory));
  assert.equal(store.snapshot().selectedId, first.id);
  store.synchronize([a, nextDirectory]);
  assert.equal(store.snapshot().projects.length, 1);
  assert.equal(fs.readFileSync(path.join(a, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(new ProjectStore(file).get(first.id).name, '保留身份');
  store.add(a);
  assert.equal(store.snapshot().projects.length, 2);
});
test('编辑校验名称、目录和符号链接去重，失败不会部分保存', t => {
  const { root, a, b, store, file } = fixture(t);
  const first = store.add(a); store.add(b);
  const alias = path.join(root, 'alias'); fs.symlinkSync(b, alias);
  const plainFile = path.join(root, 'not-directory'); fs.writeFileSync(plainFile, 'file');
  const before = fs.readFileSync(file, 'utf8');
  for (const patch of [{}, [], {name:''}, {name:'x'.repeat(161)}, {name:'bad\nname'}, {source:'manual'},
    {path:'relative'}, {path:path.join(root,'missing')}, {path:plainFile}, {path:alias}, {path:b}]) {
    assert.throws(() => store.update(first.id, patch));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});
test('可修正目录不存在的项目名称，同一路径不会隐藏其历史', t => {
  const { a, store } = fixture(t); const first = store.add(a);
  fs.rmdirSync(a);
  store.update(first.id, { name: '待恢复目录', path: first.path });
  assert.equal(store.get(first.id).name, '待恢复目录');
  assert.equal(store.snapshot().hiddenPaths, undefined);
});
test('亮暗色/字号/布局设置有边界且持久化，不改 Pi 配置', t => {
  const { store, file } = fixture(t);
  assert.equal(store.preferences().workspaceTheme, 'system');
  assert.equal(store.preferences().confirmClose, false);
  assert.equal(store.preferences().language, 'zh-CN');
  assert.equal(store.preferences().checkAppUpdates, true);
  store.setPreferences({ checkAppUpdates: false });
  assert.equal(new ProjectStore(file).preferences().checkAppUpdates, false);
  assert.throws(() => store.setPreferences({ checkAppUpdates: 'yes' }), /范围/);
  store.setPreferences({ sidebarTheme: 'light', workspaceTheme: 'dark', fontSize: 15, sidebarWidth: 330, historyLayout: 'list', cardColumns: 2, confirmResume: false, confirmClose: true, completionSound: false, completionNotice: false, sidebarCollapsed: true });
  assert.equal(new ProjectStore(file).preferences().workspaceTheme, 'dark');
  assert.equal(new ProjectStore(file).preferences().sidebarTheme, 'light');
  assert.equal(new ProjectStore(file).preferences().confirmClose, true);
  assert.equal(new ProjectStore(file).preferences().completionSound, false);
  assert.equal(new ProjectStore(file).preferences().sidebarCollapsed, true);
  store.setPreferences({ language: 'en-US' });
  assert.equal(new ProjectStore(file).preferences().language, 'en-US');
  store.setPreferences({ language: 'zh-CN' });
  assert.throws(() => store.setPreferences({ workspaceTheme: 'unsafe' }), /范围/);
  assert.throws(() => store.setPreferences({ language: 'fr-FR' }), /范围/);
  assert.throws(() => store.setPreferences({ fontSize: 100 }), /范围/);
  assert.throws(() => store.setPreferences({ command: 'exec something' }), /设置/);
});
test('旧单主题配置只在归一化边界迁移，后续存储不保留重复主题字段', t => {
  const { store, file } = fixture(t);
  store.save({ ...store.snapshot(), preferences: { theme: 'dark', fontSize: 16 } });
  assert.equal(store.preferences().sidebarTheme, 'dark'); assert.equal(store.preferences().workspaceTheme, 'dark');
  store.setPreferences({ workspaceTheme: 'light' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).preferences;
  assert.equal(saved.theme, undefined); assert.equal(saved.sidebarTheme, 'dark'); assert.equal(saved.workspaceTheme, 'light');
});
test('手动未读按项目与会话持久化，重复设置幂等，已读后删除空配置', t => {
  const { a, b, store, file } = fixture(t);
  const alpha = store.add(a), beta = store.add(b);
  store.setSessionUnread(alpha.id, 'same-session', true);
  store.setSessionUnread(beta.id, 'same-session', true);
  store.setSessionUnread(alpha.id, 'same-session', true);
  assert.equal(store.snapshot().unreadSessions.length, 2);
  const reloaded = new ProjectStore(file);
  assert(reloaded.isSessionUnread(alpha.id, 'same-session'));
  assert(reloaded.isSessionUnread(beta.id, 'same-session'));
  reloaded.setSessionUnread(alpha.id, 'same-session', false);
  assert.equal(reloaded.isSessionUnread(alpha.id, 'same-session'), false);
  assert(reloaded.isSessionUnread(beta.id, 'same-session'));
  reloaded.setSessionUnread(beta.id, 'same-session', false);
  assert.equal(reloaded.snapshot().unreadSessions, undefined);
  assert.equal(new ProjectStore(file).snapshot().unreadSessions, undefined);
});
test('未读清理覆盖会话消失、项目隐藏与改目录，但项目改名不丢标记', t => {
  const { a, b, root, store } = fixture(t);
  const alpha = store.add(a), beta = store.add(b);
  store.setSessionUnread(alpha.id, 'keep', true); store.setSessionUnread(alpha.id, 'deleted', true);
  store.setSessionUnread(beta.id, 'keep', true);
  store.retainUnreadSessions([{ projectId: alpha.id, sessionKey: 'keep' }, { projectId: beta.id, sessionKey: 'keep' }]);
  assert.equal(store.snapshot().unreadSessions.length, 2);
  store.update(alpha.id, { name: '新名称' }); assert(store.isSessionUnread(alpha.id, 'keep'));
  const destination = path.join(root, 'destination'); fs.mkdirSync(destination);
  store.update(alpha.id, { path: destination }); assert.equal(store.isSessionUnread(alpha.id, 'keep'), false);
  assert(store.isSessionUnread(beta.id, 'keep'));
  store.remove(beta.id); assert.equal(store.snapshot().unreadSessions, undefined);
});
test('未读参数与损坏配置严格校验，失败不写入', t => {
  const { a, store, file } = fixture(t); const project = store.add(a);
  const before = fs.readFileSync(file, 'utf8');
  for (const [id, session, value] of [[project.id, '', true], [project.id, 'bad\nvalue', true], [project.id, 'ok', 'true'], ['missing', 'ok', true]]) {
    assert.throws(() => store.setSessionUnread(id, session, value));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
  for (const unreadSessions of ['invalid', [null], [{ projectId: project.id, sessionKey: '\\x1b' }]]) {
    const broken = JSON.stringify({ ...store.snapshot(), unreadSessions }); fs.writeFileSync(file, broken);
    assert.throws(() => new ProjectStore(file), /未读配置格式无效/);
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
  }
});
test('会话收藏与项目置顶独立持久化，以项目和文件键隔离，全部取消后删除空配置', t => {
  const { a, b, store, file } = fixture(t), alpha = store.add(a), beta = store.add(b);
  for (const kind of ['favorite','pinned']) store.setSessionMark(alpha.id,'same-key',kind,true);
  store.setSessionMark(beta.id,'same-key','favorite',true);
  store.setSessionMark(alpha.id,'different-file','favorite',true);
  const saved = fs.readFileSync(file,'utf8'); store.setSessionMark(alpha.id,'same-key','favorite',true);
  assert.equal(fs.readFileSync(file,'utf8'),saved,'duplicate marks are idempotent');
  const reloaded = new ProjectStore(file);
  assert.equal(reloaded.snapshot().sessionMarks.length,3);
  reloaded.setSessionMark(alpha.id,'same-key','favorite',false);
  assert.deepEqual(reloaded.snapshot().sessionMarks.find(ref=>ref.projectId===alpha.id&&ref.sessionKey==='same-key'),{projectId:alpha.id,sessionKey:'same-key',pinned:true});
  assert(reloaded.snapshot().sessionMarks.find(ref=>ref.projectId===beta.id).favorite);
  for (const ref of reloaded.snapshot().sessionMarks) for (const kind of ['favorite','pinned']) reloaded.setSessionMark(ref.projectId,ref.sessionKey,kind,false);
  assert.equal(reloaded.snapshot().sessionMarks,undefined);
  assert.equal(new ProjectStore(file).snapshot().sessionMarks,undefined);
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
});
test('收藏/置顶清理覆盖历史删除、隐藏和目录替换，重命名与其他项目不受影响', t => {
  const { a, b, root, store } = fixture(t), alpha=store.add(a), beta=store.add(b);
  store.setSessionMark(alpha.id,'keep','favorite',true); store.setSessionMark(alpha.id,'gone','pinned',true);
  store.setSessionMark(beta.id,'keep','favorite',true);
  store.retainSessionMarks([{projectId:alpha.id,sessionKey:'keep'},{projectId:beta.id,sessionKey:'keep'}]);
  assert.equal(store.snapshot().sessionMarks.length,2);
  store.update(alpha.id,{name:'新名称'}); assert.equal(store.snapshot().sessionMarks.length,2);
  const destination=path.join(root,'destination');fs.mkdirSync(destination);store.update(alpha.id,{path:destination});
  assert.deepEqual(store.snapshot().sessionMarks,[{projectId:beta.id,sessionKey:'keep',favorite:true}]);
  store.remove(beta.id);assert.equal(store.snapshot().sessionMarks,undefined);
});
test('收藏与项目置顶互相独立，旧 globalPinned 迁移为收藏并保留项目置顶', t => {
  const { a, store, file } = fixture(t), project = store.add(a);
  store.setSessionMark(project.id,'only-pin','pinned',true);
  store.setSessionMark(project.id,'only-pin','favorite',false);
  assert.deepEqual(store.snapshot().sessionMarks,[{projectId:project.id,sessionKey:'only-pin',pinned:true}],'关闭未启用的收藏不误删项目置顶');
  store.setSessionMark(project.id,'key','favorite',true);
  store.setSessionMark(project.id,'key','pinned',true);
  assert.deepEqual(store.snapshot().sessionMarks.find(ref=>ref.sessionKey==='key'),{projectId:project.id,sessionKey:'key',favorite:true,pinned:true});
  store.setSessionMark(project.id,'key','pinned',false);
  assert.deepEqual(store.snapshot().sessionMarks.find(ref=>ref.sessionKey==='key'),{projectId:project.id,sessionKey:'key',favorite:true},'取消项目置顶不撤销收藏');
  store.setSessionMark(project.id,'key','favorite',false);
  assert.equal(store.snapshot().sessionMarks.find(ref=>ref.sessionKey==='key'),undefined);
  fs.writeFileSync(file, JSON.stringify({ ...store.snapshot(), sessionMarks: [{ projectId: project.id, sessionKey: 'legacy', globalPinned: true }] }));
  const migrated = new ProjectStore(file);
  assert.deepEqual(migrated.snapshot().sessionMarks, [{ projectId: project.id, sessionKey: 'legacy', favorite: true, pinned: true }]);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).sessionMarks[0].globalPinned, undefined, 'migration removes the legacy field');
});
test('项目置顶不改手动顺序，分组内移动、刷新和重启保留，取消后移除标记', t => {
  const { a, b, root, store, file }=fixture(t), extra=path.join(root,'extra');fs.mkdirSync(extra);
  store.synchronize([a,b,extra]);const [alpha,beta,gamma]=store.snapshot().projects;
  store.setProjectPinned(gamma.id,true);store.setProjectPinned(alpha.id,true);
  assert.deepEqual(store.snapshot().projects.map(p=>p.id),[alpha.id,beta.id,gamma.id]);
  store.move(gamma.id,-1);
  assert.deepEqual(store.snapshot().projects.map(p=>p.id),[gamma.id,beta.id,alpha.id],'movement skips the other pin group');
  store.synchronize([b]);
  assert.equal(new ProjectStore(file).get(gamma.id).pinned,true,'pinned auto project is retained even without history');
  store.setProjectPinned(gamma.id,false);assert.equal(new ProjectStore(file).get(gamma.id).pinned,undefined);
  assert.throws(()=>store.setProjectPinned(beta.id,'true'),/无效/);
});
test('收藏/置顶严格校验参数与损坏配置，拒绝未知字段、空标记与重复身份', t => {
  const {a,store,file}=fixture(t),project=store.add(a),before=fs.readFileSync(file,'utf8');
  for(const args of [[project.id,'','favorite',true],[project.id,'bad\nkey','favorite',true],[project.id,'ok','unknown',true],[project.id,'ok','globalPinned',true],[project.id,'ok','favorite','true'],['missing','ok','favorite',true]]) {
    assert.throws(()=>store.setSessionMark(...args));assert.equal(fs.readFileSync(file,'utf8'),before);
  }
  const valid={projectId:project.id,sessionKey:'ok',favorite:true};
  for(const sessionMarks of ['invalid',[null],[{...valid,favorite:false}],[{...valid,unknown:true}],[{projectId:project.id,sessionKey:'empty'}],[valid,valid]]) {
    const broken=JSON.stringify({...store.snapshot(),sessionMarks});fs.writeFileSync(file,broken);
    assert.throws(()=>new ProjectStore(file),/收藏\/置顶配置格式无效/);assert.equal(fs.readFileSync(file,'utf8'),broken);
  }
  fs.writeFileSync(file,JSON.stringify({...store.snapshot(),projects:[{...project,pinned:'true'}]}));
  assert.throws(()=>new ProjectStore(file),/项目配置格式无效/);
});
test('Shift/Alt/Ctrl+Enter 编码正确，不干扰 IME 确认', () => {
  assert.equal(modifiedEnter({ key: 'Enter', shiftKey: true }), '\x1b[13;2u');
  assert.equal(modifiedEnter({ key: 'Enter', altKey: true }), '\x1b[13;3u');
  assert.equal(modifiedEnter({ key: 'Enter', ctrlKey: true }), '\x1b[13;5u');
  assert.equal(modifiedEnter({ key: 'Enter', shiftKey: true, isComposing: true }), null);
  assert.equal(modifiedEnter({ key: 'Enter' }), null);
});
test('OSC 7501 支持中文与损坏的可选消息，不把未知状态当运行状态', () => {
  const message = Buffer.from('等待确认：测试').toString('base64');
  assert.deepEqual(parseProgramStatus('state=blocked:app=pi:msg=' + message), { status: 'blocked', message: '等待确认：测试' });
  assert.deepEqual(parseProgramStatus('state=error:msg=%%%'), { status: 'error', message: '' });
  assert.equal(parseProgramStatus('state=clear'), null);
});
test('进程树仅选择目标 Pi 的进程组，不误杀 GUI 或其他标签', () => {
  const output = ['10 1 10', '20 10 20', '21 20 20', '22 20 22', '23 22 22', '30 10 30', '40 10 10'].join('\n');
  assert.deepEqual(descendantGroups(output, 20), { groups: [20, 22], individuals: [] });
  assert.deepEqual(descendantGroups(output, 40), { groups: [], individuals: [40] });
});
