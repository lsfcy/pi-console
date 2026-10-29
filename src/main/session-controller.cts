import { t } from '../shared/i18n.js';
import fs from 'node:fs';
import type { CreatePiOptions, Project, SessionInfo, Snapshot, Appearance, SessionMarkKind, Confirm } from '../shared/contracts.js';
import type { ProjectStore } from './project-store.cjs';
import type { TerminalManager } from './terminal-manager.cjs';
import type { SessionCatalog } from './session-catalog.cjs';
import { validateName, renameClosedSession } from './session-actions.cjs';

/** Coordinates confirmed session mutations without owning UI or process implementation. */
export function createSessionController({
  projects, terminals, catalog, confirm, refreshLibrary, snapshot, publishPreferences, publishProjects, appearance, trashItem
}: {
  projects: ProjectStore; terminals: TerminalManager; catalog: SessionCatalog; confirm: Confirm;
  refreshLibrary: () => Promise<Snapshot>; snapshot: () => Snapshot; publishPreferences: () => void;
  publishProjects: () => void; appearance: () => Appearance; trashItem: (file: string) => Promise<void>;
}) {
  const mutations = new Set<string>();
  function availableProject(id: string | null) {
    const project = projects.get(id);
    let available = false;
    try { available = fs.statSync(project.path).isDirectory(); } catch {}
    if (!available) throw new Error(t('项目目录已不存在，请右键编辑项目并选择正确目录。'));
    return project;
  }
  async function createPi(id: string | null, options: CreatePiOptions = {}) {
    const project = availableProject(id);
    if (typeof options.resume !== 'boolean' || (options.sessionKey !== undefined && typeof options.sessionKey !== 'string')) throw new Error(t('无效的启动方式。'));
    if (options.ephemeral !== undefined && typeof options.ephemeral !== 'boolean') throw new Error(t('无效的临时会话参数。'));
    if (options.fork !== undefined && typeof options.fork !== 'boolean') throw new Error(t('无效的分叉参数。'));
    if (options.fork && (!options.sessionKey || options.resume || options.ephemeral)) throw new Error(t('分叉需要指定已保存的会话，不能同时恢复或创建临时会话。'));
    if (options.ephemeral && (options.resume || options.sessionKey)) throw new Error(t('临时会话不能从历史恢复。'));
    let info: SessionInfo | null = null;
    if (options.resume || options.sessionKey) {
      await refreshLibrary();
      const key = options.sessionKey || catalog.sessions.find(item => item.cwd === project.path)?.key;
      if (key) info = await catalog.lookup(project.path, key);
    }
    if ((options.resume || options.sessionKey) && !info) throw new Error(t('未找到可继续的历史，请刷新后选择会话，或点击“新建会话”。'));
    if (info) {
      if (mutations.has(info.file)) throw new Error(t('此会话正在修改，请稍后再打开。'));
      if (options.fork) {
        const owner = terminals.sessionBusy(info, id);
        if (owner && (!owner.bridgeReady || ['working', 'blocked', 'running', 'stopping'].includes(owner.status))) throw new Error(t('请等待原会话当前任务结束后再分叉。'));
        const currentProject = availableProject(id);
        if (currentProject.path !== project.path) throw new Error(t('项目目录已变更，请重新选择会话。'));
        return terminals.start(currentProject, { kind: 'pi', forkFile: info.file,
          label: t('{name} · 分叉', { name: info.title }), appearance: appearance(), cols: options.cols, rows: options.rows });
      }
      const existing = terminals.findSession(info);
      if (existing) return existing;
      if (projects.preferences().confirmResume) {
        const result = await confirm({
          type: 'question', message: t('继续此会话？'),
          detail: t('{name}\n\n请先退出其他应用中使用同一会话的 Pi，避免并发写入。GUI 内已打开的会话会直接切换。', { name: info.title }),
          checkboxLabel: t('以后不再提示（可在设置里重新开启）'), checkboxChecked: false,
          buttons: [t('取消'), t('继续会话')], defaultId: 0, cancelId: 0
        });
        if (result.response !== 1) return null;
        if (result.checkboxChecked) { projects.setPreferences({ confirmResume: false }); publishPreferences(); }
      }
      info = await catalog.lookup(project.path, info.key);
      if (mutations.has(info.file)) throw new Error(t('此会话正在修改，请稍后重试。'));
    }
    if (availableProject(id).path !== project.path) throw new Error(t('项目目录已变更，请重新选择会话。'));
    return terminals.start(project, { kind: 'pi', sessionFile: info?.file || null,
      sessionId: info?.id || null, label: info?.title || '', ephemeral: options.ephemeral, appearance: appearance(), cols: options.cols, rows: options.rows });
  }
  async function closeTerminal(id: string | null, force = false) {
    const record = terminals.records.get(id);
    if (!record?.state.running) return;
    const state = record.state;
    const persistentPi = state.persistent === true && state.kind === 'pi';
    const activePi = persistentPi && ['working', 'running', 'blocked'].includes(state.status);
    // Cmd+W after an answer has finished ends immediately; active work asks once with Enter as the default.
    if (force && persistentPi && !activePi) { await terminals.stop(id); return; }
    if (!force && !persistentPi && !state.ephemeral && state.kind !== 'update' && !projects.preferences().confirmClose) { await terminals.stop(id); return; }
    const result = await confirm({
      type: 'warning',
      message: state.kind === 'update' ? t('中止 Pi 更新？') : activePi ? t('Pi 正在运行，结束会话？') : persistentPi ? t('结束“{name}”的 Pi 会话？', { name: state.label }) : t('关闭“{name}”？', { name: state.label }),
      detail: state.kind === 'update' ? t('中止安装可能使 Pi 暂时不可用，之后需要人工重新执行 pi update。') :
        activePi ? t('将终止正在进行的答复及其子进程。已保存的 Pi 历史保留，可从会话列表恢复；临时会话无法恢复。') :
          persistentPi ? t('将终止这个 Pi 会话及其子进程；已保存的 Pi 历史保留，可从会话列表恢复。临时会话无法恢复。') :
          state.kind === 'shell' ? t('将结束这个 Shell 及其子进程。其他标签不受影响。') :
          state.ephemeral ? t('这是不保存历史的临时会话。关闭后对话无法恢复，未完成任务会中断；工具已修改的项目文件不会撤销。') :
          t('将结束这个标签的进程及子进程。Pi 已保存的会话不会删除；未完成任务会中断。其他标签不受影响。'),
      buttons: [t('取消'), state.kind === 'update' ? t('中止更新') : persistentPi ? t('结束进程') : t('关闭此终端')], defaultId: activePi ? 1 : 0, cancelId: 0
    });
    if (result.response === 1) await terminals.stop(id);
  }
  async function hideProject(id: string | null) {
    const project = projects.get(id);
    if (terminals.projectActive(id)) throw new Error(t('请先关闭这个项目的 Pi 标签。'));
    const result = await confirm({
      type: 'question', message: t('隐藏 {name}？', { name: project.name }), detail: t('仅隐藏列表项，不删除目录或历史。以后可用“添加项目”重新显示。'),
      buttons: [t('取消'), t('隐藏项目')], defaultId: 0, cancelId: 0
    });
    if (result.response === 1) { projects.remove(id); publishProjects(); }
    return snapshot();
  }
  async function sessionAction<T,>(id: string | null, key: string, action: (info: SessionInfo, project: Project) => Promise<T>) {
    const project = projects.get(id);
    await refreshLibrary();
    const info = await catalog.lookup(project.path, key);
    if (projects.get(id).path !== project.path) throw new Error(t('项目目录已变更，请重新选择会话。'));
    if (mutations.has(info.file)) throw new Error(t('此会话正在操作中，请稍后重试。'));
    mutations.add(info.file);
    try { return await action(info, project); }
    finally { mutations.delete(info.file); }
  }
  async function setSessionMark(id: string | null, key: string, kind: SessionMarkKind, enabled: boolean) {
    return sessionAction(id, key, async info => {
      projects.setSessionMark(id, info.key, kind, enabled);
      publishProjects();
      return snapshot();
    });
  }
  async function renameSession(id: string | null, key: string, value: string) {
    const name = validateName(value);
    return sessionAction(id, key, async (info, project) => {
      const owner = terminals.sessionBusy(info, id);
      if (owner) {
        if (owner.sessionId !== info.id || !owner.bridgeReady) throw new Error(t('会话状态尚未就绪，请稍后重试；不会直接修改运行中的会话文件。'));
        await terminals.control(owner.id, 'rename', { name, sessionId: info.id });
      } else {
        const result = await confirm({
          type: 'question', message: t('将会话重命名为“{name}”？', { name }),
          detail: t('请确认其他应用或 iTerm2 没有正在使用这个会话。仅追加 Pi 标准名称元数据，不改写对话内容。'),
          buttons: [t('取消'), t('确认重命名')], defaultId: 0, cancelId: 0
        });
        if (result.response !== 1) return snapshot();
        const fresh = await catalog.lookup(project.path, key);
        if (terminals.sessionBusy(fresh, id)) throw new Error(t('会话已在 GUI 中打开，请稍后重试。'));
        renameClosedSession(fresh, name);
      }
      catalog.cache.delete(info.file);
      return refreshLibrary();
    });
  }
  async function deleteSession(id: string | null, key: string) {
    return sessionAction(id, key, async (info, project) => {
      const owner = terminals.findSession(info);
      if (!owner && terminals.sessionBusy(info, id)) throw new Error(t('Pi 尚未就绪，请稍后再删除。'));
      const result = await confirm({
        type: 'warning', message: owner ? t('关闭并删除此会话？') : t('将此会话移到废纸篓？'),
        detail: owner ? t('{name}\n\n将停止此会话及其子进程，未完成任务会中断，再将历史移到废纸篓。其他会话不受影响。\n\n请先退出其他应用中使用该会话的 Pi。项目文件不受影响，可从系统废纸篓恢复历史文件。', { name: info.title }) : t('{name}\n\n请先退出其他应用中使用该会话的 Pi。项目文件不受影响，可从系统废纸篓恢复历史文件。', { name: info.title }),
        buttons: [t('取消'), owner ? t('关闭并移到废纸篓') : t('移到废纸篓')], defaultId: 0, cancelId: 0
      });
      if (result.response !== 1) return snapshot();
      if (projects.get(id).path !== project.path) throw new Error(t('项目目录已变更，请重新选择会话。'));
      const fresh = await catalog.lookup(project.path, key);
      const current = terminals.findSession(fresh);
      if (current && (!owner || current.id !== owner.id || current.runId !== owner.runId)) throw new Error(t('会话已重新打开，请重新确认删除。'));
      if (owner) {
        const record = terminals.current(owner.id, owner.runId);
        if (record && (record.state.sessionId !== info.id || record.state.sessionKey !== info.key)) throw new Error(t('标签已切换会话，请重新确认删除。'));
        if (record) await terminals.stop(owner.id);
      }
      if (terminals.sessionBusy(fresh, id)) throw new Error(t('会话尚未停止，请稍后重试。'));
      await trashItem(fresh.file);
      projects.keep(id);
      catalog.cache.delete(fresh.file);
      return refreshLibrary();
    });
  }

  return { availableProject, createPi, closeTerminal, hideProject, renameSession, deleteSession, setSessionMark };
}
