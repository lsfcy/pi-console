import type { Appearance, Theme, TerminalState, CatalogResult, Snapshot, AttentionPayload, ApplicationEvent, ProjectOpenTarget, IpcRequests, IpcMessages, SpawnPty } from '../shared/contracts.js';
import { app, BrowserWindow, Menu, ipcMain, dialog, shell, clipboard, nativeTheme, Notification } from 'electron';
import * as errors from '../shared/errors.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectStore } from './project-store.cjs';
import { TerminalManager } from './terminal-manager.cjs';
import { SessionCatalog, canonical } from './session-catalog.cjs';
import { createSessionController } from './session-controller.cjs';
import * as desktop from './desktop-integration.cjs';
import * as shortcuts from '../shared/shortcuts.js';
import { t, getLanguage, setLanguage } from '../shared/i18n.js';
import { palettes } from '../shared/terminal-theme.js';
import { sessionMarkFor, sessionMarkKinds } from '../shared/view-model.js';
import { menuIcon } from './menu-icons.cjs';
import { Confirmations } from './confirmations.cjs';
import { createRelaySpawner } from './relay-spawner.cjs';
import { SessionStore } from './session-store.cjs';
import { resolveLocalLink } from './local-link.cjs';
import { AppReleaseChecker, APP_RELEASES_URL } from './app-release.cjs';

export async function showStartupError(title: string, message: string) {
  await app.whenReady();
  const failure = new BrowserWindow({ title: 'Pi Console', width: 640, height: 360, resizable: false,
    backgroundColor: '#151517', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  failure.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  failure.webContents.on('will-navigate', event => event.preventDefault());
  failure.on('closed', () => app.quit());
  const url = pathToFileURL(path.join(__dirname, '../renderer/index.html'));
  url.searchParams.set('startup-error', message); url.searchParams.set('startup-error-title', title);
  url.searchParams.set('language', getLanguage());
  await failure.loadURL(url.href);
}

function migrateLegacyUserData() {
  const current = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'Pi GUI');
  const source = path.join(legacy, 'projects.json');
  const target = path.join(current, 'projects.json');
  if (current !== legacy && !fs.existsSync(target) && fs.existsSync(source)) {
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o600);
  }
}

