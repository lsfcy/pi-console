import { t } from '../shared/i18n.js';
import type { SessionInfo } from '../shared/contracts.js';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

function validateName(name: unknown) {
  if (typeof name !== 'string') throw new Error(t('会话名称无效。'));
  const normalized = name.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
  if (!normalized || normalized.length > 160) throw new Error(t('会话名称需为 1～160 个字符。'));
  return normalized;
}
function sameRevision(a: import('node:fs').BigIntStats, b: import('node:fs').BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
// Closed v2/v3 sessions only. Append the same session_info tree entry Pi uses for /name.
// Never rewrite messages, repair an incomplete line, or mutate an actively owned GUI session.
function renameClosedSession(info: Pick<SessionInfo, 'file' | 'id'>, name: string) {
  name = validateName(name);
  const before = fs.statSync(info.file, { bigint: true });
  const fd = fs.openSync(info.file, 'r+');
  try {
    if (!sameRevision(before, fs.fstatSync(fd, { bigint: true }))) throw new Error(t('会话正在变化，请先退出使用它的 Pi。'));
    const size = Number(before.size);
    const head = Buffer.alloc(Math.min(size, 8192));
    fs.readSync(fd, head, 0, head.length, 0);
    let header;
    try { header = JSON.parse(head.toString('utf8').split('\n')[0]); } catch { throw new Error(t('无法识别会话头，请在 Pi 内重命名。')); }
    if (header.type !== 'session' || header.id !== info.id || ![2, 3].includes(header.version)) throw new Error(t('旧版或已变更的会话，请先在 Pi 内打开后重命名。'));
    const tailSize = Math.min(size, 4 * 1024 * 1024);
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, size - tailSize);
    const raw = tail.toString('utf8');
    const last = raw.trimEnd().split('\n').at(-1);
    let entry;
    try { entry = JSON.parse(last || ''); } catch { throw new Error(t('会话末条记录不完整或过大，未修改原文件。请在 Pi 内重命名。')); }
    if (!entry || (entry.type !== 'session' && typeof entry.id !== 'string')) throw new Error(t('会话末条记录无效，未修改原文件。'));
    if (!sameRevision(before, fs.fstatSync(fd, { bigint: true })) || !sameRevision(before, fs.statSync(info.file, { bigint: true }))) throw new Error(t('会话正在写入，未修改原文件，请稍后重试。'));
    const record = { type: 'session_info', id: randomUUID(),
      parentId: entry.type === 'session' ? null : entry.id, timestamp: new Date().toISOString(), name };
    const separator = raw.endsWith('\n') ? '' : '\n';
    const bytes = Buffer.from(separator + JSON.stringify(record) + '\n');
    let written = 0;
    try {
      written = fs.writeSync(fd, bytes, 0, bytes.length, size);
      if (written !== bytes.length) throw new Error(t('名称写入不完整，请检查磁盘空间。'));
      fs.fsyncSync(fd);
    } catch (error) {
      // Roll back only our own partial append. Never truncate another writer's bytes.
      const current = fs.fstatSync(fd);
      if (written > 0 && current.size === size + written) {
        const check = Buffer.alloc(written);
        fs.readSync(fd, check, 0, written, size);
        if (check.equals(bytes.subarray(0, written))) { fs.ftruncateSync(fd, size); fs.fsyncSync(fd); }
      }
      throw error;
    }
    return name;
  } finally { fs.closeSync(fd); }
}
export { validateName, renameClosedSession };
