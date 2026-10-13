const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'audit/wardrobe-render');
app.setPath('userData', path.join(root, 'audit/wardrobe-render-profile')); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1120, height: 1200, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', e => { if (e.level === 'error') errors.push(e.message); });
    await win.loadFile(path.join(out, 'index.html'));
    const result = await win.webContents.executeJavaScript('wardrobeTest.run()');
    for (const [key, prefix] of [['greetingImages', 'greeting'], ['uploadImages', 'eating']]) {
      result[key].forEach((data, i) => fs.writeFileSync(path.join(out, `${prefix}-${i + 1}.png`), Buffer.from(data.split(',')[1], 'base64')));
      delete result[key];
    }
    assert.deepEqual(errors, []);
    await new Promise(resolve => setTimeout(resolve, 350));
    const gallery = await win.webContents.capturePage(); fs.writeFileSync(path.join(root, 'audit/wardrobe-gallery.png'), gallery.toPNG());
    if (process.argv.includes('--write-icons')) {
      const icons = await win.webContents.executeJavaScript('wardrobeTest.icons()');
      const sizes = {};
      for (const { size, png } of icons) sizes[size] = Buffer.from(png.split(',')[1], 'base64');
      for (const [file, size] of [['icon.png', 512], ['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) fs.writeFileSync(path.join(root, 'public/icons', file), sizes[size]);
      const payload = sizes[256], ico = Buffer.alloc(22);
      ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(payload.length, 14); ico.writeUInt32LE(22, 18);
      fs.writeFileSync(path.join(root, 'public/icons/icon.ico'), Buffer.concat([ico, payload]));
      fs.writeFileSync(path.join(root, 'productivity/src/assets/icon.png'), sizes[256]);
    }
    fs.writeFileSync(path.join(root, 'audit/wardrobe-render-results.json'), JSON.stringify({ ...result, errors }, null, 2));
    console.log(JSON.stringify(result)); app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
