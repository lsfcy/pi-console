import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { TerminalState, PiGuiAPI, Appearance } from '../../shared/contracts.js';
import { DimensionSync, parseProgramStatus, modifiedEnter, fittedTerminalSize, isPiSuspend } from '../../shared/terminal-utils.js';
import { message } from '../../shared/errors.js';
import { palettes } from '../../shared/terminal-theme.js';
import { t } from '../../shared/i18n.js';
let fallbackWarningShown = false;
const isWebLink = (uri: string) => /^https?:\/\//i.test(uri);
export class TerminalView {
  state: TerminalState;
  bridge: PiGuiAPI;
  notify: (message: string) => void;
  visible: boolean | null;
  webgl: import('@xterm/addon-webgl').WebglAddon | null;
  gpuContext: WebGL2RenderingContext | null;
  rendererKind: 'dom' | 'webgl';
  webglBlocked: boolean;
  sizeSync: DimensionSync;
  container: HTMLDivElement;
  term: import('@xterm/xterm').Terminal;
  fitAddon: import('@xterm/addon-fit').FitAddon;
  private hoveredLink: { uri: string; range: import('@xterm/xterm').IBufferRange } | null = null;
  private hitHoveredLink(event: MouseEvent) {
    const link = this.hoveredLink, screen = this.term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
    if (!link || !screen || !screen.width || !screen.height || event.clientX < screen.left || event.clientX >= screen.right ||
        event.clientY < screen.top || event.clientY >= screen.bottom) return false;
    const x = Math.floor((event.clientX - screen.left) * this.term.cols / screen.width) + 1;
    const y = Math.floor((event.clientY - screen.top) * this.term.rows / screen.height) + 1 + this.term.buffer.active.viewportY;
    const { start, end } = link.range;
    return y >= start.y && y <= end.y && (y !== start.y || x >= start.x) && (y !== end.y || x <= end.x);
  }
  private localPress: { uri: string; x: number; y: number } | null = null;
  private onLocalMouseDown = (event: MouseEvent) => {
    const forcedSelection = /Mac/.test(navigator.platform) ? event.altKey : event.shiftKey;
    if (event.button !== 0 || forcedSelection ||
        this.state.kind !== 'pi' || this.term.modes.mouseTrackingMode === 'none' ||
        !this.hoveredLink || isWebLink(this.hoveredLink.uri) || !this.hitHoveredLink(event)) return;
    this.localPress = { uri: this.hoveredLink.uri, x: event.clientX, y: event.clientY };
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private onLocalMouseUp = (event: MouseEvent) => {
    const press = this.localPress;
    if (!press || event.button !== 0) return;
    this.localPress = null;
    event.preventDefault(); event.stopImmediatePropagation();
    if (this.hoveredLink?.uri === press.uri && this.hitHoveredLink(event) && this.container.contains(event.target as Node) &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) this.openLink(press.uri);
  };
  private onLocalBlur = () => { this.localPress = null; this.hoveredLink = null; };
  private openLink(uri: string) {
    const request = isWebLink(uri) ? this.bridge.openExternal(uri) : this.bridge.revealTerminalPath(this.state.id, this.state.runId, uri);
    void request.catch(error => this.notify(message(error)));
  }
  constructor(state: TerminalState, parent: HTMLElement, { bridge, appearance, fontSize, notify }: {
    bridge: PiGuiAPI; appearance: Appearance; fontSize: number; notify: (message: string) => void;
  }) {
    this.state = state;
    this.bridge = bridge;
    this.notify = notify; this.visible = null; this.webgl = null; this.gpuContext = null;
    this.rendererKind = 'dom'; this.webglBlocked = false;
    this.sizeSync = new DimensionSync((cols, rows) => bridge.resize(state.id, state.runId, cols, rows));
    this.container = document.createElement('div');
    this.container.className = 'terminal-pane renderer-dom';
    this.container.dataset.renderer = 'dom';
    this.container.dataset.terminalId = state.id;
    parent.append(this.container);
    this.term = new Terminal({
      fontFamily: '"SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace', fontSize,
      cols: state.cols || 100, rows: state.rows || 30,
      lineHeight: 1.22, cursorBlink: true, cursorStyle: 'bar', scrollback: state.kind === 'pi' ? 0 : 5000,
      macOptionIsMeta: true, macOptionClickForcesSelection: true, rightClickSelectsWord: true,
      minimumContrastRatio: 4.5, theme: palettes[appearance] || palettes.dark,
      linkHandler: {
        allowNonHttpProtocols: true,
        hover: (_event, uri, range) => { this.hoveredLink = { uri, range }; },
        leave: (_event, uri) => { if (this.hoveredLink?.uri === uri) this.hoveredLink = null; },
        activate: (event, uri) => {
          // Fullscreen Pi owns web links; local links are intercepted before mouse reporting.
          const forcedSelection = /Mac/.test(navigator.platform) ? event.altKey : event.shiftKey;
          if (state.kind === 'pi' && this.term.modes.mouseTrackingMode !== 'none' && !forcedSelection) return;
          this.openLink(uri);
        }
      }
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon((_event, uri) => bridge.openExternal(uri).catch(error => notify(message(error)))));
    this.term.open(this.container);
    this.container.addEventListener('mousedown', this.onLocalMouseDown, true);
    window.addEventListener('mouseup', this.onLocalMouseUp, true);
    window.addEventListener('blur', this.onLocalBlur);
    this.term.textarea?.setAttribute('aria-label', t('Pi 会话输入'));
    this.term.onData(data => bridge.input(state.id, state.runId, data));
    this.term.onResize(size => this.sizeSync.sync(size.cols, size.rows));
    this.term.parser.registerOscHandler(7502, () => true);
    this.term.parser.registerOscHandler(7501, data => {
      const status = parseProgramStatus(data);
      if (status) bridge.reportStatus(state.id, state.runId, status.status, status.message);
      return true;
    });
    this.term.attachCustomWheelEventHandler(event => {
      // xterm maps wheel to Up/Down when it has no scrollback and mouse reporting is off.
      // In Pi that browses prompt history rather than the transcript; never synthesize keys.
      if (state.kind === 'pi' && ['none', 'x10'].includes(this.term.modes.mouseTrackingMode)) {
        event.preventDefault(); return false;
      }
      return true;
    });
    this.term.attachCustomKeyEventHandler(event => {
      if (event.metaKey) return false;
      if (state.kind !== 'pi') return true;
      // An embedded exec'd Pi has no parent job-control shell to resume it with fg.
      if (isPiSuspend(event)) { event.preventDefault(); return false; }
      const sequence = modifiedEnter(event);
      if (!sequence) return true;
      event.preventDefault();
      if (event.type === 'keydown') bridge.input(state.id, state.runId, sequence);
      return false;
    });
  }
  setVisible(visible: boolean) {
    this.container.hidden = !visible;
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) { this.releaseWebgl(); return; }
    if (this.webglBlocked) return;
    let addon: import('@xterm/addon-webgl').WebglAddon | undefined;
    try {
        addon = new WebglAddon();
      addon.onContextLoss(() => {
        if (this.webgl !== addon) return;
        this.releaseWebgl(); this.warnFallback(); this.fit();
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
      this.gpuContext = [...this.term.element!.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas')].at(-1)?.getContext('webgl2') || null;
      this.rendererKind = 'webgl';
      this.container.dataset.renderer = 'webgl'; this.container.classList.remove('renderer-dom');
    } catch {
      addon?.dispose();
      this.webglBlocked = true; this.warnFallback();
    }
  }
  warnFallback() {
    if (fallbackWarningShown) return;
    fallbackWarningShown = true;
    this.notify(t('图形加速不可用，已切换兼容渲染；会话进程与草稿不受影响。'));
  }
  releaseWebgl() {
    const addon = this.webgl, context = this.gpuContext;
    this.webgl = null; this.gpuContext = null;
    addon?.dispose();
    // Disposing the addon removes its listeners first; explicitly release this hidden canvas's GPU context.
    try { context?.getExtension('WEBGL_lose_context')?.loseContext(); } catch {}
    this.rendererKind = 'dom'; this.container.dataset.renderer = 'dom'; this.container.classList.add('renderer-dom');
  }
  setAppearance(appearance: Appearance, fontSize: number) {
    this.term.options.theme = palettes[appearance] || palettes.dark;
    this.term.options.fontSize = fontSize;
  }
  fit() {
    if (this.container.hidden || !this.container.clientWidth || !this.container.clientHeight) return;
    const proposed = this.fitAddon.proposeDimensions();
    if (!proposed) return;
    const screenWidth = this.term.element!.querySelector<HTMLElement>('.xterm-screen')!.getBoundingClientRect().width;
    const cellWidth = screenWidth / this.term.cols;
    // Blink's DOM text runs round each glyph to 1/64 px. Allow that paint to extend without clipping.
    const overhang = this.rendererKind === 'dom' ? Math.ceil((Math.ceil(Math.min(500, proposed.cols) / 64) + 2) / Math.max(1, cellWidth)) : 0;
    const size = fittedTerminalSize(proposed, overhang);
    if (!size) return;
    if (this.term.cols !== size.cols || this.term.rows !== size.rows) this.term.resize(size.cols, size.rows);
    // First fit MUST reach the PTY even when xterm.resize would emit no change event.
    this.sizeSync.sync(size.cols, size.rows);
  }
  dispose() {
    this.container.removeEventListener('mousedown', this.onLocalMouseDown, true);
    window.removeEventListener('mouseup', this.onLocalMouseUp, true);
    window.removeEventListener('blur', this.onLocalBlur);
    this.releaseWebgl(); this.term.dispose(); this.container.remove();
  }
}
