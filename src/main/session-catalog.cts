import { t } from '../shared/i18n.js';
import type { Project, SessionStats, SessionInfo, SessionEntry } from '../shared/contracts.js';
import fs from 'node:fs';
import * as errors from '../shared/errors.js';
const fsp = fs.promises;
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function cleanText(value: unknown, limit = 160) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}
function canonical(directory: string) {
  try { return fs.realpathSync(directory); } catch { return path.resolve(directory); }
}
function expand(directory: string, base: string) {
  if (directory.startsWith('file://')) return fileURLToPath(directory);
  if (directory === '~') return os.homedir();
  if (directory.startsWith('~/')) return path.join(os.homedir(), directory.slice(2));
  return path.resolve(base, directory);
}

// Streaming and bounded: never retain tool output, image payloads, or a full transcript.
// Oversized individual entries are skipped; later metadata entries remain discoverable.
async function* boundedLines(file: string, maxLength = 256 * 1024) {
  let pending = '';
  let skipping = false;
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
    let start = 0;
    for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
      const fragment = chunk.slice(start, end);
      if (!skipping && pending.length + fragment.length <= maxLength) yield pending + fragment;
      pending = '';
      skipping = false;
      start = end + 1;
    }
    if (!skipping) {
      pending += chunk.slice(start);
      if (pending.length > maxLength) { pending = ''; skipping = true; }
    }
  }
  if (!skipping && pending) yield pending;
}

