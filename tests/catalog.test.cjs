const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { SessionCatalog } = require('../build/main/session-catalog.cjs');
const { ProjectStore } = require('../build/main/project-store.cjs');
const { TerminalManager } = require('../build/main/terminal-manager.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agent = path.join(root, 'agent');
  fs.mkdirSync(agent);
  const cwd = path.join(root, '项目 with spaces');
  fs.mkdirSync(cwd);
  const catalog = new SessionCatalog({ env: { PI_CODING_AGENT_DIR: agent } });
  return { root, agent, cwd, catalog };
}
function writeSession(file, cwd, id, entries = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { type: 'session', version: 3, id, cwd, timestamp: '2026-01-01T10:00:00Z' }, ...entries
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
}
const user = text => ({ type: 'message', timestamp: '2026-01-01T10:01:00Z', message: { role: 'user', content: [{ type: 'text', text }] } });
const named = name => ({ type: 'session_info', name });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('自动发现使用真实 header.cwd，不反向猜测有歧义的目录编码', async t => {
  const { root, agent, cwd, catalog } = fixture(t);
  const other = path.join(root, 'project-with-dashes');
  fs.mkdirSync(other);
  writeSession(path.join(agent, 'sessions', '--ambiguous-directory--', 'one.jsonl'), cwd, 'one', [user('中文未命名会话')]);
  writeSession(path.join(agent, 'sessions', '--ambiguous-directory--', 'two.jsonl'), other, 'two', [user('original prompt'), named('指定的会话名称')]);
  const result = await catalog.scan();
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.find(info => info.id === 'one').cwd, fs.realpathSync(cwd));
  assert.equal(result.sessions.find(info => info.id === 'one').title, '中文未命名会话');
  assert.equal(result.sessions.find(info => info.id === 'two').title, '指定的会话名称');
  assert.notEqual(result.sessions[0].key, result.sessions[1].key);
  const store = new ProjectStore(path.join(root, 'gui', 'projects.json'));
  store.synchronize(result.sessions.map(info => info.cwd));
  assert.equal(store.snapshot().projects.length, 2, 'a fresh GUI needs no manually added project');
});

test('历史扫描只读，巨型工具/图片条目不进入索引；更后面的命名仍能读取', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const file = path.join(agent, 'sessions', '--project--', 'large.jsonl');
  writeSession(file, cwd, 'large', [user('small preview'), named('中间的名字'),
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'image', data: 'X'.repeat(2 * 1024 * 1024) }] } },
    named('最后的名字')]);
  fs.appendFileSync(file, '{"type":"message","unfinished":');
  const before = hash(file);
  const result = await catalog.scan();
  assert.equal(result.sessions[0].title, '最后的名字');
  assert.equal(result.sessions[0].firstMessage, 'small preview');
  assert(JSON.stringify(result.sessions).length < 2000);
  assert.equal(hash(file), before, 'scanner must never migrate, repair, or rewrite Pi files');
});

