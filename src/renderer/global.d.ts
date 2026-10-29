import type { PiGuiAPI } from '../shared/contracts.js';
import type { WorkspaceController } from './state/workspace-controller.js';
declare global {
  interface Window {
    piGui: PiGuiAPI;
    piGuiReady?: boolean;
    /** Installed only for explicit Electron test mode. Never present in normal windows. */
    __consoleTest?: WorkspaceController;
  }
}