async function readSessionInfo(file: string, fileStats: import('node:fs').Stats): Promise<SessionInfo | null> {
  let header: SessionEntry | undefined;
  let name = '';
  let firstMessage = '';
  let lastActivity = 0;
  const usage: SessionStats = {
    cacheHitRate: 0, sessionBytes: 0,
    userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    reasoningTokens: 0, totalTokens: 0, contextTokens: 0,
    costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, costTotal: 0,
    requestDurationMs: 0, errors: 0, aborts: 0, lastUsageAt: 0,
    models: [], providers: [], lastModel: '', lastProvider: '', lastThinkingLevel: ''
  };
  const costKeys = { input: 'costInput', output: 'costOutput', cacheRead: 'costCacheRead', cacheWrite: 'costCacheWrite', total: 'costTotal' } as const;
  const addCost = (value: NonNullable<NonNullable<NonNullable<SessionEntry['message']>['usage']>['cost']>, key: keyof typeof costKeys) => {
    const n = Number(value[key]); if (Number.isFinite(n) && n >= 0) usage[costKeys[key]] += n;
  };
  for await (const line of boundedLines(file)) {
    if (!line.trim()) continue;
    // Inspect only the prefix to avoid JSON-parsing unrelated (potentially large) entries.
    const prefix = line.slice(0, 4096);
    const isHeader = !header;
    const isName = /"type"\s*:\s*"session_info"/.test(prefix);
    const isUser = /"role"\s*:\s*"user"/.test(prefix);
    const isAssistant = /"role"\s*:\s*"assistant"/.test(prefix);
    const isToolResult = /"role"\s*:\s*"toolResult"/.test(prefix);
    const timestamp = /"timestamp"\s*:\s*"([^"\n]+)"/.exec(prefix)?.[1];
    // Pi can append model/thinking settings merely on resume; those are not conversation activity.
    if (timestamp && (isHeader || isUser || isAssistant || isToolResult)) lastActivity = Math.max(lastActivity, Date.parse(timestamp) || 0);
    if (!isHeader && !isName && !isUser && !isAssistant && !isToolResult) continue;
    let entry: SessionEntry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!header) {
      if (entry.type !== 'session' || typeof entry.id !== 'string' || typeof entry.cwd !== 'string' || !path.isAbsolute(entry.cwd)) return null;
      header = entry;
    } else if (entry.type === 'session_info') {
      name = cleanText(entry.name);
    } else if (entry.type === 'message' && entry.message?.role === 'user') {
      usage.userMessages++;
      if (!firstMessage) {
        const content = entry.message.content;
        firstMessage = cleanText(typeof content === 'string' ? content :
          Array.isArray(content) ? content.filter(item => item.type === 'text').map(item => item.text).join(' ') : '');
      }
    } else if (entry.type === 'message' && entry.message?.role === 'assistant') {
      const message = entry.message;
      usage.assistantMessages++;
      if (Array.isArray(message.content)) usage.toolCalls += message.content.filter(part => part?.type === 'toolCall').length;
      if (message.stopReason === 'error') usage.errors++;
      if (message.stopReason === 'aborted') usage.aborts++;
      if (typeof message.model === 'string' && message.model) {
        usage.lastModel = cleanText(message.model, 80);
        if (usage.models.length < 16 && !usage.models.includes(usage.lastModel)) usage.models.push(usage.lastModel);
      }
      if (typeof message.provider === 'string' && message.provider) {
        usage.lastProvider = cleanText(message.provider, 80);
        if (usage.providers.length < 16 && !usage.providers.includes(usage.lastProvider)) usage.providers.push(usage.lastProvider);
      }
      if (typeof message.thinkingLevel === 'string') usage.lastThinkingLevel = cleanText(message.thinkingLevel, 20);
      if (Number.isFinite(message.durationMs) && message.durationMs! >= 0) usage.requestDurationMs += message.durationMs!;
      const item = message.usage;
      if (item && typeof item === 'object') {
        const input = Number(item.input), output = Number(item.output), cacheRead = Number(item.cacheRead),
          cacheWrite = Number(item.cacheWrite), reasoning = Number(item.reasoning), total = Number(item.totalTokens);
        if (Number.isFinite(input) && input >= 0) usage.inputTokens += input;
        if (Number.isFinite(output) && output >= 0) usage.outputTokens += output;
        if (Number.isFinite(cacheRead) && cacheRead >= 0) usage.cacheReadTokens += cacheRead;
        if (Number.isFinite(cacheWrite) && cacheWrite >= 0) usage.cacheWriteTokens += cacheWrite;
        if (Number.isFinite(reasoning) && reasoning >= 0) usage.reasoningTokens += reasoning;
        if (Number.isFinite(total) && total >= 0) usage.totalTokens += total;
        usage.contextTokens = Math.max(0, (Number.isFinite(input) ? input : 0) +
          (Number.isFinite(cacheRead) ? cacheRead : 0) + (Number.isFinite(cacheWrite) ? cacheWrite : 0));
        if (item.cost && typeof item.cost === 'object') {
          addCost(item.cost, 'input'); addCost(item.cost, 'output');
          addCost(item.cost, 'cacheRead'); addCost(item.cost, 'cacheWrite'); addCost(item.cost, 'total');
        }
        const stamp = Number(message.timestamp);
        usage.lastUsageAt = Number.isFinite(stamp) ? Math.max(usage.lastUsageAt, stamp) : lastActivity;
      }
    } else if (entry.type === 'message' && entry.message?.role === 'toolResult') {
      usage.toolResults++;
    }
  }
  if (!header?.id || !header.cwd) return null;
  if (!usage.totalTokens) usage.totalTokens = usage.inputTokens + usage.outputTokens;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const stats = {
    ...usage,
    cacheHitRate: promptTokens ? usage.cacheReadTokens / promptTokens : 0,
    sessionBytes: Number.isFinite(fileStats?.size) ? fileStats.size : 0
  };
  return {
    key: createHash('sha256').update(file).digest('hex').slice(0, 24),
    id: header.id, file, cwd: canonical(header.cwd),
    name, firstMessage, title: name || firstMessage || t('未命名会话 · {id}', { id: header.id.slice(0, 8) }),
    createdAt: Date.parse(header.timestamp || '') || fileStats.birthtimeMs || fileStats.mtimeMs,
    modifiedAt: lastActivity || fileStats.mtimeMs,
    stats
  };
}

