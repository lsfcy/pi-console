const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { RelayProcess } = require('../build/main/relay-client.cjs');

const socketPath = path.join('/tmp', 'pc-relay-client-' + process.pid + '.sock');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function startServer(handler) {
  try { fs.unlinkSync(socketPath); } catch {}
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
          handler(socket, message);
        }
      });
    });
    server.listen(socketPath, () => resolve(server));
  });
}
test('relay client 连接、输入/尺寸/退出与 detach', async t => {
  const inputs = [], sizes = [];
  let killed = 0;
  const server = await startServer((socket, message) => {
    if (message.type === 'hello') {
      socket.write(JSON.stringify({ type: 'ready', pid: 42, cols: 80, rows: 24 }) + '\n');
      socket.write(JSON.stringify({ type: 'replay', data: 'REPLAY' }) + '\n');
    } else if (message.type === 'input') inputs.push(message.data);
    else if (message.type === 'resize') sizes.push([message.cols, message.rows]);
    else if (message.type === 'kill') {
      killed++;
      socket.write(JSON.stringify({ type: 'exit', exitCode: 0 }) + '\n');
    }
  });
  t.after(() => { server.close(); try { fs.unlinkSync(socketPath); } catch {} });
  const proc = new RelayProcess({ pid: 999999, socketPath, token: 'token' });
  let data = '';
  proc.onData(value => { data += value; });
  const exited = new Promise(resolve => proc.onExit(resolve));
  for (let i = 0; i < 50 && !data.includes('REPLAY'); i++) await delay(20);
  assert(data.includes('REPLAY'), 'replay reaches the client');
  proc.write('echo hi');
  proc.resize(120, 40);
  for (let i = 0; i < 50 && (inputs.length === 0 || sizes.length === 0); i++) await delay(20);
  assert.deepEqual(inputs, ['echo hi']);
  assert.deepEqual(sizes, [[120, 40]]);
  proc.kill();
  assert.deepEqual(await exited, { exitCode: 0, signal: undefined });
  assert.equal(killed, 1);
});
test('旧 Pi relay 的截断回放先恢复全屏鼠标模式；新 relay 与完整回放不猜测', async t => {
  let replay = 'x'.repeat(1024 * 1024), snapshot = false;
  const server = await startServer((socket, message) => {
    if (message.type !== 'hello') return;
    socket.write(JSON.stringify({ type:'ready', pid:42, cols:80, rows:24, ...(snapshot ? {mouseSnapshot:true} : {}) }) + '\n');
    socket.write(JSON.stringify({ type:'replay', data:replay }) + '\n');
  });
  t.after(() => { server.close(); try { fs.unlinkSync(socketPath); } catch {} });
  async function receive() {
    const proc = new RelayProcess({ pid:999999, socketPath, token:'token', legacyPiReplay:true });
    let data = ''; proc.onData(value => { data += value; });
    for (let i=0; i<100 && !data.endsWith(replay); i++) await delay(20);
    proc.detach(); return data;
  }
  assert((await receive()).startsWith('\x1b[?1000h\x1b[?1002h'), 'legacy truncated replay receives the Pi fullscreen seed');
  snapshot = true;
  assert.equal(await receive(), replay, 'current relays send an authoritative snapshot');
  snapshot = false; replay = 'short';
  assert.equal(await receive(), replay, 'complete old replay is unchanged');
});
test('relay client detach 不触发退出，重连由新客户端负责', async t => {
  let connections = 0;
  const server = await startServer(socket => {
    connections++;
    socket.write(JSON.stringify({ type: 'ready', pid: 42, cols: 80, rows: 24 }) + '\n');
  });
  t.after(() => { server.close(); try { fs.unlinkSync(socketPath); } catch {} });
  const proc = new RelayProcess({ pid: 999999, socketPath, token: 'token' });
  let exited = false;
  proc.onExit(() => { exited = true; });
  for (let i = 0; i < 50 && connections === 0; i++) await delay(20);
  proc.detach();
  await delay(150);
  assert.equal(exited, false);
  assert.equal(connections, 1);
});
