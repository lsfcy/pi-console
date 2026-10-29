import { t } from '../../shared/i18n.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspace } from '../state/AppContext.js';
import type { HistorySession } from '../../shared/contracts.js';
import { filteredProjects, recentRows } from '../state/selectors.js';
import { projectStatus, sidebarSessions, statusFor } from '../../shared/view-model.js';
import { relativeSessionTime, sessionDate } from '../../shared/format.js';
import { Icon } from './Icon.js';
import { SidebarStatus, UnreadDot, SessionMarks } from './Status.js';
import { useCommandTitle } from './ShortcutHint.js';
import { bindings, format, projectCommands } from '../../shared/shortcuts.js';

function SidebarSession({ info, now, target }: { info: HistorySession; now: number; target?: boolean }) {
  const app = useWorkspace();
  const markedUnread = app.isMarkedUnread(info.projectId, info.key || info.state?.sessionKey || null);
  const saved = Boolean(info.key), pinned = Boolean(app.sessionMark(info)?.pinned);
  const pinTitle = !saved ? t('保存会话后才能置顶') : pinned ? t('取消项目置顶') : t('在项目内置顶');
  return <div className="sidebar-session-row">
    <button type="button" className={'sidebar-session' + (target ? ' nav-target' : '')}
      data-sidebar-key={'session:' + info.projectId + ':' + (info.key || info.terminalId)} data-sidebar-session-id={info.terminalId || info.key || ''}
      data-nav-target={target || undefined}
      title={info.title}
      aria-current={app.route === 'project' && app.selectedId === info.projectId && info.terminalId && app.workspace.activeId(info.projectId) === info.terminalId ? 'page' : undefined}
      onClick={() => app.openHistoryItem(info)}>
      {info.state?.running && <span className="sidebar-session-presence" role="img" aria-label={t('Pi 已在本应用打开')} title={t('Pi 已在本应用打开')} />}
      <span className="sidebar-session-text"><span className="sidebar-session-title">{info.title}</span></span>
      <SessionMarks mark={app.sessionMark(info)} />
      <time className="sidebar-session-time" dateTime={new Date(info.modifiedAt).toISOString()} title={t('最后活动：{time}', { time: sessionDate(info.modifiedAt) })}>{relativeSessionTime(info.modifiedAt, now)}</time>
      {markedUnread && <UnreadDot />}
      <SidebarStatus status={{ ...statusFor(info.state), details: info.state?.message || statusFor(info.state).label }} unread={!markedUnread && app.workspace.unreadCompletions.has(info.terminalId || null)} />
    </button>
    <div className="sidebar-session-actions">
      <button type="button" className="session-quick sidebar-session-menu" title={t('会话操作')} aria-label={t('管理会话：{title}', { title: info.title })} aria-haspopup="menu"
        onClick={() => app.openSessionMenu(info)}><Icon name="more" /></button>
      <button type="button" className={'session-quick' + (pinned ? ' active' : '')} data-session-pin-id={info.key || info.terminalId || ''}
        title={pinTitle} aria-label={pinTitle} aria-pressed={pinned} disabled={!saved}
        onClick={event => { event.stopPropagation(); app.toggleSessionPinned(info); }}><Icon name="pin" /></button>
      <button type="button" className="session-quick session-quick-delete" data-session-delete-id={info.key || info.terminalId || ''}
        title={saved ? t('删除会话…') : t('未保存的临时会话请关闭标签')} aria-label={saved ? t('删除会话：{title}', { title: info.title }) : t('未保存会话不可删除')} disabled={!saved}
        onClick={event => { event.stopPropagation(); app.deleteHistorySession(info); }}><Icon name="trash" /></button>
    </div>
  </div>;
}