class SessionCatalog {
  env: NodeJS.ProcessEnv;
  agentDir: string;
  cache = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; ino: number; info: SessionInfo | null }>();
  sessions: SessionInfo[];
  constructor({ env = process.env, home = os.homedir() } = {}) {
    this.env = env;
    this.agentDir = expand(env.PI_CODING_AGENT_DIR || path.join(home, '.pi/agent'), home);
    this.sessions = [];
  }

  async scan(projects: Pick<Project, 'path'>[] = []) {
    const warnings: string[] = [];
    const roots = new Set([path.join(this.agentDir, 'sessions')]);
    const addRoot = (value: unknown, base: string) => { if (typeof value === 'string' && value.trim()) roots.add(expand(value, base)); };
    const readSetting = async (file: string): Promise<unknown> => {
      try { return JSON.parse(await fsp.readFile(file, 'utf8')).sessionDir; }
      catch (error) { if (errors.code(error) !== 'ENOENT') warnings.push(t('无法读取会话目录配置：{file}\n{detail}', { file, detail: errors.message(error) })); }
    };
    const globalRoot = await readSetting(path.join(this.agentDir, 'settings.json'));
    for (const value of [this.env.PI_CODING_AGENT_SESSION_DIR, globalRoot]) {
      if (typeof value === 'string' && (path.isAbsolute(value) || value.startsWith('~') || value.startsWith('file://'))) addRoot(value, process.cwd());
    }
    const configuredProjects = new Set<string>();
    const addProjectRoots = async (cwd: string) => {
      if (configuredProjects.has(cwd)) return;
      configuredProjects.add(cwd);
      // Pi resolves relative sessionDir settings from the project's cwd, not the agent directory.
      addRoot(this.env.PI_CODING_AGENT_SESSION_DIR, cwd);
      addRoot(globalRoot, cwd);
      addRoot(await readSetting(path.join(cwd, '.pi/settings.json')), cwd);
    };
    for (const project of projects) await addProjectRoots(project.path);

    const files = new Set<string>();
    const visited = new Set<string>();
    const walk = async (directory: string, depth = 0): Promise<void> => {
      const resolved = canonical(directory);
      if (visited.has(resolved)) return;
      visited.add(resolved);
      let entries;
      try { entries = await fsp.readdir(resolved, { withFileTypes: true }); }
      catch (error) { if (errors.code(error) !== 'ENOENT') warnings.push(t('无法读取会话目录：{directory}\n{detail}', { directory: resolved, detail: errors.message(error) })); return; }
      for (const entry of entries) {
        const file = path.join(resolved, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) files.add(file);
        else if (entry.isDirectory() && depth < 2) await walk(file, depth + 1);
      }
    };
    for (const root of roots) await walk(root);
    const list = [...files];
    const loaded: SessionInfo[] = [];
    let cursor = 0;
    let skipped = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const file = list[cursor++];
        try {
          const stats = await fsp.stat(file);
          const cached = this.cache.get(file);
          let info;
          if (cached?.size === stats.size && cached?.mtimeMs === stats.mtimeMs && cached?.ctimeMs === stats.ctimeMs && cached?.ino === stats.ino) info = cached.info;
          else {
            info = await readSessionInfo(file, stats);
            this.cache.set(file, { size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, ino: stats.ino, info });
          }
          if (info) loaded.push({ ...info, title: info.name || info.firstMessage || t('未命名会话 · {id}', { id: info.id.slice(0, 8) }) }); else skipped++;
        } catch (error) { if (errors.code(error) !== 'ENOENT') skipped++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
    // One additional pass discovers project-local settings for projects found in the default history.
    // This is bounded, not an unending filesystem-discovery loop.
    for (const cwd of new Set(loaded.map(info => info.cwd))) await addProjectRoots(cwd);
    for (const root of roots) await walk(root);
    const alreadyLoaded = new Set(list);
    list.push(...[...files].filter(file => !alreadyLoaded.has(file)));
    await Promise.all(Array.from({ length: Math.min(4, list.length - cursor) }, worker));
    for (const file of this.cache.keys()) if (!files.has(file)) this.cache.delete(file);
    this.sessions = loaded.sort((a, b) => b.modifiedAt - a.modifiedAt);
    if (skipped) warnings.push(t('{count} 个文件无法识别为有效 Pi 会话，已跳过；原文件未修改。', { count: skipped }));
    return { sessions: this.sessions.map(info => ({ ...info })), roots: [...roots], warnings, scannedAt: Date.now() };
  }

  async lookup(cwd: string, key: string) {
    const saved = this.sessions.find(info => info.key === key && info.cwd === canonical(cwd));
    if (!saved) throw new Error(t('会话不属于此项目，或已不存在。请刷新本地历史。'));
    let info;
    try { info = await readSessionInfo(saved.file, await fsp.stat(saved.file)); }
    catch (error) { throw new Error(t('会话文件无法读取，请刷新本地历史。\n{detail}', { detail: errors.message(error) })); }
    if (!info || info.id !== saved.id || info.cwd !== canonical(cwd)) throw new Error(t('会话文件已变更，请刷新后重试。'));
    return info;
  }
}

export { SessionCatalog, readSessionInfo, boundedLines, canonical };
