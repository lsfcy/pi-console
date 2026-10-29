import type { NavigationLocation } from '../../shared/contracts.js';
import { NavigationHistory } from '../../shared/navigation-history.js';
import type { WorkspaceController } from './workspace-controller.js';

export class NavigationModel {
  readonly history = new NavigationHistory();
  private epoch = 0;
  private restoring = false;
  constructor(private app: WorkspaceController) {}
  private location(): NavigationLocation {
    const app = this.app;
    return { route: app.route, projectId: app.selectedId, terminalId: app.workspace.activeId(app.selectedId),
      filter: app.recentFilter, timeRange: app.recentTimeRange, query: app.search, settingsSection: app.settingsSection,
      recentProject: app.recentProject, recentRange: app.recentRange,
      historyScroll: document.getElementById('history-panel')?.scrollTop || 0,
      monitorScroll: document.getElementById('monitor-panel')?.scrollTop || 0,
      settingsScroll: document.getElementById('settings-panel')?.scrollTop || 0 };
  }
  valid = (state: NavigationLocation) => state.route !== 'project' || !state.projectId || this.app.projects.some(p => p.id === state.projectId);
  record() { if (!this.restoring && this.history.visit(this.location())) this.epoch++; }
  replace = () => { if (!this.restoring) this.history.replace(this.location()); };
  canMove = (direction: number) => this.history.canMove(direction, this.valid);
  move(direction: number) {
    const app = this.app;
    if (app.modalOpen() || app.recordingShortcut) return false;
    this.replace();
    const state = this.history.move(direction, this.valid);
    if (!state) return false;
    const epoch = ++this.epoch;
    this.restoring = true;
    app.route = state.route;
    if (!state.projectId || app.projects.some(p => p.id === state.projectId)) app.selectedId = state.projectId;
    if (app.route === 'recent') app.recentFilter = state.filter;
    app.recentTimeRange = state.timeRange; app.search = state.query || '';
    app.recentProject = state.recentProject || 'all'; app.recentRange = state.recentRange || 'all';
    app.settingsSection = state.settingsSection || 'appearance';
    if (app.route === 'project' && app.selectedId) {
      const terminal = app.workspace.terminals.get(state.terminalId);
      if (terminal?.running && terminal.projectId === app.selectedId) app.workspace.activate(terminal.id);
      else app.workspace.showHistory(app.selectedId);
      app.expandedProjects.add(app.selectedId);
      app.safely(() => app.bridge.selectProject(app.selectedId));
    }
    app.syncCurrent(); app.publish();
    this.restoring = false;
    requestAnimationFrame(() => {
      if (epoch !== this.epoch) return;
      for (const [id, value] of [['history-panel', state.historyScroll], ['monitor-panel', state.monitorScroll], ['settings-panel', state.settingsScroll]] as const) {
        const element = document.getElementById(id); if (element) element.scrollTop = value || 0;
      }
      this.replace();
      if (app.route === 'project') app.focusActive();
      else (app.route === 'recent' ? document.querySelector<HTMLElement>('#recent-filter [aria-selected="true"]') : document.getElementById(app.route === 'settings' ? 'settings-tab-' + app.settingsSection : app.route + '-filter'))?.focus({ preventScroll: true });
    });
    return true;
  }
}
