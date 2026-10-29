import { t } from '../shared/i18n.js';
import type { PtyProcess } from '../shared/contracts.js';
import { execFile } from 'node:child_process';
import * as errors from '../shared/errors.js';
import { promisify } from 'node:util';
const exec = promisify(execFile);

function descendantGroups(output: string, root: number) {
  const rows = output.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
    .filter(row => row.length === 3 && row.every(Number.isInteger));
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows) {
      if (ids.has(ppid) && !ids.has(pid)) { ids.add(pid); changed = true; }
    }
  }
  // Signal only groups whose leader belongs to this Pi tree, never the GUI's group.
  const groups = new Set(rows.filter(([pid, , pgid]) => ids.has(pid) && ids.has(pgid)).map(r => r[2]));
  const individuals = rows.filter(([pid, , pgid]) => ids.has(pid) && !groups.has(pgid)).map(r => r[0]);
  return { groups: [...groups], individuals };
}

async function terminateTree(terminal: Pick<PtyProcess, 'pid' | 'kill'>, graceMs = 1000) {
  let targets: { groups: number[]; individuals: number[] } = { groups: [], individuals: [] };
  try {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { timeout: 2000, maxBuffer: 8 * 1024 * 1024 });
    targets = descendantGroups(stdout, terminal.pid);
  } catch { /* PTY kill below remains available if ps is unavailable. */ }
  function signalAll(signal: NodeJS.Signals) {
    for (const pid of [...targets.groups.map(pid => -pid), ...targets.individuals]) {
      try { process.kill(pid, signal); } catch (error) { if (errors.code(error) !== 'ESRCH') console.error(errors.message(error)); }
    }
    try { terminal.kill(signal); } catch { /* Already exited. */ }
  }
  signalAll('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, graceMs));
  signalAll('SIGKILL');
  // A completed stop means the owned processes actually exited, not just that signals were sent.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,pgid=,stat='], { timeout: 2000, maxBuffer: 8 * 1024 * 1024 });
    const live = stdout.trim().split('\n').some(line => {
      const [pid, group, status] = line.trim().split(/\s+/);
      return !status.startsWith('Z') && (Number(pid) === terminal.pid ||
        targets.individuals.includes(Number(pid)) || targets.groups.includes(Number(group)));
    });
    if (!live) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(t('终端子进程未完全退出，请人工检查后重试。'));
}

export { descendantGroups, terminateTree };
