import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as pty from 'node-pty';
import { terminateTree } from '../main/process-tree.cjs';
import { encodeRelayMessage, parseRelayMessage, validRelayClientMessage, RELAY_RING_LIMIT } from '../shared/relay-protocol.js';
import { TerminalMouseModes } from '../shared/terminal-mouse-modes.js';

interface RelayConfig {
  version: number; token: string; socketPath: string; shell: string; args: string[];
  env: Record<string, string>; cwd: string; cols: number; rows: number; kind: string;
}

const configPath = process.argv[2];
if (!configPath) { console.error('relay: missing config'); process.exit(1); }
let config: RelayConfig;
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
catch (error) { console.error('relay: invalid config', error); process.exit(1); }
try { fs.unlinkSync(configPath); } catch {}
if (config.version !== 1 || typeof config.token !== 'string' || !path.isAbsolute(config.socketPath) ||
    typeof config.shell !== 'string' || !Array.isArray(config.args) || !path.isAbsolute(config.cwd)) {
  console.error('relay: unsupported config'); process.exit(1);
}

const RING_LIMIT = RELAY_RING_LIMIT;
const mouseModes = new TerminalMouseModes();
let client: net.Socket | null = null;
let paused = false;
let pending = '';
let ring = '';
let finished = false;
let proc: pty.IPty;
let server: net.Server;

function send(message: Parameters<typeof encodeRelayMessage>[0]) {
  if (client && !client.destroyed) client.write(encodeRelayMessage(message));
}
function cleanup() {
  try { fs.unlinkSync(config.socketPath); } catch {}
  try { server.close(); } catch {}
}
function finish(exitCode: number, signal?: number) {
  if (finished) return;
  finished = true;
  send({ type: 'exit', exitCode, signal });
  cleanup();
  setTimeout(() => process.exit(0), 80).unref();
}

try {
  fs.mkdirSync(path.dirname(config.socketPath), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(config.socketPath); } catch {}
  proc = pty.spawn(config.shell, config.args, {
    name: 'xterm-256color', cols: config.cols, rows: config.rows, cwd: config.cwd, env: config.env
  });
} catch (error) {
  console.error('relay: spawn failed', error);
  process.exit(1);
}

proc.onData(data => {
  mouseModes.feed(data);
  ring = (ring + data).slice(-RING_LIMIT);
  if (paused) pending = (pending + data).slice(-2 * RING_LIMIT);
  else send({ type: 'data', data });
});
proc.onExit(event => finish(event.exitCode, event.signal));

server = net.createServer(socket => {
  socket.setEncoding('utf8');
  socket.setNoDelay(true);
  if (client && client !== socket) { try { client.destroy(); } catch {} }
  client = socket;
  let buffer = '';
  let greeted = false;
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) { socket.destroy(); return; }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      const message = parseRelayMessage(line);
      if (!validRelayClientMessage(message)) continue;
      if (!greeted) {
        if (message.type !== 'hello' || message.token !== config.token) { socket.destroy(); return; }
        greeted = true;
        paused = false; pending = '';
        socket.write(encodeRelayMessage({ type: 'ready', pid: proc.pid, cols: config.cols, rows: config.rows, mouseSnapshot: true }));
        // Keep the snapshot in the same frame as the ring so pre-mount buffering cannot drop it.
        socket.write(encodeRelayMessage({ type: 'replay', data: ring + mouseModes.snapshot() }));
        continue;
      }
      if (message.type === 'input') proc.write(message.data);
      else if (message.type === 'resize') { config.cols = message.cols; config.rows = message.rows; proc.resize(message.cols, message.rows); }
      else if (message.type === 'pause') paused = true;
      else if (message.type === 'resume') {
        paused = false;
        if (pending) { send({ type: 'data', data: pending }); pending = ''; }
      }
      else if (message.type === 'kill') { void terminateTree(proc).catch(() => {}).finally(() => finish(0, 15)); }
    }
  });
  socket.on('close', () => { if (client === socket) client = null; });
  socket.on('error', () => { if (client === socket) client = null; });
});

server.on('error', error => { console.error('relay: socket error', error); try { proc.kill(); } catch {} finish(1); });
server.listen(config.socketPath, () => { try { fs.chmodSync(config.socketPath, 0o600); } catch {} });

process.on('SIGHUP', () => {});
process.on('SIGTERM', () => { void terminateTree(proc).catch(() => {}).finally(() => finish(0, 15)); });
process.on('uncaughtException', error => { console.error('relay: uncaught', error); try { proc.kill(); } catch {} finish(1); });
