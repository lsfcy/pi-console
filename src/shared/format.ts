import type { HistorySession } from './contracts.js';
import { t, getLanguage } from './i18n.js';
export function formatTokens(value: unknown) {
  const n = Number(value) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}
export function formatCost(value: unknown) {
  const n = Number(value) || 0;
  if (getLanguage() === 'zh-CN') return !n ? '$0' : '$' + (n < .01 ? n.toFixed(4) : n.toFixed(2));
  const digits = !n ? 0 : n < .01 ? 4 : 2;
  return new Intl.NumberFormat(getLanguage(), { style: 'currency', currency: 'USD',
    minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}
export const formatPercent = (value: unknown) => Math.round((Number(value) || 0) * 100) + '%';
export function formatDuration(value: unknown) {
  const n = Number(value) || 0;
  if (n < 1000) return Math.round(n) + 'ms';
  if (n < 60000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 's';
  if (n < 3600000) return Math.round(n / 60000) + 'm';
  return (n / 3600000).toFixed(1).replace(/\.0$/, '') + 'h';
}
export function formatBytes(value: unknown) {
  const n = Number(value) || 0;
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
}
export const statsFor = (info: HistorySession | null | undefined) => info?.stats?.assistantMessages ? info.stats : null;
export function statsSummary(info: HistorySession) {
  const stats = statsFor(info);
  return !stats ? t(info.temporary ? '尚未保存统计' : '暂无 usage') :
    t('{tokens} tok · 缓存 {cache} · {cost}', { tokens: formatTokens(stats.totalTokens),
      cache: formatPercent(stats.cacheHitRate), cost: formatCost(stats.costTotal) });
}
export const sessionDate = (value?: number) => new Date(value || 0).toLocaleString(getLanguage(), {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
});
export function relativeSessionTime(value: number, now = Date.now()) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const minutes = Math.floor(Math.max(0, now - value) / 60000);
  if (minutes < 1) return t('刚刚');
  if (minutes < 60) return t('{count}分钟', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{count}小时', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('{count}天', { count: days });
  if (days < 365) return t('{count}个月', { count: Math.floor(days / 30) });
  return t('{count}年', { count: Math.floor(days / 365) });
}
export const stripAnsi = (text: string) => text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
