import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../shared/i18n.js';

/** Resolve an explicitly clicked terminal link without executing its contents. */
export function resolveLocalLink(reference: unknown, cwd: string): string {
  if (typeof reference !== 'string' || !reference || reference.length > 4096 || /[\x00-\x1f\x7f]/.test(reference)) {
    throw new Error(t('无效的本地文件链接。'));
  }
  let filename: string;
  try {
    if (/^file:/i.test(reference)) {
      const url = new URL(reference);
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.username || url.password) throw new Error();
      filename = fileURLToPath(url);
    } else {
      if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//') || reference.startsWith('\\\\')) throw new Error();
      // Markdown anchors and queries identify the target within the file, not the filename.
      const linkPath = reference.split(/[?#]/, 1)[0];
      filename = decodeURIComponent(linkPath);
      if (!filename || /[\x00-\x1f\x7f]/.test(filename)) throw new Error();
      if (filename === '~') filename = os.homedir();
      else if (filename.startsWith('~/')) filename = path.join(os.homedir(), filename.slice(2));
      filename = path.resolve(cwd, filename);
    }
  } catch { throw new Error(t('无效的本地文件链接。')); }
  if (/[\x00-\x1f\x7f]/.test(filename)) throw new Error(t('无效的本地文件链接。'));
  if (!fs.existsSync(filename)) throw new Error(t('链接指向的本地文件不存在：{path}', { path: filename }));
  return filename;
}
