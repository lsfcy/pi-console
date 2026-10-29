import { t } from '../../shared/i18n.js';
import { bindings, format } from '../../shared/shortcuts.js';
import { useWorkspace } from '../state/AppContext.js';
import { Icon } from './Icon.js';
import { Tabs } from './Tabs.js';
import { ShortcutHint, useCommandTitle } from './ShortcutHint.js';
import { TerminalStage } from '../terminal/TerminalStage.js';
import { HistoryPanel } from '../features/sessions/HistoryPanel.js';
import { StatsToggle } from '../features/sessions/StatsToggle.js';
import { SettingsPanel } from '../features/settings/SettingsPanel.js';
export function Workspace() {
  const app = useWorkspace(), project = app.currentProject, global = app.route !== 'project';
  const active = project ? app.workspace.terminals.get(app.workspace.activeId(app.selectedId)) : null;
  const showHistory = app.route === 'recent' || (app.route === 'project' && Boolean(project) && app.workspace.activeId(app.selectedId) === 'history');
  const disabled = !project || project.available === false || Boolean(app.update?.state.running);
  const newTitle = useCommandTitle('new-tab');
  const navProject = app.projects.find(item => item.id === app.navTarget?.projectId);
  const keys = bindings(app.preferences.shortcuts);
  return <main className={'workspace' + (global ? ' showing-global' : '') + (app.route === 'settings' ? ' showing-settings' : '') + (app.navHeld ? ' command-nav' : '') + (app.navPending ? ' nav-pending' : '')} id="workspace">
    {app.navHeld && <div className="command-nav-hud" aria-hidden="true">
      <span className="command-nav-brand">NAV</span>
      <span>{t('项目')} <kbd>{format(keys['project-1'])}</kbd> … <kbd>{format(keys['project-0'])}</kbd></span>
      <span>{t('会话')} <kbd>{format(keys['sidebar-previous'])}</kbd> <kbd>{format(keys['sidebar-next'])}</kbd> <em className="command-nav-commit">{t('已打开即切换 · 未打开按 Enter')}</em></span>
      <span>{t('标签')} <kbd>{format(keys['previous-tab'])}</kbd> <kbd>{format(keys['next-tab'])}</kbd></span>
    </div>}
    {app.navPending && app.navTarget && <button type="button" className="nav-enter-prompt" data-nav-enter-id={app.navTarget.key || app.navTarget.terminalId || ''} onClick={() => app.confirmNavTarget()}>
      <span className="nav-enter-key">↵ ENTER</span>
      <span className="nav-enter-copy"><strong>{app.navTarget.title}</strong><small>{navProject?.name || t('未知项目')}</small></span>
      <span className="nav-enter-cancel"><kbd>Esc</kbd> {t('取消')}</span>
    </button>}
    <div className="tabs-toolbar" id="tabs-toolbar" hidden={global}><Tabs />
      {app.navHeld && <span className="tabs-nav-rail" aria-hidden="true"><kbd>{format(keys['previous-tab'])}</kbd><kbd>{format(keys['next-tab'])}</kbd> {t('标签')}</span>}
      {showHistory && <StatsToggle />}
      <button id="new-tab" className="icon-button new-tab-button" title={newTitle + t('；右键可新建临时会话（⌘⇧N）')} aria-label={t("新建会话")} aria-haspopup="menu" onContextMenu={event => { event.preventDefault(); app.newSessionMenu(); }} disabled={disabled || app.pendingProjects.has(app.selectedId)} onClick={() => void app.createPi()}><Icon name="plus" /></button></div>
    <div className="workspace-body" id="workspace-body">
      <div className="main-area" id="main-area">
        <section id="welcome" className="empty-state" hidden={global || Boolean(project)}>
          <div className="hero-symbol"><Icon name="terminal" /></div><h1>{t("项目会话工作区")}</h1>
          <p>{t("自动发现本机 Pi 会话。")}<br />{t("添加目录或选择项目开始工作。")}</p><button id="welcome-add" className="button button-primary button-large" onClick={() => app.shortcut('add')}>{t("添加项目")}<Icon name="arrow" /></button>
        </section>
        <HistoryPanel hidden={!showHistory} /><SettingsPanel hidden={app.route !== 'settings'} />
        <TerminalStage hidden={!project || showHistory || global} />
      </div>
    </div>
    <footer className="workspace-footer"><span id="footer-project">{app.route === 'settings' ? t('设置自动保存 · 不修改 Pi 全局配置') : app.statsVisible ? t('全部项目 · token、缓存、成本与会话活动') : app.route === 'recent' ? t('全部项目 · 已保存历史与 GUI 内运行中的会话') : project?.path || t('自动发现本机 Pi 项目与会话')}</span>
      <span id="footer-process">{active?.ephemeral ? t('临时 · 不保存历史 · ') : ''}{active?.pid ? 'PID ' + active.pid : ''}</span>
      <div className="shortcut-hints"><span><ShortcutHint command="search" /> {t('面板')}</span><span><ShortcutHint command="new-tab" /> {t('新建')}</span><span><ShortcutHint command="open-terminal" /> {t('终端')}</span>
        <span><ShortcutHint command="previous-tab" /> / <ShortcutHint command="next-tab" /> {t('切换标签')}</span><span><kbd>⇧ ↵</kbd> {t('换行')}</span>
        <span><button id="show-shortcuts" type="button" onClick={() => void app.openSettings('shortcuts')}><ShortcutHint command="shortcut-help" /> {t('快捷键')}</button></span></div>
    </footer>
  </main>;
}
