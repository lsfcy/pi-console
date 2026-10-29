import net from 'node:net';
import { EventEmitter } from 'node:events';
import type { PtyProcess } from '../shared/contracts.js';
import { encodeRelayMessage, parseRelayMessage, RELAY_RING_LIMIT } from '../shared/relay-protocol.js';

export interface RelayClientOptions { pid: number; socketPath: string; token: string; legacyPiReplay?: boolean }

/** A PTY owned by a detached relay process; detaching keeps the relay and its child alive. */
export class RelayProcess extends EventEmitter implements PtyProcess {
  pid: number;
  socketPath: string;
  private token: string;
  private socket: net.Socket | null = null;
  private ready = false;
  private mouseSnapshot = false;
  private legacyPiReplay: boolean;
  private detached = false;
  private exited = false;
  private queue: string[] = [];
  private pendingResize: { cols: number; rows: number } | null = null;
  private buffer = '';
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dataHandlers: ((data: string) => void)[] = [];
  private exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  constructor({ pid, socketPath, token, legacyPiReplay = false }: RelayClientOptions) {
    super();
    this.pid = pid; this.socketPath = socketPath; this.token = token; this.legacyPiReplay = legacyPiReplay;
    this.connect();
  }
  private connect() {
    if (this.detached || this.exited) return;
    const socket = net.createConnection(this.socketPath);
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.on('connect', () => { socket.write(encodeRelayMessage({ type: 'hello', token: this.token })); });
    socket.on('data', chunk => this.receive(typeof chunk === 'string' ? chunk : chunk.toString()));
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.detached || this.exited) return;
      if (this.ready) this.emitExit(1);
      else this.retry();
    });
  }
  private retry() {
    if (this.attempts++ > 150) { this.emitExit(1); return; }
    this.timer = setTimeout(() => this.connect(), 30);
    this.timer.unref?.();
  }
  private receive(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 2 * 1024 * 1024) { this.emitExit(1); return; }
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      const message = parseRelayMessage(line);
      if (!message) continue;
      if (message.type === 'ready') {
        this.ready = true;
        this.mouseSnapshot = message.mouseSnapshot === true;
        if (this.pendingResize) this.send({ type: 'resize', ...this.pendingResize });
        for (const data of this.queue) this.send({ type: 'input', data });
        this.queue = [];
      } else if (message.type === 'replay' || message.type === 'data') {
        // Old relays cannot report modes after truncation. Pi Console starts Pi in fullscreen;
        // seed its standard mouse mode before replay, so any subsequent mode changes win.
        const legacyTruncated = message.type === 'replay' && this.legacyPiReplay && !this.mouseSnapshot && message.data.length >= RELAY_RING_LIMIT;
        const data = (legacyTruncated ? '\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h' : '') + message.data;
        for (const handler of this.dataHandlers) handler(data);
      } else if (message.type === 'exit') {
        this.emitExit(message.exitCode, message.signal);
      } else if (message.type === 'error') {
        this.emitExit(1);
      }
    }
  }
  private send(message: Parameters<typeof encodeRelayMessage>[0]) {
    if (this.socket && !this.socket.destroyed) this.socket.write(encodeRelayMessage(message));
  }
  private emitExit(exitCode: number, signal?: number) {
    if (this.exited) return;
    this.exited = true;
    clearTimeout(this.timer);
    this.socket?.destroy();
    this.socket = null;
    this.exitHandler?.({ exitCode, signal });
  }
  onData(callback: (data: string) => void) { this.dataHandlers.push(callback); return this; }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void) { this.exitHandler = callback; return this; }
  write(data: string) {
    if (this.ready) { this.send({ type: 'input', data }); return; }
    if (this.queue.reduce((total, item) => total + item.length, 0) < 1024 * 1024) this.queue.push(data);
  }
  resize(cols: number, rows: number) {
    this.pendingResize = { cols, rows };
    if (this.ready) this.send({ type: 'resize', cols, rows });
  }
  pause() { this.send({ type: 'pause' }); }
  resume() { this.send({ type: 'resume' }); }
  kill(_signal?: string) {
    if (!this.ready) { try { process.kill(this.pid, 'SIGTERM'); } catch {} return; }
    this.send({ type: 'kill' });
    const timer = setTimeout(() => { try { process.kill(this.pid, 'SIGKILL'); } catch {} }, 1500);
    timer.unref?.();
  }
  detach() {
    this.detached = true;
    clearTimeout(this.timer);
    this.socket?.destroy();
    this.socket = null;
  }
}
