import { t } from '../../../shared/i18n.js';
import { useWorkspace } from '../../state/AppContext.js';

export function AppUpdateSettings() {
  const app = useWorkspace(), release = app.appRelease;
  return <div className="app-update-settings">
    <div className="version-row"><span>Pi Console</span><code id="app-version-settings">{app.appVersion}</code></div>
    <label className="checkbox-label"><input id="check-app-updates-auto" type="checkbox" checked={app.preferences.checkAppUpdates}
      onChange={event => void app.savePreferences({ checkAppUpdates: event.target.checked })} />{t('自动检查 Pi Console 更新')}</label>
    <p className="field-help">{t('启动时及运行期间每小时查询 GitHub 公开版本；不上传会话，不会自动下载或安装。关闭后不再自动发起检查。')}</p>
    <button id="check-app-update" type="button" className="button button-secondary" disabled={app.appUpdateChecking}
      onClick={() => void app.checkAppUpdate(true)}>{t(app.appUpdateChecking ? '正在检查…' : '检查 Pi Console 更新')}</button>
    <p id="app-update-status" className="field-help" role="status" aria-live="polite">
      {app.appUpdateError || (app.appUpdateChecking ? t('正在检查…') : !release ? t('尚未检查应用更新。') :
        release.available ? t('发现新版本 {version}。', { version: release.latestVersion }) : t('当前已是此更新渠道的最新版本。'))}
    </p>
    {release?.available && !app.appUpdateError && <button id="open-app-release" type="button" className="button button-primary"
      onClick={() => app.safely(() => app.bridge.openExternal(release.url))}>{t('查看新版本与下载')}</button>}
    <button id="open-app-releases" type="button" className="button button-quiet"
      onClick={() => app.safely(() => app.bridge.openAppReleases())}>{t('查看所有发布版本')}</button>
    <p className="field-help">{t('候选版会检查候选版和正式版；正式版只检查正式版。安装前请自行处理正在运行的 Pi。')}</p>
  </div>;
}
