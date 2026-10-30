import { t } from '../../../shared/i18n.js';
import { useWorkspace } from '../../state/AppContext.js';
import { AppearanceSettings } from './AppearanceSettings.js';
import { SessionSettings } from './SessionSettings.js';
import { ShortcutSettings } from './ShortcutSettings.js';
import { UpdateSettings } from './UpdateSettings.js';
import { AppUpdateSettings } from './AppUpdateSettings.js';
const sections = [
  { id: 'appearance', label: '外观' }, { id: 'sessions', label: '会话与提醒' },
  { id: 'shortcuts', label: '快捷键' }, { id: 'updates', label: 'Pi 与插件' }, { id: 'about', label: '关于' }
];
export function SettingsPanel({ hidden }: { hidden: boolean }) {
  const app = useWorkspace();
  const select = (id: string) => { app.stopShortcutRecording(); app.settingsSection = id; app.publish(); const panel = document.getElementById('settings-panel'); if (panel) panel.scrollTop = 0; };
  return <section id="settings-panel" className="settings-panel" aria-label={t("设置")} hidden={hidden} onScroll={app.navigation.replace}>
    <div className="settings-actions"><button id="open-onboarding" className="button button-quiet" type="button" onClick={app.openOnboarding}>{t("新手引导")}</button><button id="close-settings" className="button button-quiet" type="button" onClick={app.leaveSettings}>{t("返回工作区")}</button></div>
    <div className="settings-layout">
      <nav id="settings-nav" className="settings-nav" role="tablist" aria-label={t("设置分类")} aria-orientation="vertical" onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-settings-section]')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      }}>{sections.map(section => <button key={section.id} id={'settings-tab-' + section.id} type="button" role="tab" data-settings-section={section.id}
          aria-controls={'settings-' + section.id} aria-selected={app.settingsSection === section.id} tabIndex={app.settingsSection === section.id ? 0 : -1}
          onClick={() => select(section.id)}>{t(section.label)}</button>)}</nav>
      <div className="settings-content" id="settings-content">
        {sections.map(section => <section key={section.id} id={'settings-' + section.id} className="settings-section" role="tabpanel"
          aria-labelledby={'settings-tab-' + section.id} hidden={app.settingsSection !== section.id}>
          {section.id === 'appearance' ? <AppearanceSettings /> : section.id === 'sessions' ? <SessionSettings /> :
            section.id === 'shortcuts' ? <ShortcutSettings /> : section.id === 'updates' ? <UpdateSettings /> :
              <><div className="settings-section-heading"><h2>{t("关于与边界")}</h2><button id="open-about" className="button button-quiet" onClick={() => { app.aboutOpen = true; app.publish(); }}>{t("关于")}</button></div>
                <p className="field-help">{t("Pi Console 是本地多项目会话管理工具。供应商接入、模型、工具和上下文配置由 Pi 管理。")}</p>
                <AppUpdateSettings /></>}
        </section>)}
      </div>
    </div>
  </section>;
}
