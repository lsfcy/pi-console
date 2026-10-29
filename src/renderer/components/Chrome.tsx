import { useWorkspace } from '../state/AppContext.js';
import { Icon } from './Icon.js';
import { useCommandTitle } from './ShortcutHint.js';
import { t } from '../../shared/i18n.js';
export function Chrome() {
  const app = useWorkspace(), back = useCommandTitle('back'), forward = useCommandTitle('forward'), sidebar = useCommandTitle('toggle-sidebar');
  const title = app.route === 'settings' ? t('设置') : app.route === 'recent' ? t('会话 · 全部项目') : app.currentProject?.name || 'Pi Console';
  return <header className="app-chrome" aria-label={t("窗口导航")}>
    <nav className="window-navigation" data-theme={app.preferences.sidebarCollapsed ? undefined : app.sidebarMode} aria-label={t("页面导航")}>
      <button id="navigate-back" className="icon-button" type="button" aria-label={t('返回上一步')} title={back} disabled={!app.navigation.canMove(-1)} onClick={() => app.navigation.move(-1)}><Icon name="arrow" /></button>
      <button id="navigate-forward" className="icon-button" type="button" aria-label={t('前进')} title={forward} disabled={!app.navigation.canMove(1)} onClick={() => app.navigation.move(1)}><Icon name="arrow" /></button>
      <button id="toggle-sidebar" className="icon-button sidebar-toggle" title={sidebar} aria-label={t('显示或隐藏侧边栏')} aria-controls="sidebar"
        aria-expanded={!app.preferences.sidebarCollapsed} onClick={() => void app.savePreferences({ sidebarCollapsed: !app.preferences.sidebarCollapsed })}><Icon name="sidebar" /></button>
    </nav>
    <div className="chrome-heading"><strong id="project-title" title={app.currentProject?.path}>{title}</strong>
      <div className="project-open-actions" hidden={!app.currentProject}>
        <button id="open-project" type="button" title={t('在访达中打开当前项目目录')} aria-label={t('在访达中打开当前项目目录')} disabled={app.currentProject?.available === false}
          onClick={() => app.safely(() => app.bridge.openProject(app.selectedId, 'finder'))}><Icon name="folder" /><span>{t("打开")}</span></button>
        <button id="open-project-menu" type="button" title={t("选择打开方式")} aria-label={t("选择项目打开方式")} aria-haspopup="menu" disabled={app.currentProject?.available === false}
          onClick={() => app.safely(() => app.bridge.openProjectMenu(app.selectedId))}><Icon name="chevron" /></button>
      </div>
    </div>
  </header>;
}
