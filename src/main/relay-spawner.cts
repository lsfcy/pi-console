import { t } from '../shared/i18n.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { SpawnPty } from '../shared/contracts.js';
import { RelayProcess } from './relay-client.cjs';

export function relaySocketDir(uid = typeof process.getuid === 'function' ? process.getuid() : 0) {
  return path.join('/tmp', 'pc-' + uid);
}
export function createRelaySpawner({ relayPath }: { relayPath: string }): SpawnPty {
  return (shell, args, options) => {
    const meta = options.relayMeta;
    if (!meta) throw new Error(t('后台会话缺少 relay 元数据。'));
    if (!fs.existsSync(relayPath)) throw new Error(t('后台会话组件缺失，请重新构建应用。'));
    const socketDir = relaySocketDir();
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(socketDir, 0o700); } catch {}
    try {
      for (const name of fs.readdirSync(socketDir)) {
        const file = path.join(socketDir, name);
        if (name.endsWith('.cfg') && Date.now() - fs.statSync(file).mtimeMs > 60 * 60 * 1000) fs.rmSync(file, { force: true });
      }
    } catch {}
    const socketPath = path.join(socketDir, meta.id + '.sock');
    const configPath = path.join(socketDir, meta.id + '.cfg');
    const env = Object.fromEntries(Object.entries(options.env || {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
    try { fs.unlinkSync(socketPath); } catch {}
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, token: meta.token, socketPath, shell, args, env,
      cwd: options.cwd, cols: options.cols, rows: options.rows, kind: meta.kind
    }), { mode: 0o600 });
    const child = spawn(process.execPath, [relayPath, configPath], {
      detached: true, stdio: 'ignore', cwd: options.cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.on('error', () => {});
    child.unref();
    if (!child.pid) {
      try { fs.unlinkSync(configPath); } catch {}
      throw new Error(t('无法启动后台会话进程。'));
    }
    return new RelayProcess({ pid: child.pid, socketPath, token: meta.token });
  };
}
