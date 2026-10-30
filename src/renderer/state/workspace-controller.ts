import type {
  AppTimer, Appearance, ApplicationEvent, ConfirmationRequest, HistorySession, LibraryStatus, PiGuiAPI, Preferences, SessionReference, SessionMark,
  Project, RenameRequest, SessionIdentity, Snapshot, TerminalState, UpdateLog, UpdateTarget, AppRelease
} from '../../shared/contracts.js';
import { sessionMarkFor } from '../../shared/view-model.js';
import { WorkspaceState } from '../../shared/workspace-state.js';
import { defaultPreferences } from '../../shared/preferences.js';
import * as shortcuts from '../../shared/shortcuts.js';
import { setLanguage, t } from '../../shared/i18n.js';
import { message } from '../../shared/errors.js';
import { ObservableModel } from './observable.js';
import { NavigationModel } from './navigation.js';
import { NoticeModel } from './notice-model.js';
import { TerminalRegistry } from '../terminal/terminal-registry.js';
import * as selectors from './selectors.js';

/** Window-scoped application state. Owns subscriptions; never owns OS process lifetime. */
export class WorkspaceController extends ObservableModel {
  readonly workspace = new WorkspaceState();
  readonly expandedProjects = new Set<string | null>();
  readonly sidebarSessionLimits = new Map<string, number>();
  readonly pendingProjects = new Set<string | null>();
  readonly closing = new Set<string | null>();
  readonly navigation = new NavigationModel(this);
  readonly notices = new NoticeModel(this.publish);
  readonly terminals: TerminalRegistry;
  readonly shortcuts = shortcuts;
  projects: Project[] = [];
  sessionHistory: HistorySession[] = [];
  unreadSessions: SessionReference[] = [];
  sessionMarks: SessionMark[] = [];
  selectedId: string | null = null;
  route = 'project'; search = ''; searchCursor = 0;
  recentFilter = 'all'; monitorFilter = 'all'; recentTimeRange = 'month'; monitorSort = 'activity'; statsVisible = false;
  recentProject = 'all'; recentRange: 'week' | 'month' | 'all' = 'all'; navHeld = false; navTarget: HistorySession | null = null; navPending = false;
  settingsSection = 'appearance'; recordingShortcut: string | null = null; savingShortcuts = false; shortcutError = '';
  preferences: Preferences = structuredClone(defaultPreferences);
  appearance: Appearance = 'dark'; sidebarMode: Appearance = 'dark';
  library: LibraryStatus = { loading: true, roots: [], warnings: [] };
  appVersion = ''; sandboxMode = false; ready = false; testMode = false;
  appRelease: AppRelease | null = null; appUpdateChecking = false; appUpdateError = '';
  paletteOpen = false; onboardingOpen = false;
  confirmation: ConfirmationRequest | null = null;
  statsTarget: HistorySession | null = null; renameTarget: RenameRequest | null = null; projectEditTarget: string | null = null; aboutOpen = false;
  update: UpdateLog | null = null; updateLaunching = false; updateOutput = '';
  piVersion = '尚未读取版本'; piPackages = '正在读取已安装插件…'; packageFile = '';
  private unsubscribe?: () => void;
  private preferenceTimer: AppTimer;
  private statsTimer: AppTimer;
  private appUpdateTimer: AppTimer;
  private appUpdateEpoch = 0;
  private automaticUpdatesSupported = false;
  private lastNotifiedAppVersion: string | null = null;
  private pendingPreferences: Partial<Preferences> = {};
  private initialized = false;
  private disposed = false;
  private generation = 0;
  private visibleSession: string | null = null;
  private readonly readRequests = new Set<string>();

