import { t } from '../../../shared/i18n.js';
import { useLayoutEffect, useRef } from 'react';
import { useWorkspace } from '../../state/AppContext.js';
import { stripAnsi } from '../../../shared/format.js';
export function UpdateSettings() {
  const app = useWorkspace(), running = Boolean(app.update?.state.running), target = app.update?.state.updateTarget || 'self';
  const labels = { self: 'Pi 更新', extensions: '插件更新', all: 'Pi 与插件更新' };
  const commands = { self: 'pi update --self', extensions: 'pi update --extensions', all: 'pi update --all' };
  const log = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [app.updateOutput]);
  const disabled = app.updateLaunching || running || app.workspace.terminals.size > 0;
  return <>
    <div className="settings-section-heading"><h2>{t("Pi 与插件")}</h2><button id="check-version" className="button button-quiet" disabled={running} onClick={() => void app.readPiVersion(true)}>{t("刷新版本")}</button></div>
    <div className="version-row"><span>Pi</span><code id="pi-version">{t(app.piVersion)}</code></div>
    <p id="pi-packages" className="field-help" title={app.packageFile}>{t(app.piPackages)}</p>
    <div className="update-actions">
      <button id="run-update" className="button button-primary" disabled={disabled} onClick={() => void app.runUpdate('self')}>{t("更新 Pi")}<small>{commands.self}</small></button>
      <button id="run-update-extensions" className="button button-secondary" disabled={disabled} onClick={() => void app.runUpdate('extensions')}>{t("更新插件")}<small>{commands.extensions}</small></button>
      <button id="run-update-all" className="button button-secondary" disabled={disabled} onClick={() => void app.runUpdate('all')}>{t("全部更新")}<small>{commands.all}</small></button>
      <button id="cancel-update" className="button button-danger" hidden={!running} disabled={Boolean(app.update && app.closing.has(app.update.state.id))}
        onClick={() => { if (app.update) void app.closeTerminal(app.update.state.id); }}>{t("中止更新")}</button>
    </div>
    <p id="update-status" className="field-help">{running ? t('正在执行 {command}；此期间不能新开 Pi 或 Shell。可离开设置页面，更新仍会继续。', { command: commands[target] }) :
      app.update?.state ? t(app.update.state.message || (app.update.state.exitCode === 0 ? '{name}完成。新建会话将使用更新后的版本。' : '{name}已中止或失败，请查看日志并人工重试。'), { name: t(labels[target]) }) :
      t(app.workspace.terminals.size ? '请先关闭 GUI 内所有 Pi 标签。不会自动中断现有任务。' : '更新会修改本机 Pi 安装或插件，请先退出外部正在使用的 Pi。')}</p>
    {app.update && !running && <button id="clear-update-log" className="button button-secondary" disabled={app.closing.has(app.update.state.id)} onClick={() => void app.clearUpdateLog()}>{t("清除更新结果与日志")}</button>}
    <pre id="update-log" className="update-log" aria-label={t("Pi 更新日志")} hidden={!app.updateOutput} ref={log}>{stripAnsi(app.updateOutput).slice(-128 * 1024)}</pre>
  </>;
}
