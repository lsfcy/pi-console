const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build');

async function build() {
  fs.rmSync(output, { recursive: true, force: true });
  const tsc = require.resolve('typescript/bin/tsc');
  for (const config of ['tsconfig.json', 'tsconfig.desktop.json']) {
    execFileSync(process.execPath, [tsc, '-p', path.join(root, config)], { cwd: root, stdio: 'inherit' });
  }
  await esbuild.build({
    absWorkingDir: root, entryPoints: ['src/renderer/main.tsx'],
    outfile: 'build/renderer/index.js', bundle: true, platform: 'browser',
    format: 'iife', target: 'chrome120', jsx: 'automatic', sourcemap: true,
    define: { 'process.env.NODE_ENV': '"production"' }, minify: true, legalComments: 'linked'
  });
  fs.copyFileSync(path.join(root, 'src/renderer/index.html'), path.join(output, 'renderer/index.html'));
  fs.mkdirSync(path.join(output, 'pi'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/pi/pi-gui-bridge.ts'), path.join(output, 'pi/pi-gui-bridge.ts'));
}
build().catch(error => { console.error(error); process.exitCode = 1; });
