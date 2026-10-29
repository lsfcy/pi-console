import { t } from '../../shared/i18n.js';
import { useWorkspace } from '../state/AppContext.js';
import { Icon } from './Icon.js';
import { statusFor } from '../../shared/view-model.js';
import type { TerminalState } from '../../shared/contracts.js';
export function Tabs() {
  const app = useWorkspace(), active = app.workspace.activeId(app.selectedId);
  const list: (TerminalState | null)[] = app.currentProject ? [null, ...app.workspace.list(app.selectedId)] : [];
  return <div id="workspace-tabs" className="tab-list" role="tablist" aria-label={t("当前项目会话和终端标签")}>
    {list.map(state => {
      const id = state?.id || 'history', title = state?.label || t('会话历史');
      const activePi = state?.kind === 'pi' && ['working', 'running', 'blocked'].includes(state.status);
      const closeTitle = state?.kind === 'pi' ? (activePi ? t('关闭标签并结束 Pi（进行中，需要确认）') : t('关闭标签并结束 Pi 进程')) : t('关闭此标签及其进程');
      const closeLabel = activePi ? t('关闭标签并结束 Pi（需要确认）：{title}', { title }) : t('关闭标签并结束 Pi：{title}', { title });
      return <div key={id} className={'workspace-tab' + (id === active ? ' active' : '')} data-tab-id={id}
        onContextMenu={event => { if (!state) return; event.preventDefault(); app.safely(() => app.bridge.terminalMenu(state.id)); }}>
        <button className="tab-select" data-tab-id={id} role="tab" aria-label={title} aria-selected={id === active} tabIndex={id === active ? 0 : -1} title={title + (state?.ephemeral ? t(' · 临时会话，不保存历史') : '')}
          onClick={() => app.activateTab(id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
            const ids = list.map(item => item?.id || 'history'), index = Math.max(0, ids.indexOf(active));
            const next = ids[(index + (event.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length];
            app.activateTab(next); requestAnimationFrame(() => document.querySelector<HTMLElement>('.tab-select[data-tab-id="' + next + '"]')?.focus());
          }}>
          {!state ? <Icon name="history" /> : <span className={'status-dot ' + state.status} role="img" aria-label={statusFor(state).label} title={statusFor(state).label} />}
          <span className="tab-label">{title}</span>{state?.ephemeral && <span className="ephemeral-badge">{t("临时 · 不保存")}</span>}
        </button>
        {state && <button className="icon-button tab-close" data-close-terminal={id} aria-label={state.kind === 'pi' ? closeLabel : t('关闭终端：{title}', { title })} title={closeTitle}
          disabled={app.closing.has(id)} onClick={() => { if (state.kind === 'pi') app.closePiTab(id); else void app.closeTerminal(id); }}><Icon name="close" /></button>}
      </div>;
    })}
  </div>;
}
