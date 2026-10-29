import fs from 'node:fs';
import path from 'node:path';
import type { PersistedTerminal, TerminalState } from '../shared/contracts.js';
import type { TerminalManager } from './terminal-manager.cjs';
import { RelayProcess } from './relay-client.cjs';

const STATUSES = new Set(['idle', 'working', 'blocked', 'done', 'error', 'running', 'stopping']);
function valid(value: unknown): value is PersistedTerminal {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return entry.version === 1 && typeof entry.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(entry.id) &&
    typeof entry.token === 'string' && entry.token.length > 0 && entry.token.length <= 200 &&
    typeof entry.socketPath === 'string' && path.isAbsolute(entry.socketPath) &&
    entry.kind === 'pi' &&
    typeof entry.cwd === 'string' && path.isAbsolute(entry.cwd) &&
    (entry.projectId === null || typeof entry.projectId === 'string') &&
    typeof entry.label === 'string' && entry.label.length <= 200 &&
    Number.isSafeInteger(entry.startedAt) && Number.isSafeInteger(entry.cols) && Number.isSafeInteger(entry.rows) &&
    Number.isSafeInteger(entry.pid) && typeof entry.ephemeral === 'boolean' && (entry.appearance === 'light' || entry.appearance === 'dark') &&
    (entry.sessionFile === null || (typeof entry.sessionFile === 'string' && path.isAbsolute(entry.sessionFile))) &&
    (entry.sessionId === null || typeof entry.sessionId === 'string') &&
    (entry.sessionKey === null || typeof entry.sessionKey === 'string') &&
    typeof entry.status === 'string' && STATUSES.has(entry.status);
}

/** Persists running terminals so a new app process can attach to the relays that own them. */
export class SessionStore {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private off: (() => void) | undefined;
  constructor(private dir: string, private terminals: TerminalManager) {}
  start() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dir, 0o700); } catch {}
    if (this.off) return;
    const listener = (state: TerminalState) => {
      if (state.kind !== 'pi') { fs.rmSync(this.file(state.id), { force: true }); return; }
      if (!state.running) { fs.rmSync(this.file(state.id), { force: true }); return; }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.writeAll(), 200);
    };
    this.terminals.on('state', listener);
    this.off = () => this.terminals.off('state', listener);
  }
  private file(id: string) { return path.join(this.dir, id + '.json'); }
  private entry(state: ReturnType<TerminalManager['list']>[number], info: { token: string; socketPath: string }): PersistedTerminal {
    return { ...state, version: 1, token: info.token, socketPath: info.socketPath, bridgeReady: false };
  }
  writeAll() {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const state of this.terminals.list()) {
      if (state.kind !== 'pi' || !state.running) continue;
      const info = this.terminals.relayInfo(state.id);
      if (!info) continue;
      try {
        const temporary = this.file(state.id) + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(this.entry(state, info)), { mode: 0o600 });
        fs.renameSync(temporary, this.file(state.id));
      } catch { /* Persistence failures must not affect the terminal. */ }
    }
  }
  flush() { this.writeAll(); }
  read(): PersistedTerminal[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter(name => name.endsWith('.json')); } catch { return []; }
    const entries: PersistedTerminal[] = [];
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Shell tabs are no longer managed by the app; stop a legacy relay if one survived an upgrade.
        if (value?.kind === 'shell') { if (Number.isSafeInteger(value.pid) && value.pid > 0) { try { process.kill(value.pid, 'SIGTERM'); } catch {} } fs.rmSync(file, { force: true }); continue; }
        if (valid(value) && path.basename(value.socketPath) === value.id + '.sock') entries.push(value);
        else fs.rmSync(file, { force: true });
      } catch { fs.rmSync(file, { force: true }); }
    }
    return entries.sort((a, b) => a.startedAt - b.startedAt);
  }
  adopt(): number {
    let adopted = 0;
    for (const entry of this.read()) {
      if (!fs.existsSync(entry.socketPath)) { fs.rmSync(this.file(entry.id), { force: true }); continue; }
      try {
        const proc = new RelayProcess({ pid: entry.pid as number, socketPath: entry.socketPath, token: entry.token, legacyPiReplay: true });
        if (this.terminals.adopt(entry, proc)) adopted++;
        else proc.detach();
      } catch { fs.rmSync(this.file(entry.id), { force: true }); }
    }
    return adopted;
  }
  clear() {
    clearTimeout(this.timer); this.timer = undefined;
    try { for (const name of fs.readdirSync(this.dir)) if (name.endsWith('.json') || name.endsWith('.tmp')) fs.rmSync(path.join(this.dir, name), { force: true }); } catch {}
  }
  stop() {
    clearTimeout(this.timer); this.timer = undefined;
    this.off?.(); this.off = undefined;
  }
}
