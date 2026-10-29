/** Offline MCP fixture: real stdio transport plus a stubborn detached child. Never calls a model. */
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const file = process.env.PI_LIFECYCLE_PIDS;
fs.appendFileSync(file, JSON.stringify({ pid: process.pid, role: process.argv[2] === 'worker' ? 'worker' : 'mcp' }) + '\n');
process.on('SIGTERM', () => {});
if (process.argv[2] === 'worker') setInterval(() => {}, 1000);
else {
  spawn(process.execPath, [__filename, 'worker'], { detached: true, stdio: 'ignore', env: process.env }).unref();
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const request = JSON.parse(line);
    if (request.id === undefined) return;
    const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'lifecycle-test', version: '1' } } :
      request.method === 'tools/list' ? { tools: [] } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  });
  setInterval(() => {}, 1000);
}
