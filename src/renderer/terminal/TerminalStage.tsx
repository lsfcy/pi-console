import { t } from '../../shared/i18n.js';
import { memo, useLayoutEffect, useRef } from 'react';
import type { TerminalState } from '../../shared/contracts.js';
import { useWorkspace } from '../state/AppContext.js';
const TerminalPane = memo(function TerminalPane({ state, visible }: { state: TerminalState; visible: boolean }) {
  const app = useWorkspace(), host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current) return;
    return app.terminals.mount(state, host.current, app.appearance, app.preferences.fontSize);
    // A run owns one xterm. Other state updates must not remount it or lose its draft.
  }, [app, state.id, state.runId]);
  useLayoutEffect(() => {
    const view = app.views.get(state.id);
    if (!view) return;
    view.state = state; view.setAppearance(app.appearance, app.preferences.fontSize); view.setVisible(visible);
    app.terminals.requestLayout();
  }, [app, state, visible, app.appearance, app.preferences.fontSize]);
  return <div className="terminal-host" ref={host} hidden={!visible} />;
});
export function TerminalStage({ hidden }: { hidden: boolean }) {
  const app = useWorkspace(), active = app.workspace.activeId(app.selectedId);
  return <div id="terminal-stage" hidden={hidden} aria-label={t("当前项目终端")}>
    {[...app.workspace.terminals.values()].filter(state => state.kind === 'pi' && state.running).map(state =>
      <TerminalPane key={state.id + ':' + state.runId} state={state} visible={!hidden && state.projectId === app.selectedId && state.id === active} />)}
  </div>;
}