  constructor(readonly bridge: PiGuiAPI) {
    super();
    this.terminals = new TerminalRegistry(bridge, this.notify);
  }
  protected beforePublish() {
    if (this.route !== 'settings' && this.recordingShortcut) {
      this.recordingShortcut = null;
      this.safely(() => this.bridge.shortcutRecording(false));
    }
    this.navigation.record();
  }
  get views() { return this.terminals.views; }
  get noticeTimer() { return this.notices.timer; }
  get currentProject() { return this.route === 'project' ? this.projects.find(p => p.id === this.selectedId) : null; }
  notify = (value: string, action?: () => void) => this.notices.show(value, action);
  dismissNotice = () => this.notices.dismiss();
  safely = (action: () => unknown) => { void Promise.resolve().then(action).catch(error => this.notify(message(error))); };
  async start() {
    this.disposed = false; this.ready = false; this.automaticUpdatesSupported = false; this.stopAppUpdateChecks();
    const generation = ++this.generation;
    this.unsubscribe?.();
    this.unsubscribe = this.bridge.onEvent(this.onEvent);
    try {
      const snapshot = await this.bridge.snapshot();
      if (this.disposed || generation !== this.generation) return;
      this.applySnapshot(snapshot); this.ready = true;
      this.onboardingOpen = !this.preferences.onboardingSeen;
      this.automaticUpdatesSupported = snapshot.automaticAppUpdateCheck === true; this.publish();
      if (this.automaticUpdatesSupported && this.preferences.checkAppUpdates) this.startAppUpdateChecks();
    } catch (error) { this.notify(message(error)); }
  }
  dispose() {
    this.disposed = true; this.generation++; this.unsubscribe?.(); this.unsubscribe = undefined; this.appUpdateChecking = false;
    clearTimeout(this.preferenceTimer); clearTimeout(this.statsTimer); this.stopAppUpdateChecks(); this.notices.pause();
    this.terminals.dispose();
    if (this.recordingShortcut) void this.bridge.shortcutRecording(false).catch(() => {});
  }
  applySnapshot(snapshot: Snapshot, { select = false } = {}) {
    this.projects = snapshot.projects; this.sessionHistory = snapshot.history; this.library = snapshot.library;
    this.unreadSessions = snapshot.unreadSessions || [];
    this.sessionMarks = snapshot.sessionMarks || [];
    if (this.recentProject !== 'all' && !this.projects.some(p => p.id === this.recentProject)) this.recentProject = 'all';
    this.appVersion = snapshot.appVersion; this.sandboxMode = snapshot.sandbox; this.testMode = snapshot.testMode === true;
    this.applyPreferences(snapshot.preferences, snapshot.appearance, snapshot.sidebarAppearance, false);
    for (const state of snapshot.terminals) {
      if (state.kind === 'update') this.update = { state }; else this.workspace.apply(state);
    }
    if (select || !this.projects.some(p => p.id === this.selectedId)) this.selectedId = snapshot.selectedId || this.projects[0]?.id || null;
    for (const id of this.expandedProjects) if (!this.projects.some(p => p.id === id)) this.expandedProjects.delete(id);
    for (const id of this.sidebarSessionLimits.keys()) if (!this.projects.some(p => p.id === id)) this.sidebarSessionLimits.delete(id);
    if (!this.initialized && this.selectedId) { this.expandedProjects.add(this.selectedId); this.initialized = true; }
    this.update = snapshot.update || null; this.updateOutput = snapshot.update?.output || '';
    if (snapshot.piVersion) this.piVersion = snapshot.piVersion;
    this.syncCurrent(); this.publish();
  }
  applyPreferences(value: Partial<Preferences>, mode = this.appearance, side = this.sidebarMode, publish = true) {
    const languageChanged = value.language !== undefined && value.language !== this.preferences.language;
    const updateChecksChanged = value.checkAppUpdates !== undefined && value.checkAppUpdates !== this.preferences.checkAppUpdates;
    this.preferences = { ...this.preferences, ...value }; this.appearance = mode; this.sidebarMode = side;
    if (this.ready && this.automaticUpdatesSupported && updateChecksChanged) {
      if (this.preferences.checkAppUpdates) this.startAppUpdateChecks(); else this.stopAppUpdateChecks();
    }
    setLanguage(this.preferences.language);
    if (publish) this.publish();
    this.terminals.requestLayout();
    if (languageChanged && this.route === 'settings') {
      void this.readPackages();
      void this.bridge.updateLog().then(update => {
        if (!update) return;
        this.update = update; this.updateOutput = update.output || ''; this.publish();
      }).catch(() => {});
    }
  }
  sessionMark = (info: HistorySession) => sessionMarkFor(this.sessionMarks, info.projectId, info.key);
  isMarkedUnread = (projectId: string | null, sessionKey: string | null) => Boolean(sessionKey && this.unreadSessions.some(ref => ref.projectId === projectId && ref.sessionKey === sessionKey));
  isSessionUnread = (info: HistorySession) => this.isMarkedUnread(info.projectId, info.key || info.state?.sessionKey || this.workspace.terminals.get(info.terminalId || null)?.sessionKey || null) || this.workspace.unreadCompletions.has(info.terminalId || null);
  private readSession(state: TerminalState | null | undefined) {
    if (!state?.projectId || !state.sessionKey || !this.isMarkedUnread(state.projectId, state.sessionKey)) return false;
    const key = JSON.stringify([state.projectId, state.sessionKey]);
    if (this.readRequests.has(key)) return false;
    this.readRequests.add(key);
    this.safely(() => this.bridge.setSessionUnread(state.projectId, state.sessionKey!, false).finally(() => this.readRequests.delete(key)));
    return true;
  }
  syncCurrent() {
    const state = this.route === 'project' ? this.workspace.terminals.get(this.workspace.activeId(this.selectedId)) : null;
    const visible = state?.kind === 'pi' && state.running ? JSON.stringify([state.projectId, state.sessionKey || state.sessionId]) : null;
    // Metadata/refresh must not immediately undo “mark unread” on the current tab.
    if (document.hasFocus()) this.acknowledgeCurrentCompletion(visible !== this.visibleSession);
    this.visibleSession = visible;
    this.terminals.requestLayout();
  }
  acknowledgeCurrentCompletion = (includeMarked = true) => {
    if (this.route !== 'project') return false;
    const id = this.workspace.activeId(this.selectedId);
    const changed = this.workspace.acknowledgeCompletion(id);
    return (includeMarked && this.readSession(this.workspace.terminals.get(id))) || changed;
  };
  setProjectExpanded = (id: string, expanded: boolean) => {
    if (expanded) this.expandedProjects.add(id);
    else { this.expandedProjects.delete(id); this.sidebarSessionLimits.delete(id); }
    this.publish();
  };
  selectProject = (id: string | null, focus = true, historyOnly = false) => {
    this.route = 'project'; this.selectedId = id; this.statsVisible = false;
    if (historyOnly) this.workspace.showHistory(id);
    this.syncCurrent(); this.publish();
    if (id) this.safely(() => this.bridge.selectProject(id));
    if (focus) this.focusActive();
  };
  selectProjectSlot = (index: number) => {
    if (this.modalOpen() || this.recordingShortcut || !Number.isInteger(index) || index < 0 || index >= shortcuts.projectCommands.length) return;
    const project = selectors.filteredProjects(this)[index];
    if (!project) return;
    this.navTarget = null; this.navPending = false;
    this.expandedProjects.add(project.id);
    this.selectProject(project.id);
  };
  showRecent = (filter = 'all') => { this.route = 'recent'; this.recentFilter = filter; this.statsVisible = false; this.syncCurrent(); this.publish(); this.safely(() => this.bridge.refreshLibrary()); };
  setStatsVisible = (visible: boolean) => {
    this.statsVisible = visible; this.publish();
    if (visible) this.safely(() => this.bridge.refreshLibrary());
  };
  /** The hint layer is revealed only by the Command hold timer, never by navigation itself. */
  setNavHeld = (held: boolean) => {
    if (held && (this.modalOpen() || this.recordingShortcut)) return;
    if (this.navHeld === held) return;
    this.navHeld = held;
    if (held) this.navPending = false;
    this.publish();
  };
  /** Reuse an open Pi immediately; only unopened history requires Enter. */
  stepSidebarSession = (direction: number) => {
    const slots = selectors.sidebarSessionSlots(this);
    if (!slots.length) return;
    this.navPending = false;
    const active = this.route === 'project' ? this.workspace.activeId(this.selectedId) : null;
    const current = this.navTarget
      ? slots.findIndex(info => info.projectId === this.navTarget!.projectId && (info.key || info.terminalId) === (this.navTarget!.key || this.navTarget!.terminalId))
      : active ? slots.findIndex(info => info.terminalId === active || info.state?.id === active) : -1;
    const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
    this.navTarget = slots[(start + direction + slots.length) % slots.length];
    const owner = this.navOwner();
    if (owner) this.activateTerminal(owner.id, {}, { preserveSearch: true });
    else this.publish();
  };
  private navOwner() {
    return this.navTarget ? selectors.ownerFor(this, this.navTarget) : undefined;
  }
  finishNav = (commit = true) => {
    if (!commit) { this.cancelNav(); return; }
    if (!this.navHeld && (!this.navTarget || this.navPending)) return;
    this.navHeld = false;
    const owner = this.navOwner();
    if (owner) {
      this.navTarget = null; this.navPending = false;
      this.activateTerminal(owner.id, {}, { preserveSearch: true });
    } else { this.navPending = Boolean(this.navTarget); this.publish(); }
  };
  confirmNavTarget = () => {
    const target = this.navTarget;
    this.navTarget = null; this.navPending = false; this.navHeld = false; this.publish();
    if (target) this.openHistoryItem(target);
  };
  cancelNav = () => {
    this.navTarget = null; this.navPending = false; this.navHeld = false; this.publish();
  };
  activateTab = (id: string) => {
    if (id === 'history') { this.statsVisible = false; this.workspace.showHistory(this.selectedId); this.safely(() => this.bridge.refreshLibrary()); }
    else { this.workspace.activate(id); this.readSession(this.workspace.terminals.get(id)); }
    this.syncCurrent(); this.publish(); this.focusActive();
  };
  activateTerminal = (id: string | null, expected: SessionIdentity = {}, options: { preserveSearch?: boolean } = {}) => {
    this.paletteOpen = false;
    const state = this.workspace.terminals.get(id);
    if (!state?.running || !this.projects.some(p => p.id === state.projectId)) { this.notify(t('该会话已关闭，请从会话列表中恢复。')); return false; }
    if ((expected.runId && expected.runId !== state.runId) || (expected.sessionId && expected.sessionId !== state.sessionId)) { this.notify(t('该标签已切换会话，请从历史中打开原会话。')); return false; }
    if (!options.preserveSearch) { this.search = ''; this.searchCursor = 0; }
    this.expandedProjects.add(state.projectId); this.workspace.activate(state.id);
    if (state.kind === 'pi') this.readSession(state);
    this.selectProject(state.projectId, false); this.focusActive(); return true;
  };
  focusActive = () => {
    if (this.route === 'project') this.terminals.focus(this.workspace.activeId(this.selectedId));
  };
  openPalette = () => { this.paletteOpen = true; this.publish(); };
  closePalette = () => { if (!this.paletteOpen) return; this.paletteOpen = false; this.publish(); this.focusActive(); };
  private attentionRank(state: TerminalState) {
    if (!state.running || state.kind !== 'pi') return 0;
    if (state.status === 'blocked') return 4;
    if (state.status === 'error') return 3;
    if (state.status === 'done' && this.workspace.unreadCompletions.has(state.id)) return 2;
    return state.status === 'working' ? 1 : 0;
  }
  jumpAttention = (direction: number) => {
    const all = [...this.workspace.terminals.values()].filter(state => this.attentionRank(state) > 0)
      .sort((a, b) => this.attentionRank(b) - this.attentionRank(a) || b.startedAt - a.startedAt);
    if (!all.length) { this.notify(t('没有需要处理的会话')); return; }
    const active = this.route === 'project' ? this.workspace.activeId(this.selectedId) : null;
    const index = all.findIndex(state => state.id === active);
    const target = index < 0 ? (direction > 0 ? all[0] : all.at(-1)!) : all[(index + direction + all.length) % all.length];
    this.paletteOpen = false;
    this.activateTerminal(target.id);
  };
  openHistoryItem = (info: HistorySession) => {
    this.navTarget = null; this.navPending = false;
    const owner = selectors.ownerFor(this, info);
    if (owner) this.activateTerminal(owner.id);
    else if (info.key) void this.createPi(true, info.key, info.projectId);
    else this.notify(t('该会话已关闭，请从会话列表中恢复。'));
  };
  openSessionMenu = (info: HistorySession) => {
    const owner = info.terminalId ? this.workspace.terminals.get(info.terminalId) : selectors.ownerFor(this, info);
    this.safely(() => this.bridge.historyMenu(info.projectId, info.key, {
      terminalId: owner?.id, runId: owner?.runId, sessionId: info.id, sessionKey: owner?.sessionKey, unread: this.isSessionUnread(info)
    }));
  };
  toggleSessionFavorite = (info: HistorySession) => {
    if (!info.key) { this.notify(t('请先保存会话历史，再收藏。')); return; }
    const enabled = !this.sessionMark(info)?.favorite;
    this.safely(async () => this.applySnapshot(await this.bridge.setSessionMark(info.projectId, info.key!, 'favorite', enabled)));
  };
  toggleSessionPinned = (info: HistorySession) => {
    if (!info.key) { this.notify(t('请先保存会话历史，再置顶。')); return; }
    const enabled = !this.sessionMark(info)?.pinned;
    this.safely(async () => this.applySnapshot(await this.bridge.setSessionMark(info.projectId, info.key!, 'pinned', enabled)));
  };
  deleteHistorySession = (info: HistorySession) => {
    if (!info.key) { this.notify(t('尚未保存的会话没有历史文件，请关闭标签。')); return; }
    this.safely(async () => this.applySnapshot(await this.bridge.deleteSession(info.projectId, info.key!)));
  };
  newSessionMenu = (projectId = this.selectedId) => this.safely(async () => {
    const choice = await this.bridge.newSessionMenu(projectId);
    if (choice) await this.createPi(false, undefined, projectId, choice === 'temporary');
  });
  async createPi(resume = false, sessionKey?: string | null, projectId = this.route === 'project' ? this.selectedId : null, ephemeral = false) {
    const project = this.projects.find(p => p.id === projectId);
    if (!project) { this.notify(t('请先选择或添加项目。')); return; }
    if (this.pendingProjects.has(project.id)) return;
    this.pendingProjects.add(project.id); this.publish();
    try {
      const state = await this.bridge.createPi(project.id, { resume, sessionKey, ephemeral });
      if (state) { if (!this.workspace.terminals.has(state.id)) this.handleState(state); this.activateTerminal(state.id); }
    } catch (error) { this.notify(message(error)); }
    finally { this.pendingProjects.delete(project.id); this.publish(); }
  }
  openTerminal = () => {
    const project = this.currentProject;
    if (!project || project.available === false) return;
    this.safely(() => this.bridge.openProject(project.id, 'terminal'));
  }
  /** Cmd+W closes the process; idle/done close immediately, active work asks once. */
  closePiTab = (id: string) => {
    const state = this.workspace.terminals.get(id);
    if (!state?.running) return;
    const active = ['working', 'running', 'blocked'].includes(state.status);
    void this.closeTerminal(id, !active);
  };
  closeProjectSessions = () => {
    if (!this.selectedId) { this.notify(t('请先选择项目')); return; }
    this.safely(() => this.bridge.closeProjectSessions(this.selectedId));
  };
  async closeTerminal(id: string | null, force = false) {
    if (!id || this.closing.has(id)) return;
    this.closing.add(id); this.publish();
    try { await this.bridge.closeTerminal(id, force); } catch (error) { this.notify(message(error)); }
    finally { this.closing.delete(id); this.publish(); }
  }
  handleState(state: TerminalState) {
    if (state.kind === 'update') {
      if (this.update?.state.id !== state.id) this.updateOutput = '';
      this.update = { state }; this.publish();
      if (!state.running && state.exitCode === 0 && this.route === 'settings') void this.readPiVersion();
      return;
    }
    const previous = this.workspace.terminals.get(state.id);
    const wasActive = this.route === 'project' && this.selectedId === state.projectId && this.workspace.activeId(this.selectedId) === state.id;
    const change = this.workspace.apply(state);
    if (!state.running) this.terminals.discard(state.id);
    this.syncCurrent(); this.publish();
    if (state.running && state.kind === 'pi' && state.status === 'done' && previous && previous.status !== 'done') {
      this.attention(state); clearTimeout(this.statsTimer);
      this.statsTimer = setTimeout(() => this.safely(() => this.bridge.refreshLibrary()), 700);
    }
    if ((change.isNew && state.projectId === this.selectedId) || (change.exited && wasActive)) this.focusActive();
    if (!state.running && state.kind === 'pi' && state.exitCode === 127) this.notify(t('没有找到 pi，请确认登录 shell 中可以执行 pi。'));
    else if (!state.running && state.exitCode && state.status !== 'stopped') this.notify(t('“{label}”已退出（{code}）。', { label: state.label, code: state.exitCode }));
  }
  private attention(state: TerminalState) {
    const focused = document.hasFocus(), prefs = this.preferences;
    if (this.route === 'project' && this.selectedId === state.projectId && this.workspace.activeId(this.selectedId) === state.id && focused) return;
    const project = this.projects.find(p => p.id === state.projectId);
    const body = project?.name ? t('{project} · 已完成，等待输入', { project: project.name }) : t('已完成，等待输入');
    const target = { runId: state.runId, sessionId: state.sessionId };
    if (prefs.completionNotice && focused) this.notify(state.label + ' · ' + body, () => this.activateTerminal(state.id, target));
    this.safely(() => this.bridge.attention({ title: state.label, body, terminalId: state.id, ...target, sound: prefs.completionSound, notice: prefs.completionNotice && !focused }));
  }
  savePreferences = async (patch: Partial<Preferences>) => {
    clearTimeout(this.preferenceTimer);
    const merged = { ...this.pendingPreferences, ...patch }; this.pendingPreferences = {};
    try { const result = await this.bridge.setPreferences(merged); this.applyPreferences(result.preferences, result.appearance, result.sidebarAppearance); }
    catch (error) { this.notify(message(error)); }
  };
  schedulePreference(patch: Partial<Preferences>) {
    this.pendingPreferences = { ...this.pendingPreferences, ...patch };
    clearTimeout(this.preferenceTimer); this.preferenceTimer = setTimeout(() => void this.savePreferences({}), 160);
  }
  openOnboarding = () => {
    this.stopShortcutRecording(); this.cancelNav(); this.onboardingOpen = true; this.publish();
  };
  dismissOnboarding = () => {
    if (!this.onboardingOpen) return;
    this.onboardingOpen = false;
    if (!this.preferences.onboardingSeen) {
      this.applyPreferences({ onboardingSeen: true });
      void this.savePreferences({ onboardingSeen: true });
    } else this.publish();
  };
  openSettings = async (section = this.settingsSection) => {
    this.stopShortcutRecording(); this.route = 'settings'; this.settingsSection = section; this.syncCurrent(); this.publish();
    void this.readPiVersion(); void this.readPackages();
    requestAnimationFrame(() => document.getElementById('settings-tab-' + this.settingsSection)?.focus({ preventScroll: true }));
    try { const update = await this.bridge.updateLog(); if (update) { this.update = update; this.updateOutput = update.output || ''; this.publish(); } }
    catch (error) { this.notify(message(error)); }
  };
  leaveSettings = () => { this.stopShortcutRecording(); if (!this.navigation.move(-1)) this.selectProject(this.selectedId || this.projects[0]?.id || null); };
  stopShortcutRecording = () => {
    if (!this.recordingShortcut) return;
    this.recordingShortcut = null; this.safely(() => this.bridge.shortcutRecording(false)); this.publish();
  };
  async beginShortcutRecording(id: string) {
    if (this.savingShortcuts) return;
    this.recordingShortcut = id; this.shortcutError = ''; this.publish();
    try {
      await this.bridge.shortcutRecording(true);
      if (this.recordingShortcut !== id || this.route !== 'settings') this.stopShortcutRecording();
    } catch (error) { this.recordingShortcut = null; this.shortcutError = message(error); this.publish(); }
  }
  async saveShortcutOverrides(overrides: Preferences['shortcuts']) {
    if (this.savingShortcuts) return;
    try {
      const validated = shortcuts.validateOverrides(overrides);
      this.savingShortcuts = true; this.stopShortcutRecording(); this.publish();
      const result = await this.bridge.setPreferences({ shortcuts: validated });
      this.applyPreferences(result.preferences, result.appearance, result.sidebarAppearance); this.shortcutError = '';
    } catch (error) { this.shortcutError = message(error); }
    finally { this.savingShortcuts = false; this.publish(); }
  }
  changeShortcut = (id: string, value?: string | null) => {
    const next = { ...this.preferences.shortcuts };
    if (value === undefined) delete next[id]; else next[id] = value;
    return this.saveShortcutOverrides(next);
  };
  private stopAppUpdateChecks() {
    this.appUpdateEpoch++;
    clearTimeout(this.appUpdateTimer); this.appUpdateTimer = undefined;
  }
  private startAppUpdateChecks() {
    this.stopAppUpdateChecks();
    const epoch = this.appUpdateEpoch;
    const run = async () => {
      if (this.disposed || epoch !== this.appUpdateEpoch || !this.automaticUpdatesSupported || !this.preferences.checkAppUpdates) return;
      await this.checkAppUpdate(false, true);
      if (!this.disposed && epoch === this.appUpdateEpoch && this.automaticUpdatesSupported && this.preferences.checkAppUpdates) {
        this.appUpdateTimer = setTimeout(() => { this.appUpdateTimer = undefined; void run(); }, 60 * 60 * 1000);
      }
    };
    void run();
  }
  async checkAppUpdate(force = false, automatic = false) {
    if (this.appUpdateChecking) return;
    const generation = this.generation;
    this.appUpdateChecking = true; this.appUpdateError = ''; this.publish();
    try {
      const release = await this.bridge.checkAppUpdate(force);
      if (this.disposed || generation !== this.generation) return;
      this.appRelease = release;
      if (automatic && this.preferences.checkAppUpdates && release.available && release.latestVersion !== this.lastNotifiedAppVersion && !this.notices.value) {
        this.lastNotifiedAppVersion = release.latestVersion;
        this.notify(t('Pi Console 有新版本 {version}，可在设置 → 关于中查看。', { version: release.latestVersion }));
      }
    } catch (error) {
      if (!this.disposed && generation === this.generation && !automatic) this.appUpdateError = message(error);
    } finally {
      if (!this.disposed && generation === this.generation) { this.appUpdateChecking = false; this.publish(); }
    }
  }
  async readPiVersion(force = false) { try { this.piVersion = await this.bridge.readVersion(force); } catch (error) { this.piVersion = message(error); } this.publish(); }
  async readPackages() {
    try { const data = await this.bridge.packages(); this.piPackages = data.packages.length ? t('已安装插件：{packages}', { packages: data.packages.join(' · ') }) : t('Pi 配置中未发现 packages；可继续执行官方扩展更新命令。'); this.packageFile = data.file; }
    catch (error) { this.piPackages = message(error); } this.publish();
  }
  async runUpdate(target: UpdateTarget = 'self') {
    if (this.updateLaunching) return;
    this.updateLaunching = true; this.publish();
    try { const state = await this.bridge.runUpdate(target); if (state && this.update?.state.id !== state.id) { this.update = { state }; this.updateOutput = ''; } }
    catch (error) { this.notify(message(error)); }
    finally { this.updateLaunching = false; this.publish(); }
  }
  async clearUpdateLog() {
    try { await this.bridge.clearUpdateLog(); this.update = null; this.updateOutput = ''; this.publish(); }
    catch (error) { this.notify(message(error)); }
  }
  modalOpen = () => Boolean(this.onboardingOpen || this.paletteOpen || this.confirmation || document.querySelector('dialog[open]'));
  closeTopModal = () => {
    if (this.paletteOpen) { this.closePalette(); return; }
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    if (dialog?.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
  };
  private onEvent = (event: ApplicationEvent) => {
    if (this.disposed) return;
    switch (event.type) {
      case 'projects': this.applySnapshot(event.snapshot); break;
      case 'state': this.handleState(event.state); break;
      case 'preferences': this.applyPreferences(event.preferences, event.appearance, event.sidebarAppearance); break;
      case 'data':
        if (event.kind === 'update') { this.updateOutput = (this.updateOutput + event.data).slice(-128 * 1024); this.publish(); this.bridge.acknowledge(event.id, event.runId, event.data.length); }
        else if (this.workspace.terminals.get(event.id)?.runId === event.runId) this.terminals.write(event);
        else this.bridge.acknowledge(event.id, event.runId, event.data.length);
        break;
      case 'notice': this.notify(event.message); break;
      case 'confirmation': this.confirmation = event.request; this.publish(); break;
      case 'shortcut': this.shortcut(event.name); break;
      case 'cancel-shortcut-recording': this.stopShortcutRecording(); break;
      case 'nav-release': this.finishNav(event.commit !== false); break;
      case 'activate-terminal': this.activateTerminal(event.id, event); break;
      case 'project-edit-request': this.projectEditTarget = event.projectId; this.publish(); break;
      case 'rename-request': this.renameTarget = event; this.publish(); break;
      case 'stats-request': this.statsTarget = this.sessionHistory.find(info => info.key === event.key && info.projectId === event.projectId) || null; this.publish(); break;
      case 'session-read':
        for (const state of this.workspace.terminals.values()) if (state.projectId === event.projectId && state.sessionKey === event.sessionKey) this.workspace.acknowledgeCompletion(state.id);
        this.publish(); break;
    }
  };
  shortcut = (name: string) => { this.dispatchShortcut(name); };
  /** Assigned by the shortcut feature; avoids importing DOM keyboard behavior into state. */
  dispatchShortcut: (name: string) => void = () => {};
}
