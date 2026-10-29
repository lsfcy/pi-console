/** Console relay protocol v1: newline-delimited JSON over a Unix socket. */
export const RELAY_VERSION = 1;
export const RELAY_RING_LIMIT = 1024 * 1024;
export type RelayClientMessage =
  | { type: 'hello'; token: string }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'kill' };
export type RelayServerMessage =
  | { type: 'ready'; pid: number; cols: number; rows: number; mouseSnapshot?: boolean }
  | { type: 'replay'; data: string }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number; signal?: number }
  | { type: 'error'; message: string };
export function encodeRelayMessage(message: RelayClientMessage | RelayServerMessage) {
  return JSON.stringify(message) + '\n';
}
export function parseRelayMessage(value: string): RelayClientMessage | RelayServerMessage | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null;
  } catch { return null; }
}
export function validRelayClientMessage(message: unknown): message is RelayClientMessage {
  if (!message || typeof message !== 'object') return false;
  const value = message as Record<string, unknown>;
  if (value.type === 'hello') return typeof value.token === 'string' && value.token.length <= 200;
  if (value.type === 'input') return typeof value.data === 'string' && value.data.length <= 1024 * 1024;
  if (value.type === 'resize') return Number.isInteger(value.cols) && Number.isInteger(value.rows) &&
    (value.cols as number) >= 2 && (value.cols as number) <= 500 && (value.rows as number) >= 1 && (value.rows as number) <= 300;
  return value.type === 'pause' || value.type === 'resume' || value.type === 'kill';
}