test('恢复时追加的配置和命名元数据不改变活动排序，真实消息仍推进时间，索引保持只读', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const file = path.join(agent, 'sessions', 'activity', 'resumed.jsonl');
  writeSession(file, cwd, 'resumed', [user('原始会话内容')]);
  const original = (await catalog.scan()).sessions[0];
  assert.equal(original.modifiedAt, Date.parse('2026-01-01T10:01:00Z'));
  const metadata = [
    {type:'model_change',timestamp:'2026-10-23T10:00:00Z',provider:'anthropic',modelId:'claude-sonnet-4-6'},
    {type:'thinking_level_change',timestamp:'2026-10-23T10:01:00Z',thinkingLevel:'medium'},
    {type:'session_info',timestamp:'2026-10-23T10:02:00Z',name:'更新名称'},
    {type:'custom',timestamp:'2026-10-23T10:03:00Z',customType:'extension-state',data:{}}
  ];
  fs.appendFileSync(file,metadata.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
  const beforeScan=hash(file), resumed=(await catalog.scan()).sessions[0];
  assert.equal(resumed.modifiedAt,original.modifiedAt,'resuming/configuration changes are not conversation activity');
  assert.equal(resumed.title,'更新名称','ignoring metadata for sorting must not discard display metadata');
  assert.equal(hash(file),beforeScan,'indexing never rewrites metadata or timestamps');
  fs.appendFileSync(file,JSON.stringify({...user('真正的新消息'),timestamp:'2026-10-23T10:04:00Z'})+'\n');
  const updated=(await catalog.scan()).sessions[0];
  assert.equal(updated.modifiedAt,Date.parse('2026-10-23T10:04:00Z'));
  assert.equal(updated.stats.userMessages,2);
});
test('从 assistant usage 聚合 token、缓存、成本、轮次与工具统计，只读', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const file = path.join(agent, 'sessions', '--usage--', 'usage.jsonl');
  const usage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, reasoning: 5, totalTokens: 360,
    cost: { input: 0.001, output: 0.0005, cacheRead: 0.0002, cacheWrite: 0.0001, total: 0.0018 } };
  writeSession(file, cwd, 'usage', [
    user('统计测试'),
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }, { type: 'toolCall', name: 'bash' }],
      provider: 'test-provider', model: 'test-model', usage, stopReason: 'stop', durationMs: 1200 } },
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] } }
  ]);
  const before = hash(file);
  const info = (await catalog.scan()).sessions.find(item => item.id === 'usage');
  assert.equal(info.stats.userMessages, 1);
  assert.equal(info.stats.assistantMessages, 1);
  assert.equal(info.stats.toolCalls, 1);
  assert.equal(info.stats.toolResults, 1);
  assert.equal(info.stats.totalTokens, 360);
  assert.equal(info.stats.cacheReadTokens, 200);
  assert.equal(info.stats.contextTokens, 310);
  assert.equal(info.stats.cacheHitRate, 200 / 310);
  assert.equal(info.stats.costTotal, 0.0018);
  assert.equal(info.stats.lastModel, 'test-model');
  assert.equal(info.stats.lastProvider, 'test-provider');
  assert.equal(hash(file), before);
});

test('支持会话更名、显式清除名称、文件删除与增量缓存失效', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const file = path.join(agent, 'sessions', 'project', 'session.jsonl');
  writeSession(file, cwd, 'one', [user('fallback prompt'), named('old')]);
  assert.equal((await catalog.scan()).sessions[0].title, 'old');
  fs.appendFileSync(file, JSON.stringify(named('new')) + '\n');
  assert.equal((await catalog.scan()).sessions[0].title, 'new');
  fs.appendFileSync(file, JSON.stringify(named('')) + '\n');
  assert.equal((await catalog.scan()).sessions[0].title, 'fallback prompt');
  fs.unlinkSync(file);
  assert.equal((await catalog.scan()).sessions.length, 0);
  assert.equal(catalog.cache.size, 0);
});

test('损坏文件不阻塞正常历史，且会给出可见警告', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const group = path.join(agent, 'sessions', 'group');
  writeSession(path.join(group, 'ok.jsonl'), cwd, 'ok');
  fs.writeFileSync(path.join(group, 'bad.jsonl'), '{"type":"session","id":42,"cwd":null}\n');
  const result = await catalog.scan();
  assert.equal(result.sessions.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /跳过/);
});

test('新发现项目的 .pi/sessionDir 和全局相对 sessionDir 都按项目解析', async t => {
  const { agent, cwd, catalog } = fixture(t);
  fs.writeFileSync(path.join(agent, 'settings.json'), JSON.stringify({ sessionDir: 'global-relative' }));
  fs.mkdirSync(path.join(cwd, '.pi'));
  fs.writeFileSync(path.join(cwd, '.pi/settings.json'), JSON.stringify({ sessionDir: 'custom-history' }));
  writeSession(path.join(agent, 'sessions', 'default', 'default.jsonl'), cwd, 'default');
  writeSession(path.join(cwd, 'custom-history', 'custom.jsonl'), cwd, 'local-custom');
  writeSession(path.join(cwd, 'global-relative', 'global.jsonl'), cwd, 'global-relative');
  const result = await catalog.scan();
  assert.deepEqual(new Set(result.sessions.map(info => info.id)), new Set(['default', 'local-custom', 'global-relative']));
});

