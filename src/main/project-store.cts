import type { Project, Preferences, ProjectData, SessionReference, SessionMark, SessionMarkKind } from '../shared/contracts.js';
import { sessionMarkFor, sessionMarkKinds } from '../shared/view-model.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical } from './session-catalog.cjs';
import * as shortcuts from '../shared/shortcuts.js';
import { t, setLanguage } from '../shared/i18n.js';

class ProjectStore {
  file: string;
  data: ProjectData;
  constructor(file: string) {
    this.file = file;
    this.data = { version: 1, projects: [], selectedId: null };
    if (fs.existsSync(file)) {
      const saved: ProjectData = JSON.parse(fs.readFileSync(file, 'utf8'));
      setLanguage(saved?.preferences?.language === 'en-US' ? 'en-US' : 'zh-CN');
      if (saved.version !== 1 || !Array.isArray(saved.projects) ||
          saved.projects.some(p => !p || typeof p.id !== 'string' ||
            typeof p.name !== 'string' || !path.isAbsolute(p.path) || (p.pinned !== undefined && p.pinned !== true)) ||
          new Set(saved.projects.map(p => p.id)).size !== saved.projects.length) {
        throw new Error(t('项目配置格式无效。请备份后检查：{file}', { file }));
      }
      if (saved.hiddenPaths !== undefined && (!Array.isArray(saved.hiddenPaths) ||
          saved.hiddenPaths.some(value => typeof value !== 'string' || !path.isAbsolute(value)))) {
        throw new Error(t('隐藏项目配置格式无效：{file}', { file }));
      }
      if (saved.unreadSessions !== undefined && (!Array.isArray(saved.unreadSessions) || saved.unreadSessions.some(ref =>
        !ref || typeof ref.projectId !== 'string' || typeof ref.sessionKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref.sessionKey)))) {
        throw new Error(t('会话未读配置格式无效：{file}', { file }));
      }
      let migratedMarks = false;
      if (Array.isArray(saved.sessionMarks)) {
        saved.sessionMarks = saved.sessionMarks.map(mark => {
          if (!mark || typeof mark !== 'object') return mark;
          const legacy = mark as SessionMark & { globalPinned?: true };
          if (legacy.globalPinned !== true) return mark;
          migratedMarks = true;
          const { globalPinned: _globalPinned, ...rest } = legacy;
          return { ...rest, favorite: true, pinned: true };
        });
      }
      if (saved.sessionMarks !== undefined && (!Array.isArray(saved.sessionMarks) || saved.sessionMarks.some(mark =>
        !mark || typeof mark.projectId !== 'string' || typeof mark.sessionKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(mark.sessionKey) ||
        Object.keys(mark).some(key => !['projectId', 'sessionKey', ...sessionMarkKinds].includes(key)) ||
        sessionMarkKinds.some(kind => mark[kind] !== undefined && mark[kind] !== true) || !sessionMarkKinds.some(kind => mark[kind])) ||
        new Set(saved.sessionMarks.map(mark => JSON.stringify([mark.projectId, mark.sessionKey]))).size !== saved.sessionMarks.length)) {
        throw new Error(t('会话收藏/置顶配置格式无效：{file}', { file }));
      }
      this.data = saved;
      if (migratedMarks) this.save(saved);
    }
  }

  snapshot() { return structuredClone(this.data); }

  isSessionUnread(projectId: string | null, sessionKey: string) {
    return (this.data.unreadSessions || []).some(ref => ref.projectId === projectId && ref.sessionKey === sessionKey);
  }
  setSessionUnread(projectId: string | null, sessionKey: string, unread: boolean) {
    this.get(projectId);
    if (typeof sessionKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionKey) || typeof unread !== 'boolean') throw new Error(t('无效的会话未读标记。'));
    if (this.isSessionUnread(projectId, sessionKey) === unread) return this.snapshot();
    const next = this.snapshot();
    next.unreadSessions = (next.unreadSessions || []).filter(ref => ref.projectId !== projectId || ref.sessionKey !== sessionKey);
    if (unread) next.unreadSessions.push({ projectId: projectId!, sessionKey });
    return this.save(next);
  }
  retainUnreadSessions(valid: SessionReference[]) {
    const next = this.snapshot();
    if (!next.unreadSessions?.length) return next;
    next.unreadSessions = next.unreadSessions.filter(ref => valid.some(item => item.projectId === ref.projectId && item.sessionKey === ref.sessionKey));
    if (next.unreadSessions.length !== this.data.unreadSessions!.length) return this.save(next);
    return next;
  }

  setSessionMark(projectId: string | null, sessionKey: string, kind: SessionMarkKind, enabled: boolean) {
    this.get(projectId);
    if (typeof sessionKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionKey) ||
        !sessionMarkKinds.includes(kind) || typeof enabled !== 'boolean') throw new Error(t('无效的会话收藏/置顶标记。'));
    const next = this.snapshot();
    const mark = sessionMarkFor(next.sessionMarks || [], projectId, sessionKey) || { projectId: projectId!, sessionKey };
    if (enabled) {
      if (mark[kind]) return next;
      mark[kind] = true;
    } else {
      if (!mark[kind]) return next;
      delete mark[kind];
    }
    next.sessionMarks = (next.sessionMarks || []).filter(ref => ref.projectId !== projectId || ref.sessionKey !== sessionKey);
    if (sessionMarkKinds.some(key => mark[key])) next.sessionMarks.push(mark);
    return this.save(next);
  }
  retainSessionMarks(valid: SessionReference[]) {
    const next = this.snapshot();
    if (!next.sessionMarks?.length) return next;
    next.sessionMarks = next.sessionMarks.filter(ref => valid.some(item => item.projectId === ref.projectId && item.sessionKey === ref.sessionKey));
    return next.sessionMarks.length === this.data.sessionMarks!.length ? next : this.save(next);
  }
  setProjectPinned(id: string | null, pinned: boolean) {
    const project = this.get(id);
    if (typeof pinned !== 'boolean') throw new Error(t('无效的项目置顶标记。'));
    if (Boolean(project.pinned) === pinned) return this.snapshot();
    const next = this.snapshot(), target = next.projects.find(item => item.id === id)!;
    if (pinned) { target.pinned = true; target.source = 'manual'; } else delete target.pinned;
    return this.save(next);
  }

  preferences(): Preferences {
    const saved = this.data.preferences || {};
    const themes = ['system', 'light', 'dark'];
    // One normalization boundary for v0.3's stored single theme. New saves discard the old key.
    const legacyTheme = saved.theme && themes.includes(saved.theme) ? saved.theme : 'system';
    let shortcutOverrides = {};
    try {
      const stored = { ...saved.shortcuts };
      // Retain supported project shortcuts; discard obsolete Shell/session commands at the load/save boundary.
      if (Object.hasOwn(stored, 'new-shell') && !Object.hasOwn(stored, 'open-terminal')) stored['open-terminal'] = stored['new-shell'];
      delete stored['toggle-shell']; delete stored['new-shell'];
      for (const id of Object.keys(stored)) if (id.startsWith('session-') || id.startsWith('project-') && !Object.hasOwn(shortcuts.defaults, id)) delete stored[id];
      try {
        shortcutOverrides = shortcuts.validateOverrides(stored);
      } catch {
        // Remove retired bindings first, preserving valid swaps as a group when possible.
        const valid: Record<string, string | null> = {};
        for (const [id, value] of Object.entries(stored)) {
          try { if (Object.hasOwn(shortcuts.defaults, id)) valid[id] = shortcuts.normalize(value); } catch {}
        }
        try { shortcutOverrides = shortcuts.validateOverrides(valid); }
        catch {
          // Newly conflicting defaults must not erase unrelated customizations.
          for (const [id, value] of Object.entries(valid).sort((a, b) => Number(b[1] === null) - Number(a[1] === null))) {
            try { shortcutOverrides = shortcuts.validateOverrides({ ...shortcutOverrides, [id]: value }); } catch {}
          }
        }
      }
    } catch {}
    return {
      shortcuts: shortcutOverrides,
      sidebarTheme: saved.sidebarTheme && themes.includes(saved.sidebarTheme) ? saved.sidebarTheme : legacyTheme,
      workspaceTheme: saved.workspaceTheme && themes.includes(saved.workspaceTheme) ? saved.workspaceTheme : legacyTheme,
      historyLayout: saved.historyLayout === 'list' ? 'list' : 'cards',
      language: saved.language === 'en-US' ? 'en-US' : 'zh-CN',
      cardColumns: Math.round(Math.max(1, Math.min(6, Number(saved.cardColumns) || 3))),
      confirmResume: saved.confirmResume !== false,
      confirmClose: saved.confirmClose === true,
      completionSound: saved.completionSound !== false,
      completionNotice: saved.completionNotice !== false,
      checkAppUpdates: saved.checkAppUpdates !== false,
      sidebarCollapsed: saved.sidebarCollapsed === true,
      fontSize: Math.round(Math.max(10, Math.min(22, Number(saved.fontSize) || 13))),
      sidebarWidth: Math.round(Math.max(224, Math.min(440, Number(saved.sidebarWidth) || 280)))
    };
  }

  setPreferences(patch: Partial<Preferences>) {
    const keys = ['sidebarTheme', 'workspaceTheme', 'historyLayout', 'cardColumns', 'confirmResume', 'confirmClose',
      'completionSound', 'completionNotice', 'checkAppUpdates', 'sidebarCollapsed', 'fontSize', 'sidebarWidth', 'language', 'shortcuts'];
    if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !keys.includes(key))) throw new Error(t('无效的设置。'));
    const next = { ...this.preferences(), ...patch };
    next.shortcuts = shortcuts.validateOverrides(next.shortcuts);
    const themes = ['system', 'light', 'dark'];
    if (!themes.includes(next.sidebarTheme) || !themes.includes(next.workspaceTheme) ||
        !['cards', 'list'].includes(next.historyLayout) || !['zh-CN', 'en-US'].includes(next.language) || typeof next.confirmResume !== 'boolean' ||
        typeof next.confirmClose !== 'boolean' ||
        typeof next.completionSound !== 'boolean' || typeof next.completionNotice !== 'boolean' || typeof next.checkAppUpdates !== 'boolean' ||
        typeof next.sidebarCollapsed !== 'boolean' ||
        !Number.isInteger(next.cardColumns) || next.cardColumns < 1 || next.cardColumns > 6 ||
        !Number.isInteger(next.fontSize) || next.fontSize < 10 || next.fontSize > 22 ||
        !Number.isInteger(next.sidebarWidth) || next.sidebarWidth < 224 || next.sidebarWidth > 440) throw new Error(t('设置值超出允许范围。'));
    const persisted: Partial<Preferences> = {...next};
    if (!Object.keys(persisted.shortcuts!).length) delete persisted.shortcuts;
    setLanguage(next.language);
    this.save({ ...this.snapshot(), preferences: persisted });
    return next;
  }

  reorder(ids: string[]) {
    if (!Array.isArray(ids) || ids.length !== this.data.projects.length || new Set(ids).size !== ids.length ||
        ids.some(id => !this.data.projects.some(project => project.id === id))) throw new Error(t('项目顺序已变化，请刷新后重试。'));
    return this.save({ ...this.snapshot(), projects: ids.map(id => this.get(id)) });
  }

  move(id: string | null, offset: number) {
    const project = this.get(id);
    if (![1, -1].includes(offset)) throw new Error(t('无效的移动方向。'));
    const group = this.data.projects.filter(item => Boolean(item.pinned) === Boolean(project.pinned));
    const index = group.findIndex(item => item.id === id);
    const destination = Math.max(0, Math.min(group.length - 1, index + offset));
    const ids = this.data.projects.map(item => item.id), from = ids.indexOf(id!), to = ids.indexOf(group[destination].id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return this.reorder(ids);
  }

  keep(id: string | null) {
    const next = this.snapshot();
    this.get(id);
    next.projects.find(project => project.id === id)!.source = 'manual';
    return this.save(next);
  }

  get(id: string | null) {
    const project = this.data.projects.find(p => p.id === id);
    if (!project) throw new Error(t('项目不存在，请重新选择。'));
    return { ...project };
  }

  save(next: ProjectData) {
    if (next.unreadSessions) {
      next.unreadSessions = next.unreadSessions.filter(ref => next.projects.some(project => project.id === ref.projectId));
      if (!next.unreadSessions.length) delete next.unreadSessions;
    }
    if (next.sessionMarks) {
      next.sessionMarks = next.sessionMarks.filter(ref => next.projects.some(project => project.id === ref.projectId));
      if (!next.sessionMarks.length) delete next.sessionMarks;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.data = next;
    return this.snapshot();
  }

  add(directory: string) {
    const canonical = fs.realpathSync(directory);
    if (!fs.statSync(canonical).isDirectory()) throw new Error(t('请选择文件夹。'));
    const next = this.snapshot();
    let project = next.projects.find(p => p.path === canonical);
    if (!project) {
      project = { id: randomUUID(), name: path.basename(canonical) || canonical, path: canonical, source: 'manual' };
      next.projects.push(project);
    }
    project.source = 'manual';
    if (next.hiddenPaths) next.hiddenPaths = next.hiddenPaths.filter(value => value !== canonical);
    next.selectedId = project.id;
    this.save(next);
    return { ...project };
  }

  update(id: string | null, patch: Partial<Pick<Project, 'name' | 'path'>>) {
    const current = this.get(id);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        !Object.keys(patch).length || Object.keys(patch).some(key => !['name', 'path'].includes(key))) throw new Error(t('无效的项目编辑。'));
    const name = patch.name === undefined ? current.name : patch.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160 || /[\x00-\x1f\x7f]/.test(name)) throw new Error(t('项目名称应为 1～160 个字符，不能包含换行或控制字符。'));
    let directory = current.path;
    if (patch.path !== undefined) {
      if (typeof patch.path !== 'string' || patch.path.length > 4096 ||
          !path.isAbsolute(patch.path) || /[\x00-\x1f\x7f]/.test(patch.path)) throw new Error(t('项目目录必须是有效的绝对路径。'));
      directory = canonical(patch.path);
      if (directory !== current.path) {
        try { directory = fs.realpathSync(patch.path); if (!fs.statSync(directory).isDirectory()) throw new Error(); }
        catch { throw new Error(t('项目目录不存在或不是文件夹，请重新选择。')); }
      }
      if (this.data.projects.some(project => project.id !== id && project.path === directory)) throw new Error(t('该目录已属于另一个项目，请选择其他目录。'));
    }
    const next = this.snapshot();
    Object.assign(next.projects.find(project => project.id === id)!,  { name: name.trim(), path: directory, source: 'manual' });
    if (directory !== current.path) {
      // Editing a directory must not immediately rediscover the replaced entry.
      // Its files/history stay untouched; “添加项目” can explicitly restore it.
      next.hiddenPaths = [...new Set([...(next.hiddenPaths || []), current.path])].filter(value => value !== directory);
      if (next.unreadSessions) next.unreadSessions = next.unreadSessions.filter(ref => ref.projectId !== id);
      if (next.sessionMarks) next.sessionMarks = next.sessionMarks.filter(ref => ref.projectId !== id);
    }
    return this.save(next);
  }

  synchronize(discovered: string[], runningIds = new Set<string>()) {
    const next = this.snapshot();
    const paths = new Set(discovered.map(directory => canonical(directory)));
    const hidden = new Set(next.hiddenPaths || []);
    next.projects = next.projects.filter(project => project.source !== 'history' || paths.has(project.path) || runningIds.has(project.id));
    for (const directory of paths) {
      if (hidden.has(directory) || next.projects.some(project => project.path === directory)) continue;
      next.projects.push({ id: randomUUID(), name: path.basename(directory) || directory, path: directory, source: 'history' });
    }
    if (!next.projects.some(project => project.id === next.selectedId)) next.selectedId = next.projects[0]?.id ?? null;
    if (JSON.stringify(next) !== JSON.stringify(this.data)) this.save(next);
    return this.snapshot();
  }

  select(id: string | null) {
    this.get(id);
    if (this.data.selectedId === id) return this.snapshot();
    return this.save({ ...this.snapshot(), selectedId: id });
  }

  remove(id: string | null) {
    const project = this.get(id);
    const next = this.snapshot();
    next.hiddenPaths = [...new Set([...(next.hiddenPaths || []), project.path])];
    next.projects = next.projects.filter(p => p.id !== id);
    if (next.selectedId === id) next.selectedId = next.projects[0]?.id ?? null;
    return this.save(next);
  }
}

export { ProjectStore };
