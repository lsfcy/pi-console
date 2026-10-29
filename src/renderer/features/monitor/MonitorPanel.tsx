import { useWorkspace } from '../../state/AppContext.js';
import { globalRows, ownerFor, recentRows } from '../../state/selectors.js';
import { formatCost, formatPercent, formatTokens, sessionDate, statsFor } from '../../../shared/format.js';
import { statusFor } from '../../../shared/view-model.js';
import { t } from '../../../shared/i18n.js';
import { Status } from '../../components/Status.js';
import { Icon } from '../../components/Icon.js';
import { MonitorFilters } from '../sessions/SessionFilters.js';
export function MonitorPanel({ hidden, embedded = false }: { hidden: boolean; embedded?: boolean }) {
  const app = useWorkspace(), all = recentRows(app), rows = globalRows(app, all);
  const sorted = [...rows].sort((a, b) => {
    const left = statsFor(a), right = statsFor(b);
    if (app.monitorSort === 'totalTokens') return (right?.totalTokens || 0) - (left?.totalTokens || 0);
    if (app.monitorSort === 'cost') return (right?.costTotal || 0) - (left?.costTotal || 0);
    if (app.monitorSort === 'cache') return (right?.cacheHitRate || 0) - (left?.cacheHitRate || 0);
    return (b.activityAt || 0) - (a.activityAt || 0);
  });
  const stats = rows.map(statsFor).filter(item => item !== null);
  const total = stats.reduce((acc, item) => ({ tokens: acc.tokens + item.totalTokens, cost: acc.cost + item.costTotal,
    prompt: acc.prompt + item.inputTokens + item.cacheReadTokens + item.cacheWriteTokens, cache: acc.cache + item.cacheReadTokens }), { tokens: 0, cost: 0, prompt: 0, cache: 0 });
  const cards: [string, string | number, string][] = [
    ['会话', rows.length, t('{count} 个正在运行', { count: rows.filter(info => info.state?.running).length })],
    ['Token 总量', formatTokens(total.tokens), t('输入、输出、缓存与推理')],
    ['缓存命中', formatPercent(total.prompt ? total.cache / total.prompt : 0), t('{count} 来自缓存', { count: formatTokens(total.cache) })],
    ['总成本', formatCost(total.cost), t('{count} 个会话有用量', { count: stats.length })]
  ];
  return <section id="monitor-panel" className={'monitor-panel' + (embedded ? ' embedded' : '')} hidden={hidden} aria-label={t('会话统计')} onScroll={app.navigation.replace}>
    <div className="monitor-controls"><MonitorFilters /><label className="compact-field" htmlFor="monitor-sort">{t('排序')}
        <select id="monitor-sort" className="compact-select" aria-label={t('监控排序')} title={t('按所选指标降序排列')} value={app.monitorSort} onChange={event => { app.monitorSort = event.target.value; app.publish(); }}>
          <option value="activity">{t('最近活动')}</option><option value="totalTokens">{t('Token 用量')}</option><option value="cost">{t('成本')}</option><option value="cache">{t('缓存命中率')}</option></select></label>
        <button id="monitor-refresh" className="button button-quiet" type="button" onClick={() => app.safely(() => app.bridge.refreshLibrary())}>{t('刷新')}</button>
    </div>
    <div id="monitor-summary" className="monitor-summary" title={t('汇总所选会话的累计 usage（非时间段内增量）；运行中的会话在下一次落盘或刷新后更新。')}>{cards.map(([label, value, detail]) =>
      <span className="monitor-card" key={label}><span className="monitor-card-label">{t(label)}</span><span className="monitor-card-value">{value}</span><span className="monitor-card-detail">{detail}</span></span>)}</div>
    <div id="monitor-list" className="monitor-list"><table className="monitor-table">
      <thead><tr>{['会话', '项目', '状态', 'Token', '缓存', '成本', '轮次 / 工具', '最近活动', ''].map((label, index) => <th key={index}>{t(label)}</th>)}</tr></thead>
      <tbody>{sorted.map(info => {
        const project = app.projects.find(p => p.id === info.projectId); if (!project) return null;
        const item = statsFor(info), open = () => { app.statsTarget = info; app.publish(); };
        return <tr key={info.key || info.terminalId} className="monitor-row" tabIndex={0} onClick={open} onKeyDown={event => { if (event.key === 'Enter') open(); }}>
          <td><span className="monitor-session"><span className="monitor-session-title">{info.title}</span>{info.temporary ? <span className="temporary-label">{t('未保存')}</span> : item?.lastModel && <span className="monitor-session-sub">{item.lastModel}</span>}</span></td>
          <td>{project.name}</td><td><Status status={statusFor(info.terminalId ? app.workspace.terminals.get(info.terminalId) : ownerFor(app, info))} /></td>
          <td><span className="monitor-main">{item ? formatTokens(item.totalTokens) : '—'}</span><span className="monitor-sub">{item ? t('输入 {input} · 输出 {output}', { input: formatTokens(item.inputTokens), output: formatTokens(item.outputTokens) }) : t('暂无用量')}</span></td>
          <td><span className="monitor-main">{item ? formatPercent(item.cacheHitRate) : '—'}</span><span className="monitor-sub">{item ? t('读 {read} · 写 {write}', { read: formatTokens(item.cacheReadTokens), write: formatTokens(item.cacheWriteTokens) }) : '—'}</span></td>
          <td><span className="monitor-main">{item ? formatCost(item.costTotal) : '—'}</span><span className="monitor-sub">{item ? t('推理 {count}', { count: formatTokens(item.reasoningTokens) }) : '—'}</span></td>
          <td><span className="monitor-main">{item ? t('{questions} 问 / {answers} 答', { questions: item.userMessages, answers: item.assistantMessages }) : '—'}</span><span className="monitor-sub">{item ? t('{count} 次工具调用', { count: item.toolCalls }) : '—'}</span></td>
          <td>{sessionDate(info.activityAt || info.modifiedAt)}</td>
          <td><button className="button button-quiet monitor-open" type="button" onClick={event => { event.stopPropagation(); app.openHistoryItem(info); }}>{t('打开')}</button></td>
        </tr>;
      })}</tbody>
    </table></div>
    <div id="monitor-empty" className="history-empty" hidden={rows.length > 0}><Icon name="activity" /><h2>{t(all.length ? '没有匹配的会话' : '还没有可统计的会话')}</h2>
      <p>{t(all.length ? '试试扩大活动时间范围、切换「全部」或清空搜索。' : '产生对话并保存后，这里会显示 token、缓存和成本。')}</p></div>
  </section>;
}
