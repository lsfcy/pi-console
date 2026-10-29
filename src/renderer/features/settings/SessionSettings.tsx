import { t } from '../../../shared/i18n.js';
import { useWorkspace } from '../../state/AppContext.js';
export function SessionSettings() {
  const app = useWorkspace(), prefs = app.preferences;
  return <><h2>{t("会话展示与恢复")}</h2><div className="settings-columns"><div><span className="field-label">{t("展示方式")}</span>
    <div id="history-layout" className="segmented" role="group" aria-label={t("会话展示方式")}>
      {(['cards', 'list'] as const).map(layout => <button key={layout} type="button" data-layout={layout} aria-pressed={prefs.historyLayout === layout}
        onClick={() => void app.savePreferences({ historyLayout: layout })}>{t(layout === 'cards' ? '卡片' : '列表')}</button>)}</div></div>
    <div><label htmlFor="card-columns">{t("每行卡片数")}</label><select id="card-columns" className="text-input" value={prefs.cardColumns} disabled={prefs.historyLayout === 'list'}
      onChange={event => void app.savePreferences({ cardColumns: Number(event.target.value) })}>
      {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{t(n === 3 ? '{count} 张（默认）' : '{count} 张', { count: n })}</option>)}</select></div></div>
    <p className="field-help">{t("宽度按列数均分；窄窗口只会降列，不会超过设置数量。")}</p>
    {([
      { id: 'confirm-resume', key: 'confirmResume', label: '恢复历史前弹窗确认', help: '关闭后仍对 GUI 内同一会话去重；请先退出外部正在使用同一会话的 Pi。' },
      { id: 'confirm-close', key: 'confirmClose', label: '结束普通终端进程前确认', help: '默认关闭。后台会话的「结束进程」始终确认；标签 × 与 ⌘W 只把会话保留到后台，不会结束进程。' },
      { id: 'completion-sound', key: 'completionSound', label: '会话完成时播放提示音' },
      { id: 'completion-notice', key: 'completionNotice', label: '会话完成时发送系统通知' }
    ] as const).map(field => <div key={field.id}><label className="checkbox-label"><input id={field.id} type="checkbox" checked={prefs[field.key]}
      onChange={event => void app.savePreferences({ [field.key]: event.target.checked })} />{t(field.label)}</label>
      {'help' in field && <p className="field-help">{t(field.help)}</p>}</div>)}
    <p className="field-help">{t("仅提醒非当前前台会话；点击通知切回对应标签。GUI 内由本应用统一提醒，外部终端仍由 Pi 插件自行提醒。")}</p>
  </>;
}