async function startApp({ spawnPty, trashItem = file => shell.trashItem(file), readVersion = desktop.piVersion, launchIterm = desktop.openIterm, launchTerminal = directory => desktop.openProject(directory, 'terminal'), playCompletionSound }: {
  spawnPty?: SpawnPty; trashItem?: (file: string) => Promise<void>; readVersion?: () => Promise<string>;
  launchIterm?: (directory: string) => Promise<void>; launchTerminal?: (directory: string) => Promise<void>; playCompletionSound?: () => void;
} = {}) {
  const sandbox = process.env.PI_GUI_SANDBOX === '1';
  const testMode = process.env.PI_GUI_TEST_MODE === '1';
  app.setName('Pi Console');
  // The profile is a persistent identity, not a display name: retain preferences AND the old instance lock.
  app.setPath('userData', process.env.PI_GUI_DATA_DIR ? path.resolve(process.env.PI_GUI_DATA_DIR)
    : path.join(app.getPath('appData'), 'Pi Session Console'));
  if (!process.env.PI_GUI_DATA_DIR) migrateLegacyUserData();
  if (!app.requestSingleInstanceLock()) { app.dock?.hide(); app.quit(); return null; }
  let window: BrowserWindow;
  let allowQuit = false;
  let askingQuit = false;
  let rendererRecoveries = 0;
  let notificationError: string | null = null;
  const notificationFailure = () => t('系统通知暂不可用：无法注册当前应用。{detail}', { detail: notificationError || '' });
  async function registerNotifications() {
    if (process.platform !== 'darwin' || !app.isPackaged || testMode) return;
    try { await desktop.registerApplication(path.resolve(process.execPath, '../../..')); notificationError = null; }
    catch (error) { notificationError = errors.message(error); console.error(notificationFailure()); }
  }
  app.on('second-instance', () => { desktop.focusWindow(window, app); void registerNotifications(); });
  await app.whenReady();
  await registerNotifications();
  // Packaged apps start as UI agents (LSUIElement). Only the lock owner becomes a Dock app.
  if (testMode) app.dock?.hide();
  else { await app.dock?.show(); app.dock?.setIcon(path.join(__dirname, '../../assets/icon.png')); }
  let projects: ProjectStore;
  try { projects = new ProjectStore(path.join(app.getPath('userData'), 'projects.json')); }
  catch (error) {
    await showStartupError(t('无法读取项目配置'), errors.message(error));
    return null;
  }
  nativeTheme.themeSource = 'system';
  setLanguage(projects.preferences().language);
  const resolveAppearance = (value: Theme): Appearance => value === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : value;
  const appearance = () => resolveAppearance(projects.preferences().workspaceTheme);
  const sidebarAppearance = () => resolveAppearance(projects.preferences().sidebarTheme);
  const relayEnabled = !spawnPty && !testMode && process.env.PI_GUI_NO_RELAY !== '1';
  const relaySpawn = relayEnabled ? createRelaySpawner({ relayPath: path.join(__dirname, '../host/relay.cjs') }) : null;
  const terminals = new TerminalManager({ spawn: relaySpawn || spawnPty || require('node-pty').spawn });
  const sessionStore = new SessionStore(path.join(app.getPath('userData'), 'sessions'), terminals);
  if (relayEnabled) sessionStore.start();
  const catalog = new SessionCatalog();
  const themeRequests = new Set<string>();
  let library: CatalogResult & { loading: boolean } = { sessions: [], roots: [], warnings: [], scannedAt: 0, loading: true };
  let refreshPromise: Promise<Snapshot> | null = null;
  const version = new desktop.VersionCache(readVersion);
  const metadata = require('../../package.json');
  const appVersion = metadata.version;
  const appRelease = new AppReleaseChecker(appVersion);
  const page = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
  const notices = new Set<Notification>();
  const sound = playCompletionSound || (() => {
    if (process.platform !== 'darwin') { try { shell.beep?.(); } catch {} return; }
    try { spawn('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], { stdio: 'ignore' }).unref(); } catch {}
  });
  const send = (event: ApplicationEvent) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('pi-gui:event', event);
  };
  const confirmations = new Confirmations(request => send({ type: 'confirmation', request }));
  const snapshot = (): Snapshot => {
    const saved = projects.snapshot();
    const ids = new Map(saved.projects.map(project => [project.path, project.id]));
    const history = library.sessions.filter(info => ids.has(info.cwd)).map(info => ({
      key: info.key, id: info.id, title: info.name || info.firstMessage || t('未命名会话 · {id}', { id: info.id.slice(0, 8) }), firstMessage: info.firstMessage,
      createdAt: info.createdAt, modifiedAt: info.modifiedAt, projectId: ids.get(info.cwd)!, stats: info.stats
    }));
    return {
      ...saved,
      projects: saved.projects.map(project => {
        let available = false;
        try { available = fs.statSync(project.path).isDirectory(); } catch {}
        return { ...project, available };
      }),
      terminals: terminals.list(), history, preferences: projects.preferences(), appearance: appearance(), sidebarAppearance: sidebarAppearance(),
      update: terminals.updateLog(), piVersion: version.value, appVersion, sandbox, testMode,
      automaticAppUpdateCheck: app.isPackaged && !sandbox && !testMode,
      library: { loading: library.loading, roots: library.roots, warnings: library.warnings,
        scannedAt: library.scannedAt, sessionCount: history.length }
    };
  };
  const publishProjects = () => send({ type: 'projects', snapshot: snapshot() });
  async function endAllSessions() {
    const running = terminals.list().filter(state => state.running);
    if (!running.length) return;
    const result = await confirmations.ask({
      type: 'warning', message: t('结束全部 {count} 个会话？', { count: running.length }),
      detail: t('将终止后台 Pi 及其子进程。已保存的 Pi 历史保留，可从会话列表恢复；临时会话和未完成任务会丢失。'),
      buttons: [t('取消'), t('结束全部')], defaultId: 0, cancelId: 0
    });
    if (result.response !== 1) return;
    await terminals.stopAll();
    sessionStore.clear();
    publishProjects();
  }
  async function closeProjectSessions(id: string | null) {
    const project = availableProject(id);
    const running = terminals.list().filter(state => state.projectId === project.id && state.running && state.kind === 'pi');
    if (!running.length) return;
    const result = await confirmations.ask({
      type: 'warning', message: t('结束“{name}”的 {count} 个会话？', { name: project.name, count: running.length }),
      detail: t('将终止该项目内所有后台 Pi 及其子进程。已保存的 Pi 历史保留，可从会话列表恢复；临时会话和未完成任务会丢失。'),
      buttons: [t('取消'), t('结束全部')], defaultId: 0, cancelId: 0
    });
    if (result.response !== 1) return;
    await Promise.all(running.map(state => terminals.stop(state.id)));
  }
  function adoptSessions() {
    if (!relayEnabled || allowQuit) return;
    try { if (sessionStore.adopt()) { publishProjects(); void refreshLibrary(); } }
    catch (error) { console.error('Failed to restore sessions:', error); }
  }
  function scheduleAdoption(delay = 500) { setTimeout(adoptSessions, delay); }
  function refreshLibrary(): Promise<Snapshot> {
    if (allowQuit || askingQuit) return Promise.resolve(snapshot());
    if (refreshPromise) return refreshPromise;
    library.loading = true;
    publishProjects();
    refreshPromise = (async () => {
      try {
        const loaded = await catalog.scan(projects.snapshot().projects);
        const protectedIds = new Set(projects.snapshot().projects.filter(project => loaded.warnings.length > 0 || terminals.projectActive(project.id)).map(project => project.id));
        projects.synchronize(loaded.sessions.map(info => info.cwd), protectedIds);
        const ids = new Map(projects.snapshot().projects.map(project => [project.path, project.id]));
        // Incomplete scans must never discard user metadata. Durable marks require saved history.
        if (!loaded.warnings.length) {
          const saved = loaded.sessions.filter(info => ids.has(info.cwd)).map(info => ({ projectId: ids.get(info.cwd)!, sessionKey: info.key }));
          projects.retainUnreadSessions([...saved, ...terminals.list().filter(state => state.kind === 'pi' && state.projectId && state.sessionKey)
            .map(state => ({ projectId: state.projectId!, sessionKey: state.sessionKey! }))]);
          projects.retainSessionMarks(saved);
        }
        library = { ...loaded, loading: false };
      } catch (error) { library = { ...library, loading: false, warnings: [t('读取本地 Pi 历史失败：{detail}', { detail: errors.message(error) })] }; }
      finally { refreshPromise = null; publishProjects(); }
      return snapshot();
    })();
    return refreshPromise!;
  }
  function syncPiTheme(state: TerminalState) {
    if (!state.running || state.kind !== 'pi' || !state.bridgeReady || state.appearance === appearance() || themeRequests.has(state.id)) return;
    themeRequests.add(state.id);
    void terminals.control(state.id, 'theme', { theme: appearance() }).catch(error => {
      if (terminals.records.get(state.id)?.state.running) send({ type: 'notice', message: userError(error) });
    }).finally(() => themeRequests.delete(state.id));
  }
  terminals.on('data', data => send({ type: 'data', ...data }));
  terminals.on('notice', message => send({ type: 'notice', message }));
  terminals.on('state', state => {
    send({ type: 'state', state });
    syncPiTheme(state);
    if (!state.running) {
      if (state.kind === 'update') version.invalidate();
      else if (state.kind === 'pi') void refreshLibrary();
    }
  });
  function publishPreferences() {
    const languageChanged = getLanguage() !== projects.preferences().language;
    setLanguage(projects.preferences().language);
    rebuildMenu();
    if (window && !window.isDestroyed()) window.setTitle(sandbox ? t('Pi Console · 沙箱') : 'Pi Console');
    if (languageChanged) { version.invalidate(); void refreshLibrary(); }
    if (window && !window.isDestroyed()) window.setBackgroundColor(appearance() === 'dark' ? '#151517' : '#f9fafb');
    send({ type: 'preferences', preferences: projects.preferences(), appearance: appearance(), sidebarAppearance: sidebarAppearance() });
    for (const state of terminals.list()) syncPiTheme(state);
  }
  nativeTheme.on('updated', publishPreferences);

  function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
    return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === page;
  }
  const userError = (error: unknown) => errors.code(error) || (error instanceof SyntaxError)
    ? t('操作失败：{detail}', { detail: errors.message(error) }) : errors.message(error);
  function handle<K extends keyof IpcRequests>(name: K, callback: (...args: Parameters<IpcRequests[K]>) => ReturnType<IpcRequests[K]>) {
    ipcMain.handle('pi-gui:' + name, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, error: t('请求来源无效。') };
      try { return { ok: true, value: await callback(...args as Parameters<IpcRequests[K]>) }; }
      catch (error) { return { ok: false, error: userError(error) }; }
    });
  }
  function receive<K extends keyof IpcMessages>(name: K, callback: (...args: IpcMessages[K]) => void) {
    ipcMain.on('pi-gui:' + name, (event, ...args) => {
      if (!trusted(event)) return;
      try { callback(...args as IpcMessages[K]); } catch (error) { send({ type: 'notice', message: userError(error) }); }
    });
  }
  const safely = (callback: () => unknown) => () => { void Promise.resolve().then(callback).catch(error => send({ type: 'notice', message: userError(error) })); };
  const shortcut = (name: string) => send({ type: 'shortcut', name });
  const { availableProject, createPi, closeTerminal, hideProject, renameSession, deleteSession, setSessionMark } = createSessionController({
    projects, terminals, catalog, confirm: confirmations.ask, refreshLibrary, snapshot,
    publishPreferences, publishProjects, appearance, trashItem
  });

  async function readPiPackages() {
    const file = path.join(catalog.agentDir, 'settings.json');
    let data: { packages?: unknown } = {};
    try { data = JSON.parse(await fs.promises.readFile(file, 'utf8')); }
    catch (error) { if (errors.code(error) !== 'ENOENT') throw new Error(t('无法读取 Pi 配置：{detail}', { detail: errors.message(error) })); }
    const packages = Array.isArray(data.packages)
      ? data.packages.filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 300).slice(0, 50)
      : [];
    return { file, packages };
  }
  function setSessionUnread(id: string | null, sessionKey: string, unread: boolean) {
    const project = projects.get(id);
    if (unread === true && !catalog.sessions.some(info => info.cwd === project.path && info.key === sessionKey) &&
        !terminals.list().some(state => state.kind === 'pi' && state.projectId === id && state.sessionKey === sessionKey)) throw new Error(t('会话已不存在，请刷新列表。'));
    projects.setSessionUnread(id, sessionKey, unread);
    if (!unread) send({ type: 'session-read', projectId: project.id, sessionKey });
    publishProjects();
    return snapshot();
  }
  function attention(payload: AttentionPayload) {
    if (testMode || !payload || typeof payload !== 'object') return false;
    const preferences = projects.preferences();
    const title = typeof payload.title === 'string'
      ? payload.title.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 120) || t('Pi 会话') : t('Pi 会话');
    const body = typeof payload.body === 'string'
      ? payload.body.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 300) : '';
    const terminalId = typeof payload.terminalId === 'string' && payload.terminalId.length <= 100 ? payload.terminalId : null;
    const target = terminalId && typeof payload.runId === 'string' && payload.runId.length > 0 && payload.runId.length <= 100 &&
      typeof payload.sessionId === 'string' && payload.sessionId.length > 0 && payload.sessionId.length <= 128
      ? { runId: payload.runId, sessionId: payload.sessionId } : null;
    if (payload.sound === true && preferences.completionSound) sound();
    if (payload.notice === true && preferences.completionNotice && notificationError) send({ type: 'notice', message: notificationFailure() });
    if (payload.notice === true && preferences.completionNotice && !notificationError && Notification.isSupported()) {
      const notification = new Notification({ title, body, silent: true, icon: path.join(__dirname, '../../assets/icon.png') });
      notices.add(notification);
      if (notices.size > 20) { const old = notices.values().next().value!; notices.delete(old); old.close(); }
      notification.on('close', () => notices.delete(notification));
      notification.on('click', () => {
        if (!window || window.isDestroyed()) return;
        desktop.focusWindow(window, app);
        if (target) send({ type: 'activate-terminal', id: terminalId, ...target });
      });
      notification.show();
    }
    return true;
  }

  handle('snapshot', () => { confirmations.publish(); return snapshot(); });
  handle('answer-confirmation', (id, result) => confirmations.answer(id, result));
  handle('refresh-library', refreshLibrary);
  handle('add-projects', async () => {
    const result = await dialog.showOpenDialog(window, { title: t('添加 Pi 项目'), properties: ['openDirectory', 'multiSelections'], buttonLabel: t('添加项目') });
    if (!result.canceled) { for (const directory of result.filePaths) projects.add(directory); await refreshLibrary(); }
    return { ...snapshot(), added: !result.canceled };
  });
  handle('select-project', id => { projects.select(id); return snapshot(); });
  handle('update-project', (id, patch) => {
    const project = projects.get(id);
    if (typeof patch?.path === 'string' && canonical(patch.path) !== project.path && terminals.projectActive(id)) {
      throw new Error(t('请先关闭这个项目的 Pi 标签，再修改目录；运行中仍可编辑项目名称。'));
    }
    projects.update(id, patch);
    return refreshLibrary();
  });
  handle('choose-project-directory', async id => {
    const project = projects.get(id);
    const result = await dialog.showOpenDialog(window, { title: t('选择项目目录'), defaultPath: project.path, properties: ['openDirectory'], buttonLabel: t('选择目录') });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('hide-project', hideProject);
  handle('reorder-projects', ids => { projects.reorder(ids); publishProjects(); return snapshot(); });
  handle('create-pi', (...args) => createPi(...args));
  handle('new-session-menu', id => {
    availableProject(id);
    return new Promise<'normal' | 'temporary' | null>(resolve => {
      Menu.buildFromTemplate([
        { label: t('新建普通会话'), icon: menuIcon('plus'), click: () => resolve('normal') },
        { label: t('新建临时会话（不保存历史）'), icon: menuIcon('temporary'), click: () => resolve('temporary') }
      ]).popup({ window, callback: () => resolve(null) });
    });
  });
  handle('close-terminal', (id, force = false) => closeTerminal(id, force));
  handle('end-all-sessions', () => endAllSessions());
  handle('close-project-sessions', closeProjectSessions);
  handle('terminal-menu', id => {
    const state = terminals.records.get(id)?.state;
    if (!state?.running) throw new Error(t('终端已关闭。'));
    Menu.buildFromTemplate([{ label: t('结束进程…'), icon: menuIcon('close'), click: safely(() => closeTerminal(id)) }]).popup({ window });
  });
  handle('rename-session', renameSession);
  handle('delete-session', deleteSession);
  handle('history-menu', async (id, key, options = {}) => {
    const project = projects.get(id);
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(name => !['terminalId', 'runId', 'sessionId', 'sessionKey', 'unread'].includes(name)) ||
        (options.unread !== undefined && typeof options.unread !== 'boolean')) throw new Error(t('无效的会话菜单。'));
    const info = key === null ? null : await catalog.lookup(project.path, key);
    const owner = info ? terminals.findSession(info) : terminals.records.get(options.terminalId || null)?.state;
    if (!info && (!owner?.running || owner.kind !== 'pi' || owner.projectId !== id ||
        owner.runId !== options.runId || owner.sessionId !== options.sessionId || owner.sessionKey !== options.sessionKey)) throw new Error(t('会话已关闭或切换，请刷新列表。'));
    const sessionId = info?.id || owner!.sessionId!;
    const sessionKey = info?.key || owner?.sessionKey || null;
    const mark = sessionMarkFor(projects.snapshot().sessionMarks || [], id, info?.key);
    const organizationLabels = { favorite: [t('收藏会话'), t('取消收藏')], pinned: [t('在项目内置顶'), t('取消项目置顶')] } as const;
    const unread = Boolean(sessionKey && projects.isSessionUnread(id, sessionKey)) || options.unread === true;
    const requireOwner = () => {
      const current = owner && terminals.current(owner.id, owner.runId)?.state;
      if (!current || current.sessionId !== sessionId || current.sessionKey !== sessionKey) throw new Error(t('标签已关闭或切换会话，请重新打开菜单。'));
      return current;
    };
    Menu.buildFromTemplate([
      // Navigation; organization; management; process/file removal.
      { label: owner ? t('切换到已打开会话') : t('继续此会话'), icon: menuIcon('open'), enabled: Boolean(owner) || fs.existsSync(project.path), click: safely(async () => {
        const state = info ? await createPi(id, { resume: true, sessionKey: key! }) : requireOwner();
        if (state) send({ type: 'activate-terminal', id: state.id, runId: state.runId, sessionId: state.sessionId });
      }) },
      { type: 'separator' },
      ...sessionMarkKinds.map(kind => ({ label: organizationLabels[kind][mark?.[kind] ? 1 : 0], icon: menuIcon(kind), enabled: Boolean(info),
        click: safely(() => { if (!info) throw new Error(t('请先保存会话历史，再收藏或置顶。')); return setSessionMark(id, info.key, kind, !mark?.[kind]); }) })),
      { type: 'separator' },
      { label: unread ? t('标记为已读') : t('标记为未读'), icon: menuIcon(unread ? 'read' : 'unread'), enabled: Boolean(sessionKey), click: safely(() => { if (!info) requireOwner(); if (!sessionKey) throw new Error(t('会话尚未就绪，请稍后重试。')); setSessionUnread(id, sessionKey, !unread); }) },
      { label: t('重命名…'), icon: menuIcon('rename'), enabled: Boolean(info), click: () => { if (info) send({ type: 'rename-request', projectId: id, key: info.key, title: info.name || info.title }); } },
      { label: t('分叉会话'), icon: menuIcon('fork'), enabled: Boolean(info) && fs.existsSync(project.path), click: safely(async () => {
        if (!info) throw new Error(t('请先保存会话历史，再分叉。'));
        const state = await createPi(id, { resume: false, sessionKey: info.key, fork: true });
        if (state) send({ type: 'activate-terminal', id: state.id, runId: state.runId, sessionId: state.sessionId });
      }) },
      { label: t('复制 Session ID'), icon: menuIcon('copy'), enabled: Boolean(sessionId), click: safely(async () => {
        if (!info) requireOwner();
        await clipboard.writeText(sessionId);
        send({ type: 'notice', message: t('已复制 Session ID') });
      }) },
      { label: t('查看统计…'), icon: menuIcon('stats'), enabled: Boolean(info), click: () => { if (info) send({ type: 'stats-request', projectId: id, key: info.key }); } },
      { type: 'separator' },
      ...(owner ? [{ label: owner.persistent ? t('结束进程…') : t('关闭标签'), icon: menuIcon('close'), click: safely(async () => { const state = requireOwner(); await closeTerminal(state.id); }) }] : []),
      { label: t('删除会话…'), icon: menuIcon('trash'), enabled: Boolean(info),
        click: safely(() => { if (!info) throw new Error(t('尚未保存的会话没有历史文件，请关闭标签。')); return deleteSession(id, info.key); }) }
    ]).popup({ window });
  });
  handle('set-session-unread', setSessionUnread);
  handle('set-session-mark', setSessionMark);
  const openProject = async (id: string | null, target: ProjectOpenTarget) => {
    const project = availableProject(id);
    if (target === 'iterm') await launchIterm(project.path);
    else if (target === 'terminal') await launchTerminal(project.path);
    else await desktop.openProject(project.path, target);
  };
  handle('open-project', openProject);
  handle('open-project-menu', id => {
    availableProject(id);
    Menu.buildFromTemplate([
      { label: t('访达（默认）'), icon: menuIcon('folder'), click: safely(() => openProject(id, 'finder')) },
      { label: 'VS Code', icon: menuIcon('open'), click: safely(() => openProject(id, 'vscode')) },
      { label: 'IntelliJ IDEA', icon: menuIcon('open'), click: safely(() => openProject(id, 'idea')) },
      { label: 'Sourcetree', icon: menuIcon('fork'), click: safely(() => openProject(id, 'sourcetree')) },
      { type: 'separator' },
      { label: 'iTerm2', icon: menuIcon('terminal'), click: safely(() => openProject(id, 'iterm')) },
      { label: t('终端'), icon: menuIcon('terminal'), click: safely(() => openProject(id, 'terminal')) }
    ]).popup({ window });
  });
  handle('project-menu', id => {
    const project = projects.get(id);
    const list = projects.snapshot().projects.filter(item => Boolean(item.pinned) === Boolean(project.pinned));
    const index = list.findIndex(item => item.id === id);
    Menu.buildFromTemplate([
      { label: t('编辑项目…'), icon: menuIcon('rename'), click: () => send({ type: 'project-edit-request', projectId: id }) },
      { type: 'separator' },
      { label: project.pinned ? t('取消项目置顶') : t('置顶项目'), icon: menuIcon('pinned'), click: safely(() => { projects.setProjectPinned(id, !project.pinned); publishProjects(); }) },
      { label: t('上移'), icon: menuIcon('up'), enabled: index > 0, click: safely(() => { projects.move(id, -1); publishProjects(); }) },
      { label: t('下移'), icon: menuIcon('down'), enabled: index < list.length - 1, click: safely(() => { projects.move(id, 1); publishProjects(); }) },
      { type: 'separator' },
      { label: t('在 Finder 中打开'), icon: menuIcon('folder'), click: safely(() => openProject(id, 'finder')) },
      { label: t('在 iTerm2 中打开'), icon: menuIcon('terminal'), click: safely(() => openProject(id, 'iterm')) },
      { type: 'separator' }, { label: t('隐藏项目…'), icon: menuIcon('hide'), enabled: !terminals.projectActive(id), click: safely(() => hideProject(id)) }
    ]).popup({ window });
  });
  handle('shortcut-recording', active => {
    if (typeof active !== 'boolean') throw new Error(t('无效的快捷键录制状态。'));
    window.webContents.setIgnoreMenuShortcuts(active);
    return true;
  });
  handle('set-preferences', patch => {
    const preferences = projects.setPreferences(patch);
    publishPreferences();
    return { preferences, appearance: appearance(), sidebarAppearance: sidebarAppearance() };
  });
  handle('read-version', force => {
    if (force !== undefined && typeof force !== 'boolean') throw new Error(t('无效的版本刷新参数。'));
    return version.get(force);
  });
  handle('check-app-update', async force => {
    if (force !== undefined && typeof force !== 'boolean') throw new Error(t('无效的更新检查请求。'));
    try { return await appRelease.check(force); }
    catch (error) {
      if (error instanceof Error && error.message === 'no compatible release') throw new Error(t('最近的发布中没有此更新渠道的版本。'));
      throw new Error(t('无法检查 Pi Console 更新，请检查网络后重试。'));
    }
  });
  handle('open-app-releases', async () => { await shell.openExternal(APP_RELEASES_URL); });
  handle('packages', readPiPackages);
  handle('attention', attention);
  handle('run-update', async target => {
    if (!['self', 'extensions', 'all'].includes(target)) throw new Error(t('无效的更新类型。'));
    if (terminals.hasActive()) throw new Error(t('请先关闭 GUI 内所有 Pi 标签，再更新；不会自动中断现有任务。'));
    const prompts = {
      self: { message: t('更新本机 Pi？'), confirm: t('确认更新本机 Pi') },
      extensions: { message: t('更新已安装插件？'), confirm: t('确认更新已安装插件') },
      all: { message: t('更新 Pi 与插件？'), confirm: t('确认更新 Pi 与插件') }
    };
    const commands = { self: 'pi update --self', extensions: 'pi update --extensions', all: 'pi update --all' };
    let detail = t('执行：{command}\n\n这会修改本机 Pi 安装或插件。请自行退出外部 iTerm2 中的 Pi；不会替你关闭它们。更新日志会显示在设置中，失败可人工重试，不会自动循环更新。', { command: commands[target] });
    if (target === 'extensions') {
      const { packages } = await readPiPackages();
      detail = packages.length
        ? t('执行：{command}\n\n将更新这些插件：\n{packages}\n\n这会修改本机 Pi 安装或插件。请自行退出外部 iTerm2 中的 Pi；不会替你关闭它们。更新日志会显示在设置中，失败可人工重试，不会自动循环更新。', { command: commands[target], packages: packages.join('\n') })
        : t('执行：{command}\n\n未在 Pi 配置中发现 packages；仍会执行官方扩展更新命令。\n\n这会修改本机 Pi 安装或插件。请自行退出外部 iTerm2 中的 Pi；不会替你关闭它们。更新日志会显示在设置中，失败可人工重试，不会自动循环更新。', { command: commands[target] });
    }
    const result = await confirmations.ask({
      type: 'warning', message: prompts[target].message, detail,
      buttons: [t('取消'), prompts[target].confirm], defaultId: 0, cancelId: 0
    });
    if (result.response !== 1) return null;
    return terminals.start(null, { kind: 'update', updateTarget: target });
  });
  handle('update-log', () => terminals.updateLog());
  handle('clear-update-log', () => { terminals.clearUpdateLog(); publishProjects(); });
  handle('hide-window', () => window.hide());
  handle('open-external', async value => {
    if (typeof value !== 'string' || value.length > 4096) throw new Error(t('无效链接。'));
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error(t('只允许 HTTP/HTTPS 链接。'));
    await shell.openExternal(url.href);
  });
  handle('reveal-terminal-path', (id, runId, reference) => {
    const record = terminals.current(id, runId);
    if (!record) throw new Error(t('会话已关闭或重启，请重新打开链接。'));
    const filename = resolveLocalLink(reference, record.state.cwd);
    shell.showItemInFolder(filename);
  });
  handle('copy', async value => {
    if (typeof value !== 'string' || value.length > 5 * 1024 * 1024) throw new Error(t('复制内容过长。'));
    await clipboard.writeText(value);
  });
  receive('input', (id, runId, data) => terminals.write(id, runId, data));
  receive('resize', (id, runId, cols, rows) => terminals.resize(id, runId, cols, rows));
  receive('ack', (id, runId, length) => terminals.acknowledge(id, runId, length));
  receive('status', (id, runId, status, message) => terminals.report(id, runId, status, message));

  window = new BrowserWindow({
    title: sandbox ? t('Pi Console · 沙箱') : 'Pi Console', width: 1400, height: 900, minWidth: 940, minHeight: 620,
    backgroundColor: palettes[appearance()].background, titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 }, show: false, acceptFirstMouse: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('before-input-event', (_event, input) => {
    // Relay Command release so NAV cannot stick if Chromium consumes keyup.
    if (input.type === 'keyUp' && input.key === 'Meta') send({ type: 'nav-release', commit: true });
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => { if (!allowQuit) { event.preventDefault(); window.hide(); } });
  window.on('blur', () => { window.webContents.setIgnoreMenuShortcuts(false); send({type:'cancel-shortcut-recording'}); send({type:'nav-release', commit:false}); });
  window.webContents.on('render-process-gone', async (_event, details) => {
    confirmations.cancelAll();
    window.webContents.setIgnoreMenuShortcuts(false);
    console.error('Renderer exited:', details.reason);
    if (allowQuit || window.isDestroyed()) return;
    rendererRecoveries++;
    if (relayEnabled && rendererRecoveries <= 2) {
      terminals.detachAll();
      try { await window.loadURL(page); } catch (error) { console.error(error); return; }
      scheduleAdoption(200);
      setTimeout(() => { if (!allowQuit) rendererRecoveries = 0; }, 60000);
      setTimeout(() => send({ type: 'notice', message: t('终端界面异常退出，已重新连接后台会话。') }), 400);
      return;
    }
    await terminals.stopAll();
    sessionStore.clear();
    try { await window.loadURL(page); } catch (error) { console.error(error); return; }
    send({ type: 'notice', message: t('终端界面异常退出，已停止终端以避免反复崩溃。项目和已保存历史保留。') });
  });
  app.on('activate', () => desktop.focusWindow(window, app));
  window.on('focus', () => { if (!allowQuit && Date.now() - library.scannedAt > 2000) void refreshLibrary(); });
  function rebuildMenu() {
    const bindings = shortcuts.bindings(projects.preferences().shortcuts);
    const rendererNavigation = ['previous-tab','next-tab','sidebar-previous','sidebar-next'];
    const item = (id: string, label?: string | null, extra: Electron.MenuItemConstructorOptions = {}): Electron.MenuItemConstructorOptions => {
      const title = label || t(shortcuts.commands.find(command => command.id === id)!.label);
      return {
        label: rendererNavigation.includes(id) ? t('{label}（{shortcut}）', { label: title, shortcut: shortcuts.format(bindings[id]) }) : title,
        // Arrow navigation stays in the renderer to respect editing and avoid duplicate native dispatch.
        accelerator: rendererNavigation.includes(id) ? undefined : bindings[id] || undefined,
        click: () => shortcut(id), ...extra
      };
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Pi Console', submenu: [
        { label: t('关于 Pi Console'), click: () => shortcut('about') }, item('settings',t('设置…')),
        { label: t('结束全部会话…'), click: () => { void endAllSessions().catch(error => send({ type: 'notice', message: userError(error) })); } },
        { type: 'separator' }, { role: 'hide', label: t('隐藏 Pi Console') }, { role: 'hideOthers', label: t('隐藏其他') }, { role: 'unhide', label: t('全部显示') }, { type: 'separator' }, { role: 'quit', label: t('退出 Pi Console') }] },
      { label: t('工作区'), submenu: [
        item('new-tab'), item('new-temporary-tab'), item('close-tab'), item('close-project-sessions'),
        item('previous-tab'), item('next-tab'),
        { type: 'separator' }, item('open-terminal'), item('add',t('添加项目…')),
        item('recent',t('会话')), item('running-recent'), item('next-attention'), item('previous-attention'), item('back'), item('forward'),
        item('search',null,{click:()=>{window.show();shortcut('search');}}), item('refresh'),
        item('sidebar-previous'), item('sidebar-next'),
        { type: 'separator' }, item('hide-window')
      ] },
      { label: t('编辑'), submenu: [{ role: 'undo', label: t('撤销') }, { role: 'redo', label: t('重做') }, { type: 'separator' }, { role: 'cut', label: t('剪切') },
        { label: t('复制'), accelerator: 'Command+C', click: () => shortcut('copy') }, { role: 'paste', label: t('粘贴') }, { role: 'selectAll', label: t('全选') }] },
      { label: t('显示'), submenu: [item('toggle-sidebar'), item('font-larger'), item('font-smaller'), item('shortcut-help'), { role: 'togglefullscreen', label: window && !window.isDestroyed() && window.isFullScreen() ? t('退出全屏幕') : t('进入全屏幕') }] },
      { role: 'windowMenu', label: t('窗口'), submenu: [
        { role: 'minimize', label: t('最小化') }, { role: 'zoom', label: t('缩放') },
        { type: 'separator' }, { role: 'front', label: t('全部置于顶层') }
      ] }
    ]));
  }
  rebuildMenu();
  window.on('enter-full-screen', rebuildMenu);
  window.on('leave-full-screen', rebuildMenu);
  app.on('before-quit', async event => {
    if (allowQuit) return;
    event.preventDefault();
    if (askingQuit) return;
    askingQuit = true;
    try {
      const running = terminals.list().filter(state => state.running);
      const count = running.length;
      if (count) {
        window.show();
        const updating = running.some(state => state.kind === 'update');
        const blocked = running.filter(state => state.status === 'blocked').length;
        const working = running.filter(state => state.status === 'working' || state.status === 'running').length;
        const idle = Math.max(0, count - blocked - working);
        const summary = blocked || working ? t('运行中 {working} · 等待输入 {blocked} · 空闲 {idle}。', { working, blocked, idle }) : '';
        const result = await confirmations.ask({
          type: 'warning',
          message: relayEnabled ? t('退出 Pi Console？') : t('退出并关闭 {count} 个终端进程？', { count }),
          detail: t(relayEnabled
            ? '{warning}{summary}选择「保留 Pi」会让所有 Pi 继续在后台运行，重新打开应用时自动恢复；选择「结束 Pi」会终止所有 Pi 及其子进程。已保存的 Pi 历史不受影响，临时会话无法恢复。'
            : '{warning}{summary}退出整个应用会中断所有 Pi 标签。已保存的 Pi 会话可以恢复；临时会话不会保存，退出后无法恢复。',
            { warning: updating ? t('Pi 正在更新，退出会中断安装，可能需要重新安装 Pi。\n\n') : '', summary }),
          buttons: relayEnabled ? [t('取消'), t('保留 Pi 并退出'), t('结束 Pi 并退出')] : [t('取消'), t('退出并关闭')],
          defaultId: relayEnabled ? 1 : 0, cancelId: 0, destructiveId: relayEnabled ? 2 : 1
        });
        const keep = relayEnabled && result.response === 1;
        const close = relayEnabled ? result.response === 2 : result.response === 1;
        if (!keep && !close) return;
        if (keep) {
          sessionStore.flush();
          await terminals.stopUpdates();
          terminals.detachAll();
          sessionStore.stop();
        } else {
          await terminals.stopAll();
          sessionStore.clear();
          sessionStore.stop();
        }
      } else if (relayEnabled) {
        sessionStore.flush();
        await terminals.stopUpdates();
        terminals.detachAll();
        sessionStore.stop();
      } else {
        await terminals.stopAll();
      }
      allowQuit = true; app.quit();
    } finally { askingQuit = false; }
  });
  await window.loadURL(page);
  if (!testMode) window.show();
  void refreshLibrary();
  scheduleAdoption();
  if (notificationError) send({ type: 'notice', message: notificationFailure() });
  window.on('closed', () => confirmations.cancelAll());
  app.once('will-quit', () => { confirmations.cancelAll(); sessionStore.stop(); });
  return { window, projects, terminals, catalog, refreshLibrary, snapshot,
    async shutdown() { await terminals.stopAll(); sessionStore.clear(); sessionStore.stop(); allowQuit = true; app.quit(); } };
}
export { startApp };
