import { t } from '../shared/i18n.js';
import type { Appearance, TerminalKind, UpdateTarget, ProgramStatus, Project, TerminalState, SessionInfo, ApplicationEvent, PtyProcess, SpawnPty, BridgeMetadata, PersistedTerminal } from '../shared/contracts.js';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { terminateTree } from './process-tree.cjs';
import { canonical } from './session-catalog.cjs';
import { frame, FrameDecoder } from './bridge-protocol.cjs';
import { normalizeTerminalSize as dimensions } from '../shared/terminal-utils.js';

function terminalEnvironment(source = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL',
    'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR', 'ITERM_SESSION_ID', 'ITERM_PROFILE',
    'TERM_SESSION_ID', 'TERM_PROGRAM_VERSION', 'LC_TERMINAL', 'LC_TERMINAL_VERSION', 'TMUX', 'TMUX_PANE', 'STY',
    'PI_GUI_BRIDGE_TOKEN', 'PI_GUI_THEME', 'COLUMNS', 'LINES']) delete env[key];
  env.PATH = [...new Set(['/opt/homebrew/bin', '/usr/local/bin', ...(env.PATH || '/usr/bin:/bin').split(':')])].join(':');
  return { ...env, TERM: 'xterm-256color', TERM_PROGRAM: 'pi-gui', COLORTERM: 'truecolor',
    PI_IMAGE_PROTOCOL: 'none', PI_TRUE_COLOR: '1', PI_HYPERLINKS: '1',
    PI_HARDWARE_CURSOR: '1', PI_PROGRAM_STATUS: '1' };
}
function normalizedFile(file: string | null | undefined) { return file ? path.join(canonical(path.dirname(file)), path.basename(file)) : null; }
function fileKey(file: string | null | undefined) { return file ? createHash('sha256').update(normalizedFile(file)!).digest('hex').slice(0, 24) : null; }
function text(value: unknown, max = 160) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, max) : '';
}
const UPDATE_COMMANDS = {
  self: 'exec pi update --self',
  extensions: 'exec pi update --extensions',
  all: 'exec pi update --all'
};
const UPDATE_LABELS = { self: 'Pi 更新', extensions: '插件更新', all: 'Pi 与插件更新' };

