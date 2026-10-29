import type { TerminalKind, TerminalState } from './contracts.js';
/** Pi tabs share one project workspace and one active-tab history. */
export class WorkspaceState {
  terminals = new Map<string | null, TerminalState>();
  activeTabs = new Map<string | null, string>();
  tabVisits = new Map<string | null, string[]>();
  unreadCompletions = new Set<string | null>();
  list(projectId: string | null, kind?: TerminalKind) {
    return [...this.terminals.values()].filter(t => t.running && t.projectId === projectId &&
      (kind ? t.kind === kind : t.kind === 'pi'));
  }
  apply(state: TerminalState) {
    const previous = this.terminals.get(state.id);
    if (!state.running) {
      this.terminals.delete(state.id);
      this.unreadCompletions.delete(state.id);
      const visits = (this.tabVisits.get(state.projectId) || []).filter(id => id !== state.id);
      this.tabVisits.set(state.projectId, visits);
      if (this.activeId(state.projectId) === state.id) this.selectTab(state.projectId, visits.at(-1) || 'history');
      if (!this.list(state.projectId).length) this.tabVisits.delete(state.projectId);
    } else {
      this.terminals.set(state.id, state);
      const changedSession = !previous || previous.runId !== state.runId || previous.sessionId !== state.sessionId;
      if (state.kind === 'pi' && state.status === 'done') {
        if (changedSession || previous.status !== 'done') this.unreadCompletions.add(state.id);
      } else this.unreadCompletions.delete(state.id);
      if (!previous && state.kind !== 'update') this.selectTab(state.projectId, state.id);
    }
    return { isNew: !previous && state.running, exited: Boolean(previous && !state.running) };
  }
  selectTab(projectId: string | null, id: string) {
    const state = this.terminals.get(id);
    if (id !== 'history' && (!state?.running || state.kind === 'update' || state.projectId !== projectId)) return;
    const visits = this.tabVisits.get(projectId) || ['history'];
    this.tabVisits.set(projectId, [...visits.filter(item => item !== id), id]);
    this.activeTabs.set(projectId, id);
  }
  acknowledgeCompletion(id: string | null) { return this.unreadCompletions.delete(id); }
  activate(id: string) {
    const state = this.terminals.get(id);
    if (!state || state.kind === 'update') return;
    this.selectTab(state.projectId, id);
    if (state.kind === 'pi') this.acknowledgeCompletion(id);
  }
  showHistory(projectId: string | null) { this.selectTab(projectId, 'history'); }
  activeId(projectId: string | null) { return this.activeTabs.get(projectId) || 'history'; }
  step(projectId: string | null, direction: number) {
    const ids = ['history', ...this.list(projectId).map(t => t.id)];
    const index = Math.max(0, ids.indexOf(this.activeId(projectId)));
    const id = ids[(index + direction + ids.length) % ids.length];
    if (id === 'history') this.showHistory(projectId); else this.activate(id);
    return id;
  }
}
