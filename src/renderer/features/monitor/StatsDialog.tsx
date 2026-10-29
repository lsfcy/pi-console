import { t } from '../../../shared/i18n.js';
import { useWorkspace } from '../../state/AppContext.js';
import { ownerFor } from '../../state/selectors.js';
import { formatBytes, formatCost, formatDuration, formatPercent, formatTokens, sessionDate, statsFor } from '../../../shared/format.js';
import { statusFor } from '../../../shared/view-model.js';
import { Dialog } from '../../components/Dialog.js';
import { Icon } from '../../components/Icon.js';
import { Status } from '../../components/Status.js';
export function StatsDialog() {
  const app = useWorkspace(), info = app.statsTarget, item = statsFor(info);
  const project = app.projects.find(p => p.id === info?.projectId);
  const close = () => { app.statsTarget = null; app.publish(); };
  const metrics = item && info ? [
    ['Token 总量', formatTokens(item.totalTokens), '输入 + 输出 + 缓存 + 推理'],
    ['输入 / 输出', formatTokens(item.inputTokens) + ' / ' + formatTokens(item.outputTokens), '未缓存输入 / 生成输出'],
    ['缓存读取 / 写入', formatTokens(item.cacheReadTokens) + ' / ' + formatTokens(item.cacheWriteTokens), t('命中率 {rate}', { rate: formatPercent(item.cacheHitRate) })],
    ['上下文规模', formatTokens(item.contextTokens), '最近一次请求的 prompt token'],
    ['缓存命中率', formatPercent(item.cacheHitRate), '缓存读取 / 全部 prompt token'],
    ['成本', formatCost(item.costTotal), t('输入 {input} · 输出 {output}', { input: formatCost(item.costInput), output: formatCost(item.costOutput) })],
    ['轮次', t('{questions} 问 / {answers} 答', { questions: item.userMessages, answers: item.assistantMessages }), t('{calls} 个工具调用 · {results} 个结果', { calls: item.toolCalls, results: item.toolResults })],
    ['请求耗时', formatDuration(item.requestDurationMs), item.assistantMessages ? t('平均 {duration}', { duration: formatDuration(item.requestDurationMs / item.assistantMessages) }) : t('暂无')],
    ['会话时长', formatDuration(info.modifiedAt - (info.createdAt || 0)), sessionDate(info.createdAt)],
    ['会话文件', item.sessionBytes ? formatBytes(item.sessionBytes) : '—', t('错误 {errors} · 中止 {aborts}', { errors: item.errors, aborts: item.aborts })],
    ['推理 token', formatTokens(item.reasoningTokens), item.lastThinkingLevel ? t('思考级别 {level}', { level: item.lastThinkingLevel }) : ''],
    ['最近活动', sessionDate(info.activityAt || info.modifiedAt), item.lastUsageAt ? t('usage 时间 {time}', { time: sessionDate(item.lastUsageAt) }) : '']
  ] : [];
  return <Dialog id="stats-dialog" className="stats-dialog" open={Boolean(info)} onDismiss={close}>
    <div className="dialog-heading"><h2 id="stats-title">{info?.title || t('会话统计')}</h2><button id="stats-close" className="icon-button" aria-label={t("关闭会话统计")} onClick={close}><Icon name="close" /></button></div>
    <div id="stats-body" className="stats-body">
      {info && <span className="stats-meta"><span className="stats-meta-project">{project?.name || t('未知项目')}</span>
        <Status status={statusFor(info.terminalId ? app.workspace.terminals.get(info.terminalId) : ownerFor(app, info))} />
        {item?.lastModel && <span className="stats-meta-model">{[item.lastProvider, item.lastModel].filter(Boolean).join(' / ')}</span>}</span>}
      {item ? <span className="stats-grid">{metrics.map(([label, value, detail]) => <span key={label} className="stats-metric">
        <span className="stats-metric-label">{t(label)}</span><span className="stats-metric-value">{value}</span>{detail && <span className="stats-metric-detail">{t(detail)}</span>}</span>)}</span> :
        <span className="stats-empty">{t(info?.temporary ? '这个会话仍在运行，尚未写入本地会话文件。完成一轮或刷新后再查看统计。' : '没有可用的 usage 统计。')}</span>}
    </div><p className="field-help">{t("统计来自已落盘的本地会话文件，只读；运行中的会话可能延迟到下一次刷新。")}</p>
    <div className="dialog-actions"><button id="stats-open-session" className="button button-secondary" type="button" onClick={() => { close(); if (info) app.openHistoryItem(info); }}>{t("打开会话")}</button>
      <button id="stats-close-button" className="button button-secondary" type="button" onClick={close}>{t("关闭")}</button></div>
  </Dialog>;
}
