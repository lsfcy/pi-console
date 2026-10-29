import { t } from '../../../shared/i18n.js';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/AppContext.js';
import type { Theme } from '../../../shared/contracts.js';
export function AppearanceSettings() {
  const app = useWorkspace(), prefs = app.preferences;
  const [fontSize, setFontSize] = useState(String(prefs.fontSize));
  useEffect(() => setFontSize(String(prefs.fontSize)), [prefs.fontSize]);
  return <><h2>{t("外观")}</h2><div className="settings-columns">
    {([{ id: 'sidebar-theme-select', label: '左侧导航配色', key: 'sidebarTheme' }, { id: 'theme-select', label: '右侧工作区与终端', key: 'workspaceTheme' }] as const).map(field =>
      <div key={field.id}><label htmlFor={field.id}>{t(field.label)}</label><select id={field.id} className="text-input" value={prefs[field.key]}
        onChange={event => void app.savePreferences({ [field.key]: event.target.value as Theme })}>
        <option value="system">{t("跟随系统")}</option><option value="light">{t("亮色")}</option><option value="dark">{t("暗色")}</option></select></div>)}
    </div>
    <label htmlFor="language-select">{t("界面语言")}</label><select id="language-select" className="text-input" value={prefs.language}
      onChange={event => void app.savePreferences({ language: event.target.value as 'zh-CN' | 'en-US' })}>
      <option value="zh-CN">{t("简体中文")}</option><option value="en-US">English</option></select>
    <p className="field-help">{t("侧栏与工作区可独立配色；只同步 GUI 内 Pi，不修改 Pi 全局主题。语言切换立即生效，不重启 Pi、不丢失草稿。")}</p>
    <label htmlFor="font-size">{t("终端字号")}</label><input id="font-size" className="text-input short-input" type="number" min={10} max={22} step={1}
      value={fontSize} onChange={event => {
        setFontSize(event.target.value);
        const value = Number(event.target.value);
        if (Number.isInteger(value) && value >= 10 && value <= 22) void app.savePreferences({ fontSize: value });
      }} onBlur={() => {
        const value = Number(fontSize);
        if (!Number.isInteger(value) || value < 10 || value > 22) { setFontSize(String(prefs.fontSize)); app.notify(t('终端字号应为 10～22 的整数。')); }
      }} />
  </>;
}