interface TerminalRecord {
  proc: PtyProcess; token: string; pending: number; paused: boolean; closing: boolean;
  stopPromise: Promise<void> | null; output: string; timer: ReturnType<typeof setTimeout> | undefined;
  requests: Map<string, { action: string; resolve(value: ControlResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>;
  state: TerminalState; decoder: FrameDecoder;
}
type ControlResponse = TerminalState;
interface StartOptions {
  forkFile?: string;
  kind?: TerminalKind; sessionFile?: string | null; sessionId?: string | null; label?: string;
  appearance?: Appearance; cols?: number; rows?: number; updateTarget?: UpdateTarget; ephemeral?: boolean;
}
class TerminalManager extends EventEmitter<{
  state: [TerminalState]; data: [Omit<Extract<ApplicationEvent, { type: 'data' }>, 'type'>]; notice: [string];
}> {
  spawn: SpawnPty;
  terminate: (proc: PtyProcess) => Promise<void>;
  env: NodeJS.ProcessEnv;
  shell: string;
  updateTimeoutMs: number;
  bridgePath: string;
  records = new Map<string | null, TerminalRecord>();
  ordinal: number;
  constructor({ spawn, terminate = terminateTree, env = process.env, shell = os.userInfo().shell || '/bin/zsh',
    updateTimeoutMs = 10 * 60 * 1000, bridgePath = path.join(__dirname, '../pi/pi-gui-bridge.ts') }: {
      spawn: SpawnPty; terminate?: (proc: PtyProcess) => Promise<void>; env?: NodeJS.ProcessEnv;
      shell?: string; updateTimeoutMs?: number; bridgePath?: string;
    }) {
    super();
    this.spawn = spawn; this.terminate = terminate; this.env = env;
    this.shell = shell; this.updateTimeoutMs = updateTimeoutMs; this.bridgePath = bridgePath;
    this.ordinal = 0;
  }
  list() { return [...this.records.values()].filter(r => r.state.running || r.state.kind === 'update').map(r => ({ ...r.state })); }
  hasActive() { return [...this.records.values()].some(r => r.state.running || r.closing); }
  projectActive(id: string | null) { return [...this.records.values()].some(r => r.state.projectId === id && (r.state.running || r.closing)); }
  current(id: string | null, runId: string) { const r = this.records.get(id); return r?.state.running && r.state.runId === runId ? r : null; }
  relayInfo(id: string | null) {
    const record = this.records.get(id);
    return record?.proc.socketPath ? { token: record.token, socketPath: record.proc.socketPath } : null;
  }
  detachAll() {
    for (const record of this.records.values()) {
      if (record.state.kind === 'update') continue;
      try { record.proc.detach?.(); } catch {}
    }
    this.records.clear();
  }
  async stopUpdates() {
    await Promise.all([...this.records].filter(([, record]) => record.state.kind === 'update').map(([id]) => this.stop(id)));
  }
  publish(record: TerminalRecord) { this.emit('state', { ...record.state }); }
  findSession(info: { file?: string | null; id?: string | null; cwd?: string }) {
    return this.list().find(s => s.running && s.kind === 'pi' && !s.ephemeral &&
      (s.sessionFile ? Boolean(info.file && normalizedFile(s.sessionFile) === normalizedFile(info.file)) :
        Boolean(info.cwd && s.cwd === canonical(info.cwd) && s.sessionId === info.id)));
  }
  sessionBusy(info: SessionInfo, projectId: string | null) {
    return this.findSession(info) || this.list().find(s => s.running && s.kind === 'pi' && s.projectId === projectId && !s.bridgeReady);
  }
  start(project: Project | null, { forkFile, kind = 'pi', sessionFile = null, sessionId = null, label = '', appearance = 'dark', cols, rows, updateTarget = 'self', ephemeral = false }: StartOptions = {}) {
    if (!['pi', 'shell', 'update'].includes(kind)) throw new Error(t('无效的终端类型。'));
    if (kind === 'update' && !Object.hasOwn(UPDATE_COMMANDS, updateTarget)) throw new Error(t('无效的更新类型。'));
    if (sessionFile !== null && (typeof sessionFile !== 'string' || !path.isAbsolute(sessionFile))) throw new Error(t('无效的会话文件。'));
    if (typeof ephemeral !== 'boolean' || (ephemeral && (kind !== 'pi' || sessionFile || sessionId))) throw new Error(t('临时会话不能恢复历史或指定会话文件。'));
    if (forkFile !== undefined && (typeof forkFile !== 'string' || !path.isAbsolute(forkFile) || kind !== 'pi' || ephemeral || sessionFile || sessionId)) throw new Error(t('无效的分叉会话参数。'));
    if (kind === 'pi' && sessionFile) {
      const existing = this.findSession({ file: sessionFile, id: sessionId, cwd: project?.path });
      if (existing) return existing;
    }
    if (kind === 'update' && this.hasActive()) throw new Error(t('请先关闭 GUI 内所有 Pi 标签，再更新 Pi。'));
    if (kind !== 'update' && this.list().some(s => s.kind === 'update' && s.running)) throw new Error(t('Pi 正在更新，请等待更新完成。'));
    if (kind === 'update') for (const [oldId, old] of this.records) if (old.state.kind === 'update' && !old.state.running && !old.closing) this.records.delete(oldId);
    const id = randomUUID();
    const token = randomUUID();
    const selectedSessionId = kind === 'pi' ? sessionId || randomUUID() : null;
    const selectedUpdateTarget = kind === 'update' ? updateTarget : null;
    let args;
    if (kind === 'shell') args = ['-il'];
    else if (kind === 'update') args = ['-ilc', UPDATE_COMMANDS[selectedUpdateTarget!]];
    else if (ephemeral) args = ['-ilc', 'exec pi --extension "$1" --use-theme system --tui-mode fullscreen --no-session', 'pi-gui', this.bridgePath];
    else if (forkFile) args = ['-ilc', 'exec pi --extension "$1" --use-theme system --tui-mode fullscreen --fork "$2" --session-id "$3" --name "$4"',
      'pi-gui', this.bridgePath, forkFile, selectedSessionId!, text(label) || t('分叉会话')];
    else args = ['-ilc', sessionFile ?
      'exec pi --extension "$1" --use-theme system --tui-mode fullscreen --session "$2"' :
      'exec pi --extension "$1" --use-theme system --tui-mode fullscreen --session-id "$2"',
      'pi-gui', this.bridgePath, (sessionFile || selectedSessionId)!];
    const env = terminalEnvironment(this.env);
    if (kind === 'pi') { env.PI_GUI_BRIDGE_TOKEN = token; env.PI_GUI_THEME = appearance; }
    const size = dimensions(cols, rows);
    const proc = this.spawn(this.shell, args, { ...size, name: 'xterm-256color',
      cwd: project?.path || os.homedir(), env, relayMeta: { id, token, kind } });
    const record: TerminalRecord = { proc, token, pending: 0, paused: false, closing: false, stopPromise: null,
      requests: new Map(), output: '', timer: undefined,
      decoder: new FrameDecoder(token, value => this.metadata(record, value)),
      state: { id, runId: randomUUID(), projectId: project?.id || null, cwd: canonical(project?.path || os.homedir()),
        kind, ephemeral, pid: proc.pid, running: true, status: 'running', message: '', sessionFile: normalizedFile(sessionFile), sessionKey: fileKey(sessionFile), persistent: Boolean(proc.socketPath),
        sessionId: selectedSessionId, bridgeReady: false, appearance, cols: size.cols, rows: size.rows,
        updateTarget: selectedUpdateTarget,
        label: text(label) || (kind === 'pi' ? t(ephemeral ? '临时会话 {count}' : '新会话 {count}', { count: ++this.ordinal }) : kind === 'shell' ? t('Shell {count}', { count: ++this.ordinal }) : t(UPDATE_LABELS[selectedUpdateTarget!])),
        startedAt: Date.now() } };
    this.records.set(id, record);
    this.bind(record);
    if (kind === 'update') record.timer = setTimeout(() => {
      record.state.message = t('更新超过 10 分钟，已中止。请检查网络后人工重试。');
      this.emit('notice', record.state.message);
      void this.stop(id);
    }, this.updateTimeoutMs);
    this.publish(record);
    return { ...record.state };
  }
  private bind(record: TerminalRecord) {
    const { proc } = record, id = record.state.id;
    proc.onData(data => {
      if (this.records.get(id) !== record || !record.state.running) return;
      if (record.state.kind === 'pi') record.decoder.feed(data);
      if (record.state.kind === 'update') record.output = (record.output + data).slice(-128 * 1024);
      record.pending += data.length;
      if (record.pending > 256 * 1024 && !record.paused) { proc.pause(); record.paused = true; }
      this.emit('data', { id, runId: record.state.runId, kind: record.state.kind, data });
    });
    proc.onExit(({ exitCode, signal }) => {
      clearTimeout(record.timer);
      for (const request of record.requests.values()) { clearTimeout(request.timer); request.reject(new Error(t('终端已退出。'))); }
      record.requests.clear();
      record.state = { ...record.state, running: false, pid: null, exitCode, signal,
        status: record.closing ? 'stopped' : exitCode === 0 ? 'exited' : 'error' };
      this.publish(record);
      if (!record.closing && record.state.kind !== 'update') this.records.delete(id);
    });
  }
  adopt(entry: PersistedTerminal, proc: PtyProcess) {
    if (this.records.has(entry.id) || !entry.token || !proc.socketPath) return null;
    const state = { ...entry } as TerminalState & Partial<PersistedTerminal>;
    delete state.version; delete state.token; delete state.socketPath;
    state.runId = randomUUID(); state.pid = proc.pid; state.running = true; state.persistent = true;
    state.bridgeReady = state.kind === 'pi' && Boolean(state.sessionId);
    state.exitCode = undefined; state.signal = undefined;
    const record: TerminalRecord = { proc, token: entry.token, pending: 0, paused: false, closing: false, stopPromise: null,
      requests: new Map(), output: '', timer: undefined,
      decoder: new FrameDecoder(entry.token, value => this.metadata(record, value)), state };
    this.records.set(entry.id, record);
    this.bind(record);
    proc.resize(state.cols, state.rows);
    this.publish(record);
    return { ...record.state };
  }
  metadata(record: TerminalRecord, value: BridgeMetadata & { errorVars?: unknown }) {
    if (record.state.kind !== 'pi' || !record.state.running || typeof value.cwd !== 'string' ||
        canonical(value.cwd) !== record.state.cwd || typeof value.sessionId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.sessionId)) return;
    if (value.sessionFile !== null && (typeof value.sessionFile !== 'string' || !path.isAbsolute(value.sessionFile) || !value.sessionFile.endsWith('.jsonl'))) return;
    record.state = { ...record.state, bridgeReady: true, sessionId: value.sessionId,
      sessionFile: record.state.ephemeral ? null : normalizedFile(value.sessionFile), sessionKey: record.state.ephemeral ? null : fileKey(value.sessionFile), appearance: value.appearance === 'light' ? 'light' : 'dark' };
    if (text(value.name)) record.state.label = text(value.name);
    this.publish(record);
    if (typeof value.requestId === 'string') {
      const request = record.requests.get(value.requestId);
      if (request) {
        clearTimeout(request.timer); record.requests.delete(value.requestId);
        if (value.ok === false) {
          const vars: Record<string, string | number> = {};
          if (value.errorVars && typeof value.errorVars === 'object' && !Array.isArray(value.errorVars)) {
            for (const [key, item] of Object.entries(value.errorVars).slice(0, 10)) {
              if (typeof item === 'string') vars[key] = item.slice(0, 300);
              else if (typeof item === 'number' && Number.isFinite(item)) vars[key] = item;
            }
          }
          request.reject(new Error(t(text(value.error, 300) || 'Pi 操作失败。', vars)));
        }
        else request.resolve({ ...record.state });
      }
    }
  }
  control(id: string, action: 'rename' | 'theme', fields: Record<string, unknown> = {}): Promise<ControlResponse> {
    const record = this.records.get(id);
    if (!record?.state.running || record.state.kind !== 'pi' || !record.state.bridgeReady) return Promise.reject(new Error(t('Pi 尚未准备好，请稍后重试。')));
    if (!['rename', 'theme'].includes(action)) return Promise.reject(new Error(t('无效的 Pi 操作。')));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { record.requests.delete(requestId); reject(new Error(t('Pi 未响应，未修改输入框，请重试。'))); }, 3000);
      record.requests.set(requestId, { action, resolve, reject, timer });
      record.proc.write(frame(7503, { ...fields, token: record.token, requestId, action }));
    });
  }
  write(id: string, runId: string, data: string) {
    if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error(t('终端输入过长。'));
    this.current(id, runId)?.proc.write(data);
  }
  resize(id: string, runId: string, cols: number, rows: number) {
    const size = dimensions(cols, rows);
    const record = this.current(id, runId);
    if (!record) return;
    record.proc.resize(size.cols, size.rows);
    record.state.cols = size.cols; record.state.rows = size.rows;
  }
  acknowledge(id: string, runId: string, length: number) {
    const r = this.current(id, runId);
    if (!r || !Number.isInteger(length) || length < 0) return;
    r.pending = Math.max(0, r.pending - length);
    if (r.paused && r.pending < 64 * 1024) { r.proc.resume(); r.paused = false; }
  }
  report(id: string, runId: string, status: ProgramStatus, message: string) {
    const r = this.current(id, runId);
    if (!r || r.closing || r.state.kind !== 'pi' || !['idle', 'working', 'blocked', 'done', 'error'].includes(status)) return;
    r.state.status = status; r.state.message = text(message, 2048); this.publish(r);
  }
  updateLog() {
    const record = [...this.records.values()].reverse().find(r => r.state.kind === 'update');
    return record ? { state: { ...record.state }, output: record.output } : null;
  }
  clearUpdateLog() {
    if ([...this.records.values()].some(r => r.state.kind === 'update' && (r.state.running || r.closing))) throw new Error(t('请等待更新结束后再清除日志。'));
    for (const [id, record] of this.records) if (record.state.kind === 'update') this.records.delete(id);
  }
  stop(id: string | null) {
    const r = this.records.get(id);
    if (!r) return Promise.resolve();
    if (r.stopPromise) return r.stopPromise;
    if (!r.state.running) return Promise.resolve();
    r.closing = true; r.state.status = 'stopping'; this.publish(r);
    r.stopPromise = Promise.resolve().then(() => this.terminate(r.proc)).finally(() => {
      r.closing = false;
      if (!r.state.running && r.state.kind !== 'update') this.records.delete(id);
      r.stopPromise = null;
    });
    return r.stopPromise;
  }
  async stopAll() { await Promise.all([...this.records.keys()].map(id => this.stop(id))); }
}
export { TerminalManager, terminalEnvironment, dimensions, UPDATE_COMMANDS };
