import type { ProgramStatus } from './contracts.js';
import { t } from './i18n.js';
export function isPiSuspend(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>) {
  return !event.isComposing && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.code === 'KeyZ' || event.key?.toLowerCase() === 'z');
}
export function modifiedEnter(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'isComposing' | 'shiftKey' | 'altKey' | 'ctrlKey'>) {
  if (event.key !== 'Enter' || event.metaKey || event.isComposing ||
      (!event.shiftKey && !event.altKey && !event.ctrlKey)) return null;
  const modifier = 1 + Number(Boolean(event.shiftKey)) + 2 * Number(Boolean(event.altKey)) + 4 * Number(Boolean(event.ctrlKey));
  return '\x1b[13;' + modifier + 'u';
}

export function parseProgramStatus(data: unknown) {
  if (typeof data !== 'string' || data.length > 4096) return null;
  const values = Object.fromEntries(data.split(':').map(pair => {
    const index = pair.indexOf('=');
    return index < 0 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)];
  }));
  if (!['idle', 'working', 'blocked', 'done', 'error'].includes(values.state)) return null;
  let message = '';
  try {
    if (values.msg) {
      const bytes = Uint8Array.from(atob(values.msg), char => char.charCodeAt(0));
      message = new TextDecoder().decode(bytes).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 2048);
    }
  } catch { /* An invalid optional message must not hide the status. */ }
  return { status: values.state as ProgramStatus, message };
}

export function normalizeTerminalSize(cols = 100, rows = 30) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new Error(t('无效的终端尺寸。'));
  return { cols: Math.max(2, Math.min(500, cols)), rows: Math.max(1, Math.min(300, rows)) };
}
export function fittedTerminalSize(proposed: { cols: number; rows: number } | undefined, paintGutterColumns = 0) {
  if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return null;
  // WebGL uses the measured grid directly. DOM fallback alone reserves its measured paint overhang.
  return normalizeTerminalSize(Math.floor(proposed.cols) - paintGutterColumns, Math.floor(proposed.rows));
}
export class DimensionSync {
  last: string | null = null;
  constructor(private send: (cols: number, rows: number) => void) {}
  sync(cols: number, rows: number) {
    const size = normalizeTerminalSize(cols, rows);
    const key = size.cols + ':' + size.rows;
    if (key === this.last) return;
    this.last = key;
    this.send(size.cols, size.rows);
  }
}
