import { createContext, useContext, useSyncExternalStore } from 'react';
import type { WorkspaceController } from './workspace-controller.js';
export const AppContext = createContext<WorkspaceController | null>(null);
export function useWorkspace() {
  const app = useContext(AppContext);
  if (!app) throw new Error('Workspace provider is missing');
  useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  return app;
}
