const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const electron = require('electron');
const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-relay-'));
const id = 'relay-test-' + process.pid;
const socketPath = path.join(socketDir, id + '.sock');
const configPath = path.join(socketDir, id + '.cfg');
const token = 'relay-token';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TERM: 'xterm-256color' };
fs.writeFileSync(configPath, JSON.stringify({ version: 1, token, socketPath, shell: '/bin/sh',
  args: ['-c', `printf '\\033[?1000;1002;1003;1004;1006h'; python3 -c "import sys; sys.stdout.write('x'*1100000)"; printf READY; IFS= read line; printf 'GOT:%s\\033[?1003l' "$line"; sleep 30`], env, cwd: root, cols: 80, rows: 24, kind: 'shell' }));
const child = spawn(electron, [path.join(root, 'build/host/relay.cjs'), configPath], {
  detached: true, stdio: 'ignore', cwd: root, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
});
child.unref();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '', data = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('relay connect timeout')); }, 5000);
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ type: 'hello', token }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        const message = JSON.parse(line);
        if (message.type === 'data' || message.type === 'replay') data += message.data;
        if (message.type === 'ready' && data.includes('READY')) { clearTimeout(timer); resolve({ socket, data: () => data }); return; }
        if (message.type === 'exit') { clearTimeout(timer); reject(new Error('relay exited early')); return; }
      }
    });
    setTimeout(() => { if (data.includes('READY')) { clearTimeout(timer); resolve({ socket, data: () => data }); } }, 1500);
  });
}
(async () => {
  let first;
  for (let i = 0; i < 50; i++) { try { first = await connect(); break; } catch { await delay(100); } }
  assert(first, 'relay accepts a client');
  assert(first.data().includes('READY'), 'relay forwards output');
  first.socket.destroy();
  await delay(150);
  let second;
  for (let i = 0; i < 50; i++) { try { second = await connect(); break; } catch { await delay(100); } }
  assert(second, 'relay accepts a client after detach');
  assert(second.data().includes('READY'), 'relay replays buffered output after detach');
  assert(!second.data().includes('\x1b[?1000;1002;1003;1004;1006h'), 'initial mouse setup fell out of the bounded ring');
  assert(second.data().includes('\x1b[?9;1000;1002;1003;1004;1006l\x1b[?1003h\x1b[?1004h\x1b[?1006h'), 'reattach restores the authoritative mouse mode after truncation');
  second.socket.write(JSON.stringify({ type: 'input', data: 'hello\n' }) + '\n');
  for (let i = 0; i < 50 && !second.data().includes('GOT:hello'); i++) await delay(100);
  assert(second.data().includes('GOT:hello'), 'relay forwards input after reattach');
  second.socket.destroy(); await delay(150);
  const third = await connect();
  assert(third.data().includes('GOT:hello'), 'latest output is replayed');
  assert(third.data().endsWith('\x1b[?9;1000;1002;1003;1004;1006l\x1b[?1004h\x1b[?1006h'), 'a later disabled mouse mode remains disabled after reattach');
  third.socket.write(JSON.stringify({ type: 'kill' }) + '\n');
  let alive = true;
  for (let i = 0; i < 50; i++) {
    try { process.kill(child.pid, 0); } catch { alive = false; break; }
    await delay(100);
  }
  assert.equal(alive, false, 'relay exits after kill');
  console.log('PASS relay detach/reattach, replay, input and kill');
  fs.rmSync(socketDir, { recursive: true, force: true });
})().catch(error => { console.error(error); try { process.kill(-child.pid, 'SIGKILL'); } catch {} fs.rmSync(socketDir, { recursive: true, force: true }); process.exit(1); });
