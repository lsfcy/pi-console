const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('strict TypeScript 与 React 构建只生成可删除的产物', () => {
  const config = require('../tsconfig.json');
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noEmitOnError, true);
  assert.equal(config.compilerOptions.jsx, 'react-jsx');
  assert.equal(require('../package.json').main, 'build/main/index.cjs');
  for (const name of ['renderer.ts', 'dom.ts', 'types.d.ts', 'index.html']) {
    assert.equal(fs.existsSync(path.join(root, 'src', name)), false, name);
  }
});
test('桌面入口、sandbox preload、React 静态资源和 Pi 适配均进入构建目录', () => {
  for (const name of ['main/index.cjs', 'main/app.cjs', 'preload/index.cjs', 'host/relay.cjs', 'renderer/index.js', 'renderer/index.css']) {
    assert(fs.existsSync(path.join(root, 'build', name)), name);
  }
  assert.equal(fs.existsSync(path.join(root, 'build/pi/conversation-navigation.cjs')), false, 'removed question navigation is not rebuilt');
  assert.equal(fs.existsSync(path.join(root, 'build/pi/trace-recorder.cjs')), false, 'removed trace recorder is not rebuilt');
  const html = fs.readFileSync(path.join(root, 'build/renderer/index.html'), 'utf8');
  assert(html.includes('id="root"'));
  assert(!html.includes('node_modules'));
  assert(!html.includes('unsafe-eval'));
  assert.equal(fs.readFileSync(path.join(root, 'build/pi/pi-gui-bridge.ts'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/pi/pi-gui-bridge.ts'), 'utf8'));
});
test('未知异常可安全显示，错误码与进程超时标记仍保留', () => {
  const errors = require('../build/shared/errors.js');
  assert.equal(errors.message(new Error('failure')), 'failure');
  assert.equal(errors.message('failure'), 'failure');
  assert.equal(errors.code({ code: 'ENOENT' }), 'ENOENT');
  assert.equal(errors.code(null), undefined);
  assert.equal(errors.killed({ killed: true }), true);
  assert.equal(errors.killed({ killed: 'true' }), false);
});
