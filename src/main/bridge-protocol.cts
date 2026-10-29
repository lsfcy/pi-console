import type { BridgeMetadata } from '../shared/contracts.js';
const PREFIX = '\x1b]7502;';
const END = '\x1b\\';
function frame(code: number, value: unknown) {
  return '\x1b]' + code + ';' + Buffer.from(JSON.stringify(value)).toString('base64') + END;
}
class FrameDecoder {
  token: string;
  receive: (value: BridgeMetadata) => void;
  pending: string;
  constructor(token: string, receive: (value: BridgeMetadata) => void) { this.token = token; this.receive = receive; this.pending = ''; }
  feed(data: string) {
    this.pending += data;
    while (true) {
      const start = this.pending.indexOf(PREFIX);
      if (start < 0) { this.pending = this.pending.slice(-PREFIX.length); return; }
      this.pending = this.pending.slice(start);
      const st = this.pending.indexOf(END, PREFIX.length);
      const bell = this.pending.indexOf('\x07', PREFIX.length);
      const end = st < 0 ? bell : bell < 0 ? st : Math.min(st, bell);
      if (end < 0) {
        if (this.pending.length > 32768) this.pending = '';
        return;
      }
      const encoded = this.pending.slice(PREFIX.length, end);
      this.pending = this.pending.slice(end + (end === st ? END.length : 1));
      if (encoded.length > 16384 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) continue;
      try {
        const value: BridgeMetadata = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
        if (value && value.token === this.token) this.receive(value);
      } catch { /* Foreign/malformed OSC data is not an application command. */ }
    }
  }
}
export { frame, FrameDecoder };
