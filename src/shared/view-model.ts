import type { Project, TerminalState, HistorySession, StatusLabel, SessionMark, SessionMarkKind } from './contracts.js';
import { t } from './i18n.js';
export const sessionMarkKinds = ['favorite', 'pinned'] as const;
export function sessionMarkFor(marks: SessionMark[], projectId: string | null, sessionKey: string | null | undefined) {
  return sessionKey ? marks.find(mark => mark.projectId === projectId && mark.sessionKey === sessionKey) : undefined;
}
export function orderedProjects(projects: Project[]) {
  return [...projects].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}
/** Move within a pin group without dropping filtered-out projects or mutating the snapshot. */
export function projectOrderAfterMove(projects: Project[], sourceId: string, targetId: string, edge: 'before' | 'after'): string[] | null {
  const source = projects.find(project => project.id === sourceId), target = projects.find(project => project.id === targetId);
  if (!source || !target || sourceId === targetId || Boolean(source.pinned) !== Boolean(target.pinned)) return null;
  const ids = projects.map(project => project.id).filter(id => id !== sourceId);
  ids.splice(ids.indexOf(targetId) + (edge === 'after' ? 1 : 0), 0, sourceId);
  return ids.some((id, index) => id !== projects[index].id) ? ids : null;
}
export function prioritizeSessions(rows: HistorySession[], marks: SessionMark[], scope: SessionMarkKind) {
  const pinned: HistorySession[] = [], rest: HistorySession[] = [];
  for (const row of rows) (isPinnedMark(sessionMarkFor(marks, row.projectId, row.key), scope) ? pinned : rest).push(row);
  return [...pinned, ...rest];
}
function isPinnedMark(mark: SessionMark | undefined, scope: SessionMarkKind) {
  return Boolean(mark?.[scope]);
}
const statuses: Record<string, StatusLabel> = {
  error: { label: '错误', tone: 'error', priority: 6 },
  blocked: { label: '等待输入', tone: 'blocked', priority: 5 },
  working: { label: '工作中', tone: 'working', priority: 4 },
  done: { label: '完成', tone: 'done', priority: 3 },
  idle: { label: '空闲', tone: 'idle', priority: 2 },
  running: { label: '启动中', tone: 'idle', priority: 1 },
  stopping: { label: '停止中', tone: 'idle', priority: 0 }
};
export function statusFor(state: TerminalState | null | undefined): StatusLabel {
  if (!state?.running) return { label: t('未打开'), tone: 'offline', priority: -1, details: t('未在本应用中打开；不跟踪外部进程。') };
  const status = statuses[state.status] || statuses.running;
  return { ...status, label: t(status.label) };
}
export function projectStatus(terminals: TerminalState[], projectId: string | null) {
  const pi = terminals.filter(t => t.running && t.kind === 'pi' && t.projectId === projectId);
  if (!pi.length) return { ...statusFor(null), count: 0, total: 0, details: t('本应用中没有打开 Pi') };
  const best = pi.reduce((a, b) => statusFor(a).priority >= statusFor(b).priority ? a : b);
  const status = statusFor(best);
  const count = pi.filter(t => statusFor(t).label === status.label).length;
  const counts = new Map();
  for (const item of pi) { const label = statusFor(item).label; counts.set(label, (counts.get(label) || 0) + 1); }
  return { ...status, count, total: pi.length, details: [...counts].map(([name, count]) => t('{name} {count}', { name, count })).join(' · ') };
}
export function recentSessions(history: HistorySession[], terminals: TerminalState[], projects: Project[]): HistorySession[] {
  const knownProjects = new Set<string | null>(projects.map(p => p.id));
  const live = terminals.filter(t => t.running && t.kind === 'pi' && knownProjects.has(t.projectId));
  const used = new Set<string>();
  const result: HistorySession[] = history.filter(info => knownProjects.has(info.projectId)).map(info => {
    const owner = live.find(t => !t.ephemeral && (t.sessionKey ? t.sessionKey === info.key : t.projectId === info.projectId && t.sessionId === info.id));
    if (owner) used.add(owner.id);
    return { ...info, terminalId: owner?.id || null, state: owner || null, temporary: false,
      // Opening/resuming a Pi process is presence, not new conversation activity.
      activityAt: info.modifiedAt };
  });
  for (const state of live) if (!used.has(state.id)) result.push({
    key: null, id: state.sessionId, projectId: state.projectId, title: state.label,
    firstMessage: '', modifiedAt: state.startedAt, activityAt: state.startedAt,
    terminalId: state.id, state, temporary: true
  });
  return result.sort((a,b) => b.activityAt! - a.activityAt!);
}
export function filterSessionsByTime(rows: HistorySession[], range = 'month', now = Date.now()) {
  if (range === 'all') return rows;
  const cutoff = new Date(now);
  if (range === 'week') cutoff.setDate(cutoff.getDate() - 7);
  else {
    const day = cutoff.getDate();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - (range === 'quarter' ? 3 : 1));
    const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
    cutoff.setDate(Math.min(day, lastDay));
  }
  const since = cutoff.getTime();
  return rows.filter(info => {
    const activity = info.activityAt || info.modifiedAt;
    return Number.isFinite(activity) && activity >= since && activity <= now;
  });
}
export function sidebarSessions(rows: HistorySession[], project: Project, query = '', limit = 5, marks: SessionMark[] = []) {
  const all = rows.filter(info => info.projectId === project.id);
  const needle = query.trim().toLocaleLowerCase();
  const projectMatch = (project.name + ' ' + project.path).toLocaleLowerCase().includes(needle);
  const matched = !needle || projectMatch ? all : all.filter(info =>
    (info.title + ' ' + info.firstMessage + ' ' + info.id).toLocaleLowerCase().includes(needle));
  const ordered = prioritizeSessions(matched, marks, 'pinned');
  const pinned = ordered.filter(info => isPinnedMark(sessionMarkFor(marks, info.projectId, info.key), 'pinned')).length;
  return { items: ordered.slice(0, Math.max(limit, pinned)), total: all.length, matched: matched.length };
}
export function sidebarIndicator(status: StatusLabel) {
  if (status.priority === 1 || status.tone === 'working') return 'working';
  return ['done', 'blocked', 'error'].includes(status.tone) ? status.tone : 'none';
}
export function effectiveColumns(preferred: number, width: number) {
  return Math.max(1, Math.min(preferred, Math.floor((Math.max(0, width) + 16) / (240 + 16)) || 1));
}
