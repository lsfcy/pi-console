import type { ApplicationEvent, Appearance, PiGuiAPI, TerminalState } from '../../shared/contracts.js';
import { TerminalView } from './terminal-view.js';
import { t } from '../../shared/i18n.js';
type Output = Omit<Extract<ApplicationEvent, { type: 'data' }>, 'type'>;

/** Owns xterm resources, not OS processes. PTY bytes never enter React state. */
export class TerminalRegistry {
  readonly views = new Map<string | null, TerminalView>();
  private pending = new Map<string, Output[]>();
  private frame: number | null = null;
  constructor(private bridge: PiGuiAPI, private notify: (message: string) => void) {}
  mount(state: TerminalState, parent: HTMLElement, appearance: Appearance, fontSize: number) {
    const view = new TerminalView(state, parent, { bridge: this.bridge, appearance, fontSize, notify: this.notify });
    this.views.set(state.id, view);
    const pending = this.pending.get(state.id) || [];
    this.pending.delete(state.id);
    for (const event of pending) {
      if (event.runId === state.runId) this.write(event);
      else this.bridge.acknowledge(event.id, event.runId, event.data.length);
    }
    return () => {
      if (this.views.get(state.id) !== view) return;
      view.dispose(); this.views.delete(state.id); this.discard(state.id);
    };
  }
  write(event: Output) {
    const view = this.views.get(event.id);
    if (view?.state.runId === event.runId) {
      view.term.write(event.data, () => this.bridge.acknowledge(event.id, event.runId, event.data.length));
      return;
    }
    if (view) { this.bridge.acknowledge(event.id, event.runId, event.data.length); return; }
    const queue = this.pending.get(event.id) || [];
    if (queue.reduce((n, item) => n + item.data.length, 0) < 1024 * 1024) {
      queue.push(event); this.pending.set(event.id, queue);
    } else {
      this.bridge.acknowledge(event.id, event.runId, event.data.length);
      this.notify(t('终端输出缓冲已满，请关闭后从历史恢复会话。'));
    }
  }
  discard(id: string) {
    for (const event of this.pending.get(id) || []) this.bridge.acknowledge(id, event.runId, event.data.length);
    this.pending.delete(id);
  }
  requestLayout = () => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const view of this.views.values()) if (!view.container.hidden) view.fit();
    });
  };
  focus(id: string | null) { requestAnimationFrame(() => this.views.get(id)?.term.focus()); }
  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    for (const id of this.pending.keys()) this.discard(id);
  }
}
