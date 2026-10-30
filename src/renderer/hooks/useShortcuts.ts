import { useEffect } from 'react';
import type { WorkspaceController } from '../state/workspace-controller.js';
import { filteredProjects, globalRows, historyRows, projectMatches } from '../state/selectors.js';
import * as shortcuts from '../../shared/shortcuts.js';

export function useShortcuts(app: WorkspaceController) {
  useEffect(() => {
    const dispatch = (name: string) => {
      if (app.recordingShortcut) return;
      if (app.onboardingOpen) { if (name === 'close-tab') app.dismissOnboarding(); return; }
      if (name === 'settings') { if (!app.renameTarget) void app.openSettings(); return; }
      if (name === 'about') { app.aboutOpen = true; app.publish(); return; }
      if (name === 'copy') {
        const focused = [...app.views.values()].find(view => view.container.contains(document.activeElement));
        if (focused?.term.hasSelection()) app.safely(() => app.bridge.copy(focused.term.getSelection()));
        else {
          const active = document.activeElement;
          const text = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.selectionStart !== null
            ? active.value.slice(active.selectionStart, active.selectionEnd ?? active.selectionStart) : window.getSelection()?.toString();
          if (text) app.safely(() => app.bridge.copy(text));
        }
        return;
      }
      if (name === 'close-tab' && app.modalOpen()) { app.closeTopModal(); return; }
      if (app.modalOpen()) return;
      const projectSlot = shortcuts.projectCommands.findIndex(command => command.id === name);
      if (projectSlot >= 0) { app.selectProjectSlot(projectSlot); return; }
      if (name === 'shortcut-help') { void app.openSettings('shortcuts'); return; }
      if (name === 'back' || name === 'forward') { app.navigation.move(name === 'back' ? -1 : 1); return; }
      if (name === 'refresh') { app.safely(() => app.bridge.refreshLibrary()); return; }
      if (name === 'hide-window') { app.safely(() => app.bridge.hideWindow()); return; }
      if (name === 'running-recent') { app.search = ''; app.searchCursor = 0; app.showRecent('running'); return; }
      if (name === 'search') { app.openPalette(); return; }
      else if (name === 'recent') app.showRecent();
      else if (name === 'toggle-sidebar') void app.savePreferences({ sidebarCollapsed: !app.preferences.sidebarCollapsed });
      else if (name === 'add') app.safely(async () => { const snapshot = await app.bridge.addProjects(); if (snapshot.added) app.route = 'project'; app.applySnapshot(snapshot, { select: Boolean(snapshot.added) }); });
      else if (name === 'new-tab') void app.createPi();
      else if (name === 'new-temporary-tab') void app.createPi(false, undefined, app.selectedId, true);
      else if (name === 'open-terminal') app.openTerminal();
      else if (name === 'close-tab') {
        if (app.route === 'settings') { app.leaveSettings(); return; }
        if (app.route !== 'project') return;
        const id = app.workspace.activeId(app.selectedId);
        if (id && id !== 'history') {
          const state = app.workspace.terminals.get(id);
          if (state?.kind === 'pi') app.closePiTab(id);
          else void app.closeTerminal(id);
        } else app.safely(() => app.bridge.hideWindow());
      } else if (name === 'next-attention') app.jumpAttention(1);
      else if (name === 'previous-attention') app.jumpAttention(-1);
      else if (name === 'close-project-sessions') app.closeProjectSessions();
      else if (name === 'end-all') app.safely(() => app.bridge.endAllSessions());
      else if (name === 'previous-tab' || name === 'next-tab') {
        if (app.route !== 'project') return;
        app.navTarget = null; app.navPending = false;
        app.workspace.step(app.selectedId, name === 'previous-tab' ? -1 : 1); app.syncCurrent(); app.publish(); app.focusActive();
      } else if (name === 'sidebar-previous' || name === 'sidebar-next') {
        app.stepSidebarSession(name === 'sidebar-next' ? 1 : -1);
      } else if (name === 'font-larger' || name === 'font-smaller') {
        const fontSize = Math.max(10, Math.min(22, app.preferences.fontSize + (name === 'font-larger' ? 1 : -1)));
        app.applyPreferences({ fontSize }); app.schedulePreference({ fontSize });
      }
    };
    app.dispatchShortcut = dispatch;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (app.recordingShortcut) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') { app.stopShortcutRecording(); return; }
        if (event.repeat || ['Meta', 'Shift', 'Control', 'Alt'].includes(event.key)) return;
        const value = shortcuts.fromEvent(event);
        if (!value) { app.shortcutError = '请使用包含 ⌘ 的组合键；Esc 取消。'; app.publish(); return; }
        void app.changeShortcut(app.recordingShortcut, value); return;
      }
      if (event.key === 'Escape' && (app.navHeld || app.navPending || app.navTarget)) { event.preventDefault(); event.stopImmediatePropagation(); app.cancelNav(); return; }
      if (event.key === 'Enter' && app.navPending && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); event.stopImmediatePropagation(); app.confirmNavTarget(); return; }
      const command = shortcuts.match(event, app.preferences.shortcuts);
      if (command === 'back' || command === 'forward') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && !app.modalOpen()) dispatch(command);
        return;
      }
      if (event.key === 'Escape' && app.paletteOpen) { event.preventDefault(); app.closePalette(); return; }
      if (command === 'close-tab' && app.paletteOpen) { event.preventDefault(); app.closePalette(); return; }
      if (app.modalOpen()) return;
      const projectNavigation = shortcuts.projectCommands.some(item => item.id === command);
      const navigation = projectNavigation || command && ['previous-tab', 'next-tab', 'sidebar-previous', 'sidebar-next'].includes(command);
      if (event.repeat && !navigation) return;
      if (event.key === 'Escape' && app.route === 'settings') { event.preventDefault(); app.leaveSettings(); return; }
      if (!command) return;
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm');
      if (editing && navigation && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!projectNavigation || !event.repeat) dispatch(command);
    };
    const search = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.id !== 'search' || event.metaKey || event.altKey || event.ctrlKey || event.isComposing) return;
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); app.searchCursor += event.key === 'ArrowDown' ? 1 : -1; app.publish(); requestAnimationFrame(() => document.querySelector('.search-hit')?.scrollIntoView({ block: 'nearest' })); }
      else if (event.key === 'Enter') {
        if (app.route === 'recent') { const row = historyRows(app).visible[0]; if (row) app.openHistoryItem(row); return; }
        if (app.statsVisible) { const row = globalRows(app)[0]; if (row) { app.statsTarget = row; app.publish(); } return; }
        const project = filteredProjects(app)[Math.max(0, app.searchCursor)];
        if (project) { const historyOnly = !projectMatches(project, app.search.trim().toLocaleLowerCase()); app.search = ''; app.selectProject(project.id, true, historyOnly); }
      } else if (event.key === 'Escape') { app.search = ''; app.publish(); app.focusActive(); }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keydown', search);
    return () => { app.dispatchShortcut = () => {}; document.removeEventListener('keydown', keydown, true); document.removeEventListener('keydown', search); };
  }, [app]);
}
