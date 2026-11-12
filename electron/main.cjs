const { app, BrowserWindow, session, shell, dialog } = require('electron');

app.enableSandbox();
const address = new URL(process.env.KAKUOKU_URL || 'http://127.0.0.1:3100');
if (address.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(address.hostname) || address.username || address.password) throw new Error('Electron принимает только локальный адрес Kakuoku.');
address.pathname = '/'; address.search = ''; address.hash = '';
const origin = address.origin;

async function window() {
  const isolated = session.fromPartition('kakuoku-memory');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith('data:') && !details.url.startsWith('blob:') && !details.url.startsWith(origin.replace('http:', 'ws:') + '/') }));
  const win = new BrowserWindow({
    width: 1240, height: 960, minWidth: 380, minHeight: 600,
    title: 'Kakuoku', backgroundColor: '#f4ecdf', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, session: isolated, navigateOnDragDrop: false, spellcheck: false },
  });
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      // Only a user's explicit link click opens the system browser; never execute custom schemes.
      if (target.protocol === 'https:' && !target.username && !target.password) shell.openExternal(target.href).catch(() => {});
    } catch { /* Reject malformed links. */ }
    return { action: 'deny' };
  });
  try { await win.loadURL(address.href); }
  catch {
    await dialog.showMessageBox(win, { type: 'error', title: 'Kakuoku', message: 'Локальный сервер Kakuoku недоступен.', detail: 'Сначала запустите контейнер или дизайн-демо на ' + origin });
    win.close();
  }
}

app.whenReady().then(window);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) window(); });
