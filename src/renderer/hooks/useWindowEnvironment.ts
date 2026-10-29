import { useEffect, useLayoutEffect } from 'react';
import type { WorkspaceController } from '../state/workspace-controller.js';
export function useWindowEnvironment(app: WorkspaceController) {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = app.appearance;
    document.body.classList.toggle('sidebar-hidden', app.preferences.sidebarCollapsed);
    const resize = () => {
      const width = Math.round(Math.max(224, Math.min(app.preferences.sidebarWidth, Math.min(440, window.innerWidth - 620))));
      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
      app.terminals.requestLayout();
    };
    const observer = new ResizeObserver(resize);
    for (const id of ['workspace-body', 'main-area']) { const element = document.getElementById(id); if (element) observer.observe(element); }
    window.addEventListener('resize', resize); resize();
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [app, app.appearance, app.preferences.sidebarCollapsed, app.preferences.sidebarWidth]);
  useEffect(() => {
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const clearHint = () => { if (hintTimer) { clearTimeout(hintTimer); hintTimer = undefined; } };
    const blur = () => { app.stopShortcutRecording(); clearHint(); app.cancelNav(); };
    const focus = () => { if (app.acknowledgeCurrentCompletion(false)) app.publish(); };
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { clearHint(); return; }
      if (event.key !== 'Meta' || event.altKey || event.ctrlKey || event.shiftKey || event.repeat || hintTimer || app.navHeld) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.xterm')) return;
      // Navigation is immediate; hints appear only after holding Command for a full second.
      hintTimer = setTimeout(() => { hintTimer = undefined; app.setNavHeld(true); }, 1000);
    };
    const up = (event: KeyboardEvent) => { if (event.key === 'Meta' || !event.metaKey) { clearHint(); app.finishNav(); } };
    window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    const pointer = (event: PointerEvent) => {
      clearHint();
      if (!app.navHeld && !app.navPending && !app.navTarget) return;
      if (event.target instanceof Element && event.target.closest('.nav-enter-prompt')) return;
      app.cancelNav();
    };
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => { clearHint(); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true);
      window.removeEventListener('pointerdown', pointer, true); };
  }, [app]);
}
