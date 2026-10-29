const test = require('node:test');
const assert = require('node:assert/strict');
const { TerminalMouseModes } = require('../build/shared/terminal-mouse-modes.js');

test('鼠标模式快照按顺序处理分片、组合、关闭与重置', () => {
  const modes = new TerminalMouseModes();
  modes.feed('\x1b[?1000;100'); modes.feed('2;1003;1004;1006h');
  assert.equal(modes.snapshot(), '\x1b[?9;1000;1002;1003;1004;1006l\x1b[?1003h\x1b[?1004h\x1b[?1006h');
  modes.feed('\x1b[?1003l\x1b[?1006l');
  assert.equal(modes.snapshot(), '\x1b[?9;1000;1002;1003;1004;1006l\x1b[?1004h');
  modes.feed('\x1bc');
  assert.equal(modes.snapshot(), '\x1b[?9;1000;1002;1003;1004;1006l');
});
test('OSC/DCS 内容中的控制序列不是终端模式，结束后仍可解析', () => {
  const modes = new TerminalMouseModes();
  modes.feed('\x1b]8;;https://example/\x1b[?1003h\x1b'); modes.feed('\\');
  modes.feed('\x1bPpayload\x1b[?1006h\x1b\\');
  assert.equal(modes.snapshot(), '\x1b[?9;1000;1002;1003;1004;1006l');
  modes.feed('\x1b[?1002;1006h');
  assert.equal(modes.snapshot(), '\x1b[?9;1000;1002;1003;1004;1006l\x1b[?1002h\x1b[?1006h');
});
