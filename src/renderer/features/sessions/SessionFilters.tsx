import { useWorkspace } from '../../state/AppContext.js';
import { t } from '../../../shared/i18n.js';
import { StatsToggle } from './StatsToggle.js';
export function SessionTabs() {
  const app = useWorkspace(), tabs = ['all', 'running', 'favorites'] as const;
  return <div id="recent-filter" className="session-filter-bar" hidden={app.route !== 'recent'}>
    <div className="segmented session-tabs" role="tablist" aria-label={t('会话视图')}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(app.recentFilter as typeof tabs[number]);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        app.recentFilter = tabs[next]; app.publish();
        document.getElementById('session-tab-' + tabs[next])?.focus();
      }}>
      {tabs.map(filter => <button key={filter} id={'session-tab-' + filter} type="button" role="tab" data-filter={filter}
        aria-selected={app.recentFilter === filter} aria-controls="history-list" tabIndex={app.recentFilter === filter ? 0 : -1}
        onClick={() => { app.recentFilter = filter; app.publish(); }}>{t(filter === 'all' ? '全部' : filter === 'running' ? '运行中' : '收藏')}</button>)}
    </div>
    <div className="session-scope">
      <label className="compact-field" htmlFor="recent-project">{t('项目')}
        <select id="recent-project" className="compact-select" value={app.recentProject}
          onChange={event => { app.recentProject = event.target.value; app.searchCursor = 0; app.publish(); }}>
          <option value="all">{t('全部项目')}</option>
          {app.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className="compact-field" htmlFor="recent-range">{t('时间')}
        <select id="recent-range" className="compact-select" value={app.recentRange}
          onChange={event => { app.recentRange = event.target.value as typeof app.recentRange; app.searchCursor = 0; app.publish(); }}>
          <option value="week">{t('最近 7 天')}</option><option value="month">{t('最近 1 个月')}</option><option value="all">{t('全部时间')}</option>
        </select>
      </label>
    </div>
    <StatsToggle />
  </div>;
}
export function MonitorFilters() {
  const app = useWorkspace();
  return <>
    <div id="monitor-filter" className="segmented" role="group" tabIndex={-1} aria-label={t('会话统计筛选')}>
      {(['all', 'running'] as const).map(filter => <button key={filter} type="button" data-filter={filter} aria-pressed={app.monitorFilter === filter}
        onClick={() => { app.monitorFilter = filter; app.publish(); }}>{t(filter === 'all' ? '全部' : '运行中')}</button>)}
    </div>
    <label className="compact-field" htmlFor="monitor-time-range">{t('活动时间')}
      <select id="monitor-time-range" className="compact-select" value={app.recentTimeRange} onChange={event => { app.recentTimeRange = event.target.value; app.publish(); }}>
        <option value="week">{t('最近 7 天')}</option><option value="month">{t('最近一个月')}</option><option value="quarter">{t('最近三个月')}</option><option value="all">{t('全部时间')}</option>
      </select>
    </label>
  </>;
}
