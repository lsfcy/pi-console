/** Shared application contracts. Runtime IPC/file validation remains mandatory. */
export type AppTimer = ReturnType<typeof setTimeout> | undefined;
export type Appearance = 'light' | 'dark';
export type Theme = Appearance | 'system';
export type ProjectOpenTarget = 'finder' | 'vscode' | 'idea' | 'sourcetree' | 'iterm' | 'terminal';
export type TerminalKind = 'pi' | 'shell' | 'update';
export type UpdateTarget = 'self' | 'extensions' | 'all';
export type ProgramStatus = 'idle' | 'working' | 'blocked' | 'done' | 'error';
export type TerminalStatus = ProgramStatus | 'running' | 'stopping' | 'stopped' | 'exited';
export type ShortcutOverrides = Record<string, string | null>;
export interface Project { id: string; name: string; path: string; source?: 'manual' | 'history'; available?: boolean; pinned?: true }
export interface Preferences {
  sidebarTheme: Theme; workspaceTheme: Theme; historyLayout: 'cards' | 'list'; cardColumns: number; language: 'zh-CN' | 'en-US';
  confirmResume: boolean; confirmClose: boolean; completionSound: boolean; completionNotice: boolean; checkAppUpdates: boolean;
  sidebarCollapsed: boolean; fontSize: number; sidebarWidth: number; shortcuts: ShortcutOverrides;
}
export interface SessionReference { projectId: string; sessionKey: string }
export type SessionMarkKind = 'favorite' | 'pinned';
export type SessionMark = SessionReference & Partial<Record<SessionMarkKind, true>>;
export interface SessionMenuOptions extends SessionIdentity { terminalId?: string | null; sessionKey?: string | null; unread?: boolean }
export interface ProjectData {
  version: number; projects: Project[]; selectedId: string | null; hiddenPaths?: string[]; unreadSessions?: SessionReference[]; sessionMarks?: SessionMark[];
  preferences?: Partial<Preferences> & { theme?: Theme };
}
export interface TerminalState {
  id: string; runId: string; projectId: string | null; cwd: string; kind: TerminalKind; pid: number | null;
  running: boolean; status: TerminalStatus; message: string; sessionFile: string | null; sessionKey: string | null;
  sessionId: string | null; bridgeReady: boolean; appearance: Appearance; cols: number; rows: number;
  updateTarget: UpdateTarget | null; label: string; persistent?: boolean;
  startedAt: number; exitCode?: number; signal?: number; ephemeral?: boolean;
}
export interface PersistedTerminal extends TerminalState { version: 1; token: string; socketPath: string }
export interface SessionStats {
  userMessages: number; assistantMessages: number; toolCalls: number; toolResults: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  reasoningTokens: number; totalTokens: number; contextTokens: number;
  costInput: number; costOutput: number; costCacheRead: number; costCacheWrite: number; costTotal: number;
  requestDurationMs: number; errors: number; aborts: number; lastUsageAt: number;
  models: string[]; providers: string[]; lastModel: string; lastProvider: string; lastThinkingLevel: string;
  cacheHitRate: number; sessionBytes: number;
}
export interface HistorySession {
  key: string | null; id: string | null; title: string; firstMessage: string; projectId: string | null;
  createdAt?: number; modifiedAt: number; stats?: SessionStats; terminalId?: string | null;
  state?: TerminalState | null; temporary?: boolean; activityAt?: number;
}
export interface SessionInfo extends Omit<HistorySession, 'key' | 'id' | 'projectId'> {
  key: string; id: string; file: string; cwd: string; name: string; createdAt: number; stats: SessionStats;
}
export interface LibraryStatus { loading: boolean; roots: string[]; warnings: string[]; scannedAt?: number; sessionCount?: number }
export interface CatalogResult { sessions: SessionInfo[]; roots: string[]; warnings: string[]; scannedAt: number }
export interface UpdateLog { state: TerminalState; output?: string }
export interface AppRelease { currentVersion: string; latestVersion: string; available: boolean; url: string; channel: 'stable' | 'prerelease' }
export interface Snapshot extends ProjectData {
  terminals: TerminalState[]; history: HistorySession[]; preferences: Preferences; appearance: Appearance;
  sidebarAppearance: Appearance; update: UpdateLog | null; piVersion: string | null; appVersion: string;
  sandbox: boolean; testMode?: boolean; automaticAppUpdateCheck?: boolean; library: LibraryStatus; added?: boolean;
}
export interface CreatePiOptions { resume?: boolean; sessionKey?: string | null; cols?: number; rows?: number; ephemeral?: boolean; fork?: boolean }
export interface SessionIdentity { runId?: string; sessionId?: string | null }
export interface AttentionPayload extends SessionIdentity {
  title: string; body: string; terminalId: string; sound: boolean; notice: boolean;
}
export interface ConfirmationOptions {
  type: 'question' | 'warning' | 'error'; message: string; detail?: string; buttons: string[];
  defaultId?: number; cancelId?: number; destructiveId?: number; checkboxLabel?: string; checkboxChecked?: boolean;
}
export interface ConfirmationRequest extends ConfirmationOptions { id: string }
export interface ConfirmationResult { response: number; checkboxChecked: boolean }
export type Confirm = (options: ConfirmationOptions) => Promise<ConfirmationResult>;
export interface RenameRequest { projectId: string | null; key: string; title: string }
export type ApplicationEvent =
  | { type: 'projects'; snapshot: Snapshot }
  | { type: 'state'; state: TerminalState }
  | { type: 'preferences'; preferences: Preferences; appearance: Appearance; sidebarAppearance: Appearance }
  | { type: 'data'; id: string; runId: string; kind: TerminalKind; data: string }
  | { type: 'notice'; message: string }
  | { type: 'confirmation'; request: ConfirmationRequest | null }
  | { type: 'shortcut'; name: string }
  | { type: 'cancel-shortcut-recording' }
  | { type: 'nav-release'; commit?: boolean }
  | { type: 'project-edit-request'; projectId: string | null }
  | ({ type: 'rename-request' } & RenameRequest)
  | { type: 'stats-request'; projectId: string | null; key: string }
  | ({ type: 'session-read' } & SessionReference)
  | ({ type: 'activate-terminal'; id: string | null } & SessionIdentity);