test('环境指定目录与默认历史合并去重，不扫描其他应用的会话', async t => {
  const { agent, cwd } = fixture(t);
  const extra = path.join(agent, 'extra');
  writeSession(path.join(agent, 'sessions', 'group', 'default.jsonl'), cwd, 'default');
  writeSession(path.join(extra, 'custom.jsonl'), cwd, 'custom');
  const catalog = new SessionCatalog({ env: { PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: extra } });
  const result = await catalog.scan();
  assert.equal(result.sessions.length, 2);
});

test('自动项目不会重复；隐藏后刷新不重现；手动添加可恢复，文件不删除', t => {
  const { root, cwd } = fixture(t);
  const store = new ProjectStore(path.join(root, 'projects.json'));
  store.synchronize([cwd, cwd]);
  const project = store.snapshot().projects[0];
  store.synchronize([cwd]);
  assert.equal(store.snapshot().projects[0].id, project.id);
  store.remove(project.id);
  store.synchronize([cwd]);
  assert.equal(store.snapshot().projects.length, 0);
  assert(fs.existsSync(cwd));
  assert.equal(store.add(cwd).source, 'manual');
  assert.equal(store.snapshot().projects.length, 1);
  assert.deepEqual(store.snapshot().hiddenPaths, []);
});

test('历史消失时移除纯自动项目，但保留手动项目和正在 GUI 内运行的项目', t => {
  const { root, cwd } = fixture(t);
  const store = new ProjectStore(path.join(root, 'projects.json'));
  store.synchronize([cwd]);
  const id = store.snapshot().projects[0].id;
  store.synchronize([], new Set([id]));
  assert.equal(store.snapshot().projects.length, 1);
  store.synchronize([]);
  assert.equal(store.snapshot().projects.length, 0);
  store.add(cwd);
  store.synchronize([]);
  assert.equal(store.snapshot().projects.length, 1);
});

test('目录已删除的项目仍能显示历史，但不伪造目录', async t => {
  const { root, agent, catalog } = fixture(t);
  const missing = path.join(root, 'missing-project');
  writeSession(path.join(agent, 'sessions', 'group', 'old.jsonl'), missing, 'old');
  const result = await catalog.scan();
  assert.equal(result.sessions[0].cwd, missing);
  const store = new ProjectStore(path.join(root, 'projects.json'));
  store.synchronize([result.sessions[0].cwd]);
  assert.equal(store.snapshot().projects.length, 1);
  assert.equal(fs.existsSync(missing), false);
});

test('精确恢复只接受当前索引中属于该项目的会话，打开前再次校验文件', async t => {
  const { agent, cwd, catalog } = fixture(t);
  const file = path.join(agent, 'sessions', 'group', 'one.jsonl');
  writeSession(file, cwd, 'one');
  const result = await catalog.scan();
  const key = result.sessions[0].key;
  assert.equal((await catalog.lookup(cwd, key)).id, 'one');
  await assert.rejects(catalog.lookup('/tmp/different-project', key), /不属于/);
  await assert.rejects(catalog.lookup(cwd, '../../outside'), /不属于/);
  writeSession(file, '/tmp/replaced-project', 'one');
  await assert.rejects(catalog.lookup(cwd, key), /已变更/);
});

test('指定会话路径通过 shell 位置参数传递，空格/引号/命令替换不会被执行', () => {
  let args;
  const manager = new TerminalManager({ shell: '/bin/zsh', env: {}, spawn(shell, argv) {
    args = argv;
    return { pid: 123, onData() {}, onExit() {} };
  } });
  const file = '/tmp/session with spaces/quote\'$(touch SHOULD_NOT_EXIST).jsonl';
  const state = manager.start({ id: 'one', path: '/tmp' }, { sessionFile: file });
  assert.equal(args[1], 'exec pi --extension "$1" --use-theme system --tui-mode fullscreen --session "$2"');
  assert.equal(args.at(-1), file);
  assert(!args[1].includes(file));
  assert.equal(state.sessionFile, file);
});
