import type { HistorySession, Project, TerminalState } from '../../shared/contracts.js';
import { filterSessionsByTime, orderedProjects, prioritizeSessions, recentSessions, sidebarSessions } from '../../shared/view-model.js';
import type { WorkspaceController } from './workspace-controller.js';
export const projectMatches = (project: Project, query: string) => (project.name + ' ' + project.path).toLocaleLowerCase().includes(query);
export const historyMatches = (info: HistorySession, query: string) => (info.title + ' ' + info.firstMessage + ' ' + info.id).toLocaleLowerCase().includes(query);
export const recentRows = (app: WorkspaceController) => recentSessions(app.sessionHistory, [...app.workspace.terminals.values()], app.projects);
export const projectHistory = (app: WorkspaceController, id = app.selectedId) => app.sessionHistory.filter(info => info.projectId === id);
export function ownerFor(app: WorkspaceController, info: HistorySession): TerminalState | undefined {
  if (info.key) return [...app.workspace.terminals.values()].find(state => state.running && state.kind === 'pi' && !state.ephemeral && state.projectId === info.projectId &&
    (state.sessionKey ? state.sessionKey === info.key : state.sessionId === info.id));
  const state = app.workspace.terminals.get(info.terminalId || null);
  return state?.running && state.kind === 'pi' && state.projectId === info.projectId && state.sessionId === info.id &&
    (!info.state?.runId || state.runId === info.state.runId) ? state : undefined;
}
function matchesSearch(app: WorkspaceController, info: HistorySession) {
  const query = app.search.trim().toLocaleLowerCase(), project = app.projects.find(item => item.id === info.projectId);
  return !query || historyMatches(info, query) || Boolean(project && projectMatches(project, query));
}
export function globalRows(app: WorkspaceController, all = recentRows(app)) {
  const stats = app.statsVisible, filter = stats ? app.monitorFilter : app.recentFilter;
  const rows = (stats ? filterSessionsByTime(all, app.recentTimeRange) : filterSessionsByTime(all, app.recentRange).filter(info =>
    app.recentProject === 'all' || info.projectId === app.recentProject)).filter(info =>
    (filter !== 'running' || Boolean(info.state?.running || ownerFor(app, info))) &&
    (filter !== 'favorites' || Boolean(app.sessionMark(info)?.favorite)) && matchesSearch(app, info));
  return rows;
}
export function sidebarSessionSlots(app: WorkspaceController) {
  const query = app.search.trim();
  const rows = recentRows(app);
  const slots: HistorySession[] = [];
  for (const project of filteredProjects(app)) {
    if (!app.expandedProjects.has(project.id)) continue;
    const sessions = sidebarSessions(rows, project, query, app.sidebarSessionLimits.get(project.id), app.sessionMarks);
    for (const info of sessions.items) {
      slots.push(info);
    }
  }
  return slots;
}
export function filteredProjects(app: WorkspaceController) {
  const query = app.search.trim().toLocaleLowerCase(), rows = recentRows(app);
  return orderedProjects(app.projects).filter(project => projectMatches(project, query) || sidebarSessions(rows, project, query).matched > 0);
}
export function historyRows(app: WorkspaceController) {
  const all = app.route === 'recent' ? recentRows(app) : projectHistory(app);
  if (app.route === 'recent') return { all, visible: globalRows(app, all) };
  return { all, visible: prioritizeSessions(all.filter(info => matchesSearch(app, info)), app.sessionMarks, 'pinned') };
}
