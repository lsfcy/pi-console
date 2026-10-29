import { useEffect, useLayoutEffect } from 'react';
import { AppContext, useWorkspace } from './state/AppContext.js';
import type { WorkspaceController } from './state/workspace-controller.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useWindowEnvironment } from './hooks/useWindowEnvironment.js';
import { IconDefinitions } from './components/Icon.js';
import { Chrome } from './components/Chrome.js';
import { Sidebar } from './components/Sidebar.js';
import { Workspace } from './components/Workspace.js';
import { Resizer } from './components/Resizer.js';
import { Notice } from './components/Notice.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { AboutDialog } from './components/AboutDialog.js';
import { ProjectDialog } from './features/sessions/ProjectDialog.js';
import { RenameDialog } from './features/sessions/RenameDialog.js';
import { StatsDialog } from './features/monitor/StatsDialog.js';
import { CommandPalette } from './features/palette/CommandPalette.js';
export function App({ controller }: { controller: WorkspaceController }) {
  return <AppContext value={controller}><Application /></AppContext>;
}
function Application() {
  const app = useWorkspace();
  useShortcuts(app); useWindowEnvironment(app);
  useEffect(() => { void app.start(); return () => app.dispose(); }, [app]);
  useLayoutEffect(() => {
    window.piGuiReady = app.ready;
    if (app.ready && app.testMode) window.__consoleTest = app;
    return () => { delete window.__consoleTest; };
  }, [app, app.ready, app.testMode]);
  return <>
    <IconDefinitions /><Chrome /><Sidebar /><Resizer /><Workspace />
    <ProjectDialog /><RenameDialog /><StatsDialog /><AboutDialog /><ConfirmationDialog /><Notice />
    {app.paletteOpen && <CommandPalette />}
  </>;
}
