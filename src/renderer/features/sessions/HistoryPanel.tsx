import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useWorkspace } from '../../state/AppContext.js';
import { historyRows, ownerFor } from '../../state/selectors.js';
import { effectiveColumns, statusFor } from '../../../shared/view-model.js';
import { sessionDate, statsFor, statsSummary } from '../../../shared/format.js';
import { t } from '../../../shared/i18n.js';
import { Icon } from '../../components/Icon.js';
import { Status, UnreadDot, SessionMarks } from '../../components/Status.js';
import { SessionTabs } from './SessionFilters.js';
import { MonitorPanel } from '../monitor/MonitorPanel.js';
export function HistoryPanel({ hidden }: { hidden: boolean }) {
  const app = useWorkspace(), { all, visible } = historyRows(app), list = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const stats = app.statsVisible;
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element); setWidth(element.clientWidth); return () => observer.disconnect();
  }, [stats]);
  const columns = effectiveColumns(app.preferences.cardColumns, width);
  const recent = app.route === 'recent';
  return <section id="history-panel" className="history-panel" hidden={hidden} aria-label={t(stats ? '会话统计' : recent ? '全部项目会话' : '会话历史')} onScroll={app.navigation.replace}>
    <SessionTabs />
    {stats ? <MonitorPanel hidden={false} embedded /> : <>
    {!recent && app.currentProject?.available === false && <p id="history-warning" className="history-explanation" role="status">{t('项目目录已不存在。历史仍保留，但无法在原目录继续。')}</p>}
    <div id="history-list" className={'history-grid' + (app.preferences.historyLayout === 'list' ? ' list' : '')} ref={list} role={recent ? 'tabpanel' : undefined} aria-labelledby={recent ? 'session-tab-' + app.recentFilter : undefined} style={{ '--history-columns': columns } as CSSProperties}>
      {visible.map(info => {
        const project = app.projects.find(item => item.id === info.projectId); if (!project) return null;
        const owner = info.terminalId ? app.workspace.terminals.get(info.terminalId) : ownerFor(app, info);
        const key = info.key || 'live-' + info.terminalId;
        const menu = () => app.openSessionMenu(info);
        const saved = Boolean(info.key), pinned = Boolean(app.sessionMark(info)?.pinned);
        const pinTitle = t(!saved ? '保存会话后才能置顶' : pinned ? '取消项目置顶' : '在项目内置顶');
        return <article key={key} className="history-card" data-session-key={key}>
          <button className="history-open" data-history-key={key} title={t('{name}\n项目：{path}\n会话 ID：{id}', { name: info.title, path: project.path, id: String(info.id) })}
            disabled={(!owner && project.available === false) || app.pendingProjects.has(project.id) || Boolean(app.update?.state.running)} onClick={() => app.openHistoryItem(info)}>
            <span className="card-kicker"><SessionMarks mark={app.sessionMark(info)} /><Icon name="chat" />{app.isMarkedUnread(info.projectId, info.key || owner?.sessionKey || null) && <UnreadDot />}<span className={'card-project' + (recent ? ' card-project-name' : '')}>{project.name}{info.stats?.lastModel ? ' · ' + info.stats.lastModel : ''}</span><Status status={statusFor(owner)} />{info.temporary && <span className="temporary-label">{t('未保存')}</span>}</span>
            <span className="history-title">{info.title}</span>
            {info.firstMessage && info.firstMessage !== info.title && <span className="history-preview">{info.firstMessage}</span>}
            {(info.temporary || statsFor(info)) && <span className="card-stats">{info.temporary ? t('尚未保存统计') : statsSummary(info)}</span>}
            <span className="card-footer"><span className="history-meta">{sessionDate(info.activityAt || info.modifiedAt)}</span><span className="history-action">{t(owner ? '切换标签' : '继续会话')}<Icon name="arrow" /></span></span>
          </button>
          <div className="card-actions">
            <button className={'icon-button card-quick' + (pinned ? ' active' : '')} data-card-pin-key={info.key || ''} title={pinTitle} aria-label={pinTitle} aria-pressed={pinned} disabled={!saved}
              onClick={event => { event.stopPropagation(); app.toggleSessionPinned(info); }}><Icon name="pin" /></button>
            <button className="icon-button card-quick card-quick-delete" data-card-delete-key={info.key || ''} title={t(saved ? '删除会话…' : '未保存的临时会话请关闭标签')}
              aria-label={saved ? t('删除会话：{name}', { name: info.title }) : t('未保存会话不可删除')} disabled={!saved}
              onClick={event => { event.stopPropagation(); app.deleteHistorySession(info); }}><Icon name="trash" /></button>
            <button className="icon-button card-menu" title={t('收藏、置顶、分叉、复制 Session ID、标记已读/未读、重命名、统计与删除')} aria-label={t('管理会话：{name}', { name: info.title })} aria-haspopup="menu" onClick={menu}><Icon name="more" /></button>
          </div>
        </article>;
      })}
    </div>
    <div id="history-empty" className="history-empty" hidden={visible.length > 0}><Icon name="chat" /><h2>{t(all.length ? '没有匹配的会话' : '还没有已保存的会话')}</h2>
      <p>{t(all.length ? recent ? app.recentFilter === 'favorites' ? '点击会话旁的「…」选择「收藏会话」，或清空搜索。' : '试试切换「全部」或清空搜索。' : '试试清空搜索。' : '新建会话后，Pi 会在产生对话时自动保存。')}</p>
      <button id="empty-start" className="button button-primary" hidden={app.route !== 'project'} disabled={!app.currentProject || app.currentProject.available === false || Boolean(app.update?.state.running)}
        onClick={() => void app.createPi()}>{t('新建会话')}</button></div>
    </>}
  </section>;
}