export function Sidebar() {
  const app = useWorkspace(), dragging = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const restoreFocus = useRef<{ listId: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const target = restoreFocus.current; if (!target) return;
    restoreFocus.current = null;
    const list = document.getElementById(target.listId);
    (list?.querySelector<HTMLElement>('.project-more') || list?.querySelectorAll<HTMLElement>('.sidebar-session')[target.index])?.focus({ preventScroll: true });
  });
  const refreshTitle = useCommandTitle('refresh'), settingsTitle = useCommandTitle('settings');
  const recentTitle = useCommandTitle('recent'), runningTitle = useCommandTitle('running-recent');
  const visible = filteredProjects(app), rows = recentRows(app);
  const projectBindings = bindings(app.preferences.shortcuts);
  const piCount = [...app.workspace.terminals.values()].filter(item => item.kind === 'pi' && item.running).length;
  const query = app.search.trim();
  const cursor = Math.max(0, Math.min(app.searchCursor, visible.length - 1));
  const warnings = app.library.warnings;
  return <aside className={'sidebar' + (app.navHeld ? ' command-nav' : '') + (app.navPending ? ' nav-pending' : '') + (app.navTarget ? ' has-nav-target' : '')} id="sidebar" data-theme={app.sidebarMode}>
    <div className="brand"><img className="brand-mark" src="../../assets/icon.svg" alt="" /><div><strong>Pi Console</strong></div>
      <span id="sandbox-badge" className="sandbox-badge" hidden={!app.sandboxMode}>{t('沙箱')}</span><span id="app-version" className="version">{app.appVersion}</span></div>
    <div className="search-wrap"><Icon name="search" /><input id="search" type="search" placeholder={t('搜索项目或会话')} aria-label={t('搜索项目、路径或会话标题')}
      autoComplete="off" spellCheck={false} value={app.search} onChange={event => { app.search = event.target.value; app.searchCursor = 0; app.publish(); }} /></div>
    <p id="library-status" className={'library-status' + (warnings.length ? ' warning' : '')} hidden={!app.library.loading && !warnings.length}
      role="status" title={[...app.library.roots, ...warnings].join('\n')}>{app.library.loading ? t('正在读取本地 Pi 历史…') : warnings.join('；')}</p>
    <div className="sidebar-library">
    {app.navHeld && <div className="sidebar-nav-rail" aria-hidden="true"><strong>NAV</strong><span>{format(projectBindings['sidebar-previous'])} / {format(projectBindings['sidebar-next'])} {t('会话')}</span></div>}
    <div className="list-heading"><span>{t('项目')}</span>
      <button id="refresh-library" className="icon-button" title={refreshTitle + '\n' + t('重新扫描本地 Pi 会话，刷新项目与会话列表；不会更新软件。')} aria-label={t('刷新本地历史')} disabled={app.library.loading}
        onClick={() => app.safely(() => app.bridge.refreshLibrary())}><Icon name="refresh" /></button></div>
    <nav id="project-list" aria-label={t('项目列表，可拖拽排序或右键上移下移')}>
      {visible.map((project, index) => {
        const projectCommand = projectCommands[index];
        const projectBinding = projectCommand && projectBindings[projectCommand.id];
        const projectDigit = /^Command\+([0-9])$/.exec(projectBinding || '')?.[1];
        const sessions = sidebarSessions(rows, project, query, app.sidebarSessionLimits.get(project.id), app.sessionMarks);
        const expanded = app.expandedProjects.has(project.id) || Boolean(query);
        const unread = [...app.workspace.terminals.values()].filter(item => item.status !== 'done' || app.workspace.unreadCompletions.has(item.id));
        const markedUnread = app.unreadSessions.some(ref => ref.projectId === project.id);
        const status = project.available === false ? { label: t('目录不存在'), tone: 'error' as const, priority: 6 } : projectStatus(unread, project.id);
        const openPiCount = [...app.workspace.terminals.values()].filter(item => item.kind === 'pi' && item.running && item.projectId === project.id).length;
        const listId = 'project-sessions-' + project.id;
        const pending = app.pendingProjects.has(project.id), updating = Boolean(app.update?.state.running);
        const newTitle = project.available === false ? t('目录不存在，无法新建会话') : updating ? t('Pi 正在更新，请稍后新建会话') : pending ? t('正在新建会话…') : t('在“{name}”中新建 Pi 会话', { name: project.name });
        return <section key={project.id} className={'project-group' + (expanded ? ' expanded' : '')}>
          <div className="project-row"><button type="button" className={'project-item' + (project.available === false ? ' unavailable' : '') + (query && index === cursor ? ' search-hit' : '')}
            data-project-id={project.id} data-sidebar-key={'project:' + project.id} draggable title={t('{name}；右键可置顶或编辑项目。', { name: project.name }) + (projectBinding ? '\n' + format(projectBinding) : '')}
            aria-keyshortcuts={projectDigit ? 'Meta+' + projectDigit : undefined}
            aria-expanded={expanded} aria-controls={listId}
            aria-current={app.route === 'project' && project.id === app.selectedId && (!expanded || app.workspace.activeId(project.id) === 'history') ? 'page' : undefined}
            onClick={() => { app.setProjectExpanded(project.id, !expanded); app.selectProject(project.id, false); }}
            onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
              app.setProjectExpanded(project.id, event.key === 'ArrowRight'); }}
            onContextMenu={event => { event.preventDefault(); app.safely(() => app.bridge.projectMenu(project.id)); }}
            onDragStart={event => { dragging.current = project.id; event.dataTransfer.setData('application/x-pi-project', project.id); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.classList.add('dragging'); }}
            onDragOver={event => { if (!dragging.current || dragging.current === project.id || Boolean(app.projects.find(p => p.id === dragging.current)?.pinned) !== Boolean(project.pinned)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move';
              const before = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2;
              event.currentTarget.classList.toggle('drag-before', before); event.currentTarget.classList.toggle('drag-after', !before); }}
            onDragLeave={event => event.currentTarget.classList.remove('drag-before', 'drag-after')}
            onDragEnd={event => { dragging.current = null; event.currentTarget.classList.remove('dragging'); }}
            onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('drag-before', 'drag-after');
              const source = event.dataTransfer.getData('application/x-pi-project'); if (!source || source === project.id || Boolean(app.projects.find(p => p.id === source)?.pinned) !== Boolean(project.pinned)) return;
              const ids = app.projects.map(p => p.id).filter(id => id !== source);
              const offset = event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2 ? 0 : 1;
              ids.splice(ids.indexOf(project.id) + offset, 0, source); dragging.current = null;
              app.safely(async () => app.applySnapshot(await app.bridge.reorderProjects(ids))); }}>
            {openPiCount > 0 && <span className="project-presence" role="img" aria-label={t('{count} 个 Pi 已打开', { count: openPiCount })} title={t('{count} 个 Pi 已在本应用打开', { count: openPiCount })} />}
            <span className="project-icon"><Icon name={expanded ? 'folder-open' : 'folder'} /><Icon name="chevron" />
              {app.navHeld && projectDigit && <kbd className="project-shortcut" data-shortcut={projectCommand?.id} aria-hidden="true">{projectDigit}</kbd>}
            </span>
            <span className="project-name">{project.name}</span>{project.pinned && <span className="session-mark project-pin" role="img" aria-label={t('项目已置顶')} title={t('项目已置顶')}><Icon name="pin" /></span>}
            {(!expanded || project.available === false) && <>{markedUnread && <UnreadDot />}<SidebarStatus status={status} unread={!markedUnread} /></>}
          </button><button type="button" className="icon-button project-new-pi" data-new-pi-project-id={project.id}
            title={newTitle + t('；右键可新建临时会话（不保存历史，⌘⇧N）')} aria-label={newTitle} aria-haspopup="menu" aria-busy={pending} disabled={project.available === false || updating || pending}
            onContextMenu={event => { event.preventDefault(); app.newSessionMenu(project.id); }}
            onClick={() => void app.createPi(false, undefined, project.id)}><Icon name="plus" /></button></div>
          <div id={listId} className="project-sessions" hidden={!expanded} role="group" aria-label={t('{name}的会话', { name: project.name })}>
            {sessions.items.map(info => <SidebarSession key={info.key || info.terminalId} info={info} now={now}
              target={Boolean(app.navTarget && (app.navTarget.key || app.navTarget.terminalId) === (info.key || info.terminalId))} />)}
            {!sessions.items.length && <span className="sidebar-session-empty">{app.library.loading ? t('正在读取…') : query ? t('没有匹配的会话') : t('暂无会话')}</span>}
            {sessions.items.length < sessions.matched && <button type="button" className="project-more" data-sidebar-key={'more:' + project.id}
              title={t('再显示 {count} 个会话', { count: Math.min(10, sessions.matched - sessions.items.length) })} aria-controls={listId}
              aria-label={t('展开显示：再显示 {count} 个会话', { count: Math.min(10, sessions.matched - sessions.items.length) })}
              onClick={event => {
                if (event.currentTarget === document.activeElement) restoreFocus.current = { listId, index: sessions.items.length };
                app.sidebarSessionLimits.set(project.id, sessions.items.length + 10); app.publish();
              }}>{t('展开显示')}</button>}
          </div>
        </section>;
      })}
    </nav></div>
    <p id="no-results" className="no-results" hidden={visible.length > 0 || !app.projects.length}>{t('没有匹配的项目')}</p>
    <button id="add-project" className="add-project" onClick={() => app.shortcut('add')}><Icon name="plus" /><span>{t('添加项目')}</span></button>
    <div className="sidebar-footer">
    <div className="sidebar-bottom"><div className="sidebar-actions">
      <button id="open-settings" className="nav-icon" type="button" title={settingsTitle} aria-label={t('设置')} aria-current={app.route === 'settings' ? 'page' : undefined} onClick={() => void app.openSettings()}><Icon name="settings" /></button>
      <button id="recent-sessions" className="nav-icon" type="button" title={recentTitle} aria-label={t('会话')} aria-current={app.route === 'recent' ? 'page' : undefined} onClick={() => app.showRecent()}><Icon name="sessions" /></button>
    </div><button id="running-count" type="button" title={runningTitle + ' · ' + t('运行中的 Pi：{count}', { count: piCount })} aria-label={t('运行中的 Pi：{count}；查看运行中会话', { count: piCount })}
      onClick={() => app.showRecent('running')}>{t('运行中 {count}', { count: piCount })}</button></div></div>
  </aside>;
}
