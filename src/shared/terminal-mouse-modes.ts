// Track the terminal's mouse modes independently of the bounded output replay.
// Only CSI DECSET/DECRST outside OSC/DCS strings changes the snapshot.
export class TerminalMouseModes {
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text';
  private csi = '';
  private tracking = 0;
  private sgr = false;
  private focus = false;
  feed(data: string) {
    for (const ch of data) {
      if (this.state === 'string') {
        if (ch === '\x07' || ch === '\x9c') this.state = 'text';
        else if (ch === '\x1b') this.state = 'string-escape';
      } else if (this.state === 'string-escape') {
        this.state = ch === '\\' ? 'text' : ch === '\x1b' ? 'string-escape' : 'string';
      } else if (this.state === 'csi') {
        if (ch >= '@' && ch <= '~') {
          if ((ch === 'h' || ch === 'l') && /^\?[0-9;]+$/.test(this.csi)) {
            const enabled = ch === 'h';
            for (const value of this.csi.slice(1).split(';').map(Number)) {
              if ([9, 1000, 1002, 1003].includes(value)) this.tracking = enabled ? value : 0;
              else if (value === 1006) this.sgr = enabled;
              else if (value === 1004) this.focus = enabled;
            }
          }
          this.csi = ''; this.state = 'text';
        } else if (ch === '\x1b') { this.csi = ''; this.state = 'escape'; }
        else if (this.csi.length < 128) this.csi += ch;
        else { this.csi = ''; this.state = 'text'; }
      } else if (this.state === 'escape') {
        if (ch === '[') { this.csi = ''; this.state = 'csi'; }
        else if (']P_^X'.includes(ch)) this.state = 'string';
        else {
          if (ch === 'c') { this.tracking = 0; this.sgr = false; this.focus = false; }
          this.state = ch === '\x1b' ? 'escape' : 'text';
        }
      } else if (ch === '\x1b') this.state = 'escape';
      else if (ch === '\x9b') { this.csi = ''; this.state = 'csi'; }
      else if ('\x90\x98\x9d\x9e\x9f'.includes(ch)) this.state = 'string';
    }
  }
  snapshot() {
    return '\x1b[?9;1000;1002;1003;1004;1006l' +
      (this.tracking ? `\x1b[?${this.tracking}h` : '') +
      (this.focus ? '\x1b[?1004h' : '') + (this.sgr ? '\x1b[?1006h' : '');
  }
}