export interface PreferenceResult { preferences: Preferences; appearance: Appearance; sidebarAppearance: Appearance }
export interface IpcRequests {
  snapshot(): Snapshot;
  'refresh-library'(): Promise<Snapshot>;
  'add-projects'(): Promise<Snapshot>;
  'select-project'(id: string | null): Snapshot;
  'hide-project'(id: string | null): Promise<Snapshot>;
  'update-project'(id: string | null, patch: Partial<Pick<Project, 'name' | 'path'>>): Promise<Snapshot>;
  'choose-project-directory'(id: string | null): Promise<string | null>;
  'reorder-projects'(ids: string[]): Snapshot;
  'project-menu'(id: string | null): void;
  'open-project'(id: string | null, target: ProjectOpenTarget): Promise<void>;
  'open-project-menu'(id: string | null): void;
  'create-pi'(id: string | null, options?: CreatePiOptions): Promise<TerminalState | null>;
  'new-session-menu'(id: string | null): Promise<'normal' | 'temporary' | null>;
  'close-terminal'(id: string | null, force?: boolean): Promise<void>;
  'end-all-sessions'(): Promise<void>;
  'close-project-sessions'(id: string | null): Promise<void>;
  'terminal-menu'(id: string | null): void;
  'history-menu'(id: string | null, key: string | null, options?: SessionMenuOptions): Promise<void>;
  'set-session-unread'(id: string | null, sessionKey: string, unread: boolean): Snapshot;
  'set-session-mark'(id: string | null, key: string, kind: SessionMarkKind, enabled: boolean): Promise<Snapshot>;
  'rename-session'(id: string | null, key: string, name: string): Promise<Snapshot>;
  'delete-session'(id: string | null, key: string): Promise<Snapshot>;
  'set-preferences'(patch: Partial<Preferences>): PreferenceResult;
  'shortcut-recording'(active: boolean): boolean;
  'read-version'(force?: boolean): Promise<string>;
  'check-app-update'(force?: boolean): Promise<AppRelease>;
  'open-app-releases'(): Promise<void>;
  packages(): Promise<{ file: string; packages: string[] }>;
  attention(payload: AttentionPayload): boolean;
  'run-update'(target: UpdateTarget): Promise<TerminalState | null>;
  'update-log'(): UpdateLog | null;
  'clear-update-log'(): void;
  'answer-confirmation'(id: string, result: ConfirmationResult): void;
  'hide-window'(): void;
  'open-external'(url: string): Promise<void>;
  'reveal-terminal-path'(id: string, runId: string, reference: string): void;
  copy(text: string): Promise<void>;
}
export type InvokeResult<K extends keyof IpcRequests> = Awaited<ReturnType<IpcRequests[K]>>;
export type InvokeReply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface IpcMessages {
  input: [id: string, runId: string, data: string]; resize: [id: string, runId: string, cols: number, rows: number];
  ack: [id: string, runId: string, length: number]; status: [id: string, runId: string, status: ProgramStatus, message: string];
}
export interface PiGuiAPI {
  snapshot(): Promise<Snapshot>; refreshLibrary(): Promise<Snapshot>; addProjects(): Promise<Snapshot>;
  selectProject(id: string | null): Promise<Snapshot>; hideProject(id: string | null): Promise<Snapshot>;
  updateProject(id: string | null, patch: Partial<Pick<Project, 'name' | 'path'>>): Promise<Snapshot>;
  chooseProjectDirectory(id: string | null): Promise<string | null>; reorderProjects(ids: string[]): Promise<Snapshot>;
  projectMenu(id: string | null): Promise<void>; createPi(id: string | null, options?: CreatePiOptions): Promise<TerminalState | null>;
  openProject(id: string | null, target: ProjectOpenTarget): Promise<void>;
  openProjectMenu(id: string | null): Promise<void>;
  newSessionMenu(id: string | null): Promise<'normal' | 'temporary' | null>;
  closeTerminal(id: string | null, force?: boolean): Promise<void>;
  endAllSessions(): Promise<void>;
  closeProjectSessions(id: string | null): Promise<void>;
  terminalMenu(id: string | null): Promise<void>;
  historyMenu(id: string | null, key: string | null, options?: SessionMenuOptions): Promise<void>;
  setSessionUnread(id: string | null, sessionKey: string, unread: boolean): Promise<Snapshot>;
  setSessionMark(id: string | null, key: string, kind: SessionMarkKind, enabled: boolean): Promise<Snapshot>;
  renameSession(id: string | null, key: string, name: string): Promise<Snapshot>;
  deleteSession(id: string | null, key: string): Promise<Snapshot>;
  setPreferences(patch: Partial<Preferences>): Promise<PreferenceResult>; shortcutRecording(active: boolean): Promise<boolean>;
  readVersion(force?: boolean): Promise<string>; checkAppUpdate(force?: boolean): Promise<AppRelease>; openAppReleases(): Promise<void>; packages(): Promise<{ file: string; packages: string[] }>;
  attention(payload: AttentionPayload): Promise<boolean>; runUpdate(target: UpdateTarget): Promise<TerminalState | null>;
  clearUpdateLog(): Promise<void>; answerConfirmation(id: string, result: ConfirmationResult): Promise<void>;
  updateLog(): Promise<UpdateLog | null>; hideWindow(): Promise<void>; openExternal(url: string): Promise<void>;
  revealTerminalPath(id: string, runId: string, reference: string): Promise<void>; copy(text: string): Promise<void>;
  input(id: string, runId: string, data: string): void; resize(id: string, runId: string, cols: number, rows: number): void;
  acknowledge(id: string, runId: string, length: number): void;
  reportStatus(id: string, runId: string, status: ProgramStatus, message: string): void;
  onEvent(callback: (event: ApplicationEvent) => void): () => void;
}
export interface NavigationLocation {
  route: string; projectId: string | null; terminalId: string; filter: string; timeRange: string; query: string;
  recentProject?: string; recentRange?: 'week' | 'month' | 'all';
  settingsSection?: string; historyScroll?: number; monitorScroll?: number; settingsScroll?: number;
}
export interface StatusLabel { label: string; tone: string; priority: number; details?: string; count?: number; total?: number }
/** Narrow view of a real PTY; tests can provide a fake without the full node-pty API. */
export interface PtyProcess {
  pid: number; write(data: string): void; resize(cols: number, rows: number): void; kill(signal?: string): void;
  pause(): void; resume(): void; detach?(): void; socketPath?: string;
  onData(callback: (data: string) => void): unknown;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): unknown;
}
export interface RelayMeta { id: string; token: string; kind: TerminalKind }
export type SpawnPty = (shell: string, args: string[], options: import('node-pty').IPtyForkOptions & { relayMeta?: RelayMeta }) => PtyProcess;
export interface BridgeMetadata {
  token?: string; cwd?: string; sessionId?: string; sessionFile?: string | null; appearance?: string;
  name?: string; requestId?: string; ok?: boolean;
  error?: string;
}
export interface SessionEntry {
  type?: string; id?: string; cwd?: string; name?: string; timestamp?: string; version?: number;
  message?: {
    role?: string; content?: string | { type?: string; text?: string }[]; model?: string; provider?: string;
    thinkingLevel?: string; durationMs?: number; stopReason?: string; timestamp?: number;
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number;
      totalTokens?: number; cost?: Partial<Record<'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'total', number>> };
  };
}
