import { t } from '../../../shared/i18n.js';
import { useWorkspace } from '../../state/AppContext.js';
import { bindings, commands, format } from '../../../shared/shortcuts.js';
export function ShortcutSettings() {
  const app = useWorkspace(), values = bindings(app.preferences.shortcuts);
  let group = '';
  return <>
    <div className="settings-section-heading"><div><h2>{t("快捷键")}</h2><p className="field-help">{t("点击组合键重新录制，按 Esc 取消。保存后立即生效。")}</p></div>
      <button id="reset-shortcuts" className="button button-secondary" type="button" disabled={app.savingShortcuts || !Object.keys(app.preferences.shortcuts).length} onClick={() => void app.saveShortcutOverrides({})}>{t("恢复全部默认")}</button></div>
    <p className="field-help">{t("应用快捷键需包含 ⌘。文本框中的方向键编辑优先；单独使用 Ctrl 或 Option 保留给 Pi 和文本输入。")}</p>
    <p id="shortcut-error" className="form-error" role="alert" hidden={!app.shortcutError}>{t(app.shortcutError)}</p>
    <div id="shortcut-list" className="shortcut-list">{commands.map(command => {
      const heading = group !== command.group; group = command.group;
      const label = t(command.label);
      const binding = t(format(values[command.id]));
      return <div className="shortcut-entry" key={command.id}>
        {heading && <h3 className="shortcut-group">{t(command.group)}</h3>}
        <div className="shortcut-row"><span className="shortcut-name">{label}</span><span className="shortcut-controls">
          <button type="button" className={'shortcut-binding' + (app.recordingShortcut === command.id ? ' recording' : '')}
            data-shortcut-id={command.id} aria-label={t('修改快捷键：{name}，{binding}', { name: label, binding })} aria-pressed={app.recordingShortcut === command.id}
            disabled={app.savingShortcuts} onClick={() => void app.beginShortcutRecording(command.id)}>
            {app.recordingShortcut === command.id ? t('请按组合键… Esc 取消') : binding}</button>
          <button type="button" className="button button-quiet" data-shortcut-clear={command.id} aria-label={t('清除快捷键：{name}', { name: label })}
            disabled={!values[command.id] || app.savingShortcuts} onClick={() => void app.changeShortcut(command.id, null)}>{t("清除")}</button>
          <button type="button" className="button button-quiet" data-shortcut-reset={command.id} aria-label={t('恢复默认快捷键：{name}', { name: label })}
            disabled={!Object.hasOwn(app.preferences.shortcuts, command.id) || app.savingShortcuts} onClick={() => void app.changeShortcut(command.id)}>{t("默认")}</button>
        </span></div>
      </div>;
    })}</div><p className="settings-note">{t("仅修改本应用快捷键，不改 Pi 或系统键位文件。恢复默认会移除所有自定义绑定。")}</p>
  </>;
}
