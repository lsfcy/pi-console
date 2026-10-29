import type { ApplicationEvent, IpcRequests, InvokeResult, InvokeReply, PiGuiAPI } from '../shared/contracts.js';
import { contextBridge, ipcRenderer } from 'electron';
async function invoke<K extends keyof IpcRequests>(name: K, ...args: Parameters<IpcRequests[K]>): Promise<InvokeResult<K>> {
  // The main process validates origin and payloads; this is the typed transport boundary.
  const result: InvokeReply<InvokeResult<K>> = await ipcRenderer.invoke('pi-gui:' + name, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
const api: PiGuiAPI = {
  snapshot: () => invoke('snapshot'),
  refreshLibrary: () => invoke('refresh-library'),
  addProjects: () => invoke('add-projects'),
  selectProject: id => invoke('select-project', id),
  hideProject: id => invoke('hide-project', id),
  updateProject: (id, patch) => invoke('update-project', id, patch),
  chooseProjectDirectory: id => invoke('choose-project-directory', id),
  reorderProjects: ids => invoke('reorder-projects', ids),
  projectMenu: id => invoke('project-menu', id),
  openProject: (id, target) => invoke('open-project', id, target),
  openProjectMenu: id => invoke('open-project-menu', id),
  createPi: (id, options) => invoke('create-pi', id, options),
  newSessionMenu: id => invoke('new-session-menu', id),
  closeTerminal: (id, force = false) => invoke('close-terminal', id, force),
  endAllSessions: () => invoke('end-all-sessions'),
  closeProjectSessions: id => invoke('close-project-sessions', id),
  terminalMenu: id => invoke('terminal-menu', id),
  historyMenu: (id, key, options) => invoke('history-menu', id, key, options),
  setSessionUnread: (id, sessionKey, unread) => invoke('set-session-unread', id, sessionKey, unread),
  setSessionMark: (id, key, kind, enabled) => invoke('set-session-mark', id, key, kind, enabled),
  renameSession: (id, key, name) => invoke('rename-session', id, key, name),
  deleteSession: (id, key) => invoke('delete-session', id, key),
  setPreferences: patch => invoke('set-preferences', patch),
  shortcutRecording: active => invoke('shortcut-recording', active),
  readVersion: force => invoke('read-version', force),
  checkAppUpdate: force => invoke('check-app-update', force),
  openAppReleases: () => invoke('open-app-releases'),
  packages: () => invoke('packages'),
  attention: payload => invoke('attention', payload),
  runUpdate: target => invoke('run-update', target),
  updateLog: () => invoke('update-log'),
  clearUpdateLog: () => invoke('clear-update-log'),
  answerConfirmation: (id, result) => invoke('answer-confirmation', id, result),
  hideWindow: () => invoke('hide-window'),
  openExternal: url => invoke('open-external', url),
  revealTerminalPath: (id, runId, reference) => invoke('reveal-terminal-path', id, runId, reference),
  copy: text => invoke('copy', text),
  input: (id, runId, data) => ipcRenderer.send('pi-gui:input', id, runId, data),
  resize: (id, runId, cols, rows) => ipcRenderer.send('pi-gui:resize', id, runId, cols, rows),
  acknowledge: (id, runId, length) => ipcRenderer.send('pi-gui:ack', id, runId, length),
  reportStatus: (id, runId, status, message) => ipcRenderer.send('pi-gui:status', id, runId, status, message),
  onEvent: callback => {
    const handler = (_event: Electron.IpcRendererEvent, value: ApplicationEvent) => callback(value);
    ipcRenderer.on('pi-gui:event', handler);
    return () => ipcRenderer.removeListener('pi-gui:event', handler);
  }
};
contextBridge.exposeInMainWorld('piGui', api);
