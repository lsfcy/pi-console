// Raster assets are generated from checked-in, font-free SVGs; no graphics dependencies.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assets = path.resolve(__dirname, '../assets');
// Finish both captures before exiting, even while there are temporarily no windows.
app.on('window-all-closed', () => {});
async function rasterize(name) {
  const svg = fs.readFileSync(path.join(assets, name + '.svg'), 'utf8');
  const width = Number(/width="(\d+)"/.exec(svg)[1]), height = Number(/height="(\d+)"/.exec(svg)[1]);
  const window = new BrowserWindow({ width, height, useContentSize: true, frame: false, show: false, transparent: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>' + svg));
    const captured = await window.webContents.capturePage();
    const png = captured.resize({ width, height, quality: 'best' }).toPNG();
    fs.writeFileSync(path.join(assets, name + '.png'), png);
    return png;
  } finally { window.destroy(); }
}
app.whenReady().then(async () => {
  app.dock?.hide();
  const png = await rasterize('icon');
  await rasterize('menu-icons');
  if (process.platform === 'darwin') {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-console-icon-'));
    try {
      const iconset = path.join(temporary, 'Console.iconset'); fs.mkdirSync(iconset);
      const source = nativeImage.createFromBuffer(png);
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        fs.writeFileSync(path.join(iconset, 'icon_' + size + 'x' + size + (scale === 2 ? '@2x' : '') + '.png'),
          source.resize({ width: size * scale, height: size * scale, quality: 'best' }).toPNG());
      }
      execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  console.log('Rebuilt assets/icon.png, assets/icon.icns and assets/menu-icons.png');
}).then(() => app.quit(), error => { console.error(error); app.exit(1); });
