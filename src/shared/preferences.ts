import type { Preferences } from './contracts.js';
export const defaultPreferences: Preferences = {
  sidebarTheme: 'system', workspaceTheme: 'system', historyLayout: 'cards', cardColumns: 3, language: 'zh-CN',
  confirmResume: true, confirmClose: false, completionSound: true, completionNotice: true, checkAppUpdates: true,
  sidebarCollapsed: false, fontSize: 13, sidebarWidth: 280, shortcuts: {}, onboardingSeen: false
};
