const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'notenest-data.json');

function readData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch {
    return null;
  }
}

// Write to a temp file and rename so a crash mid-write never corrupts notes.
function writeData(json) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(tmp, file);
}

function isSafeExternal(url) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    title: 'NoteNest',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f3f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // Links in notes never navigate the app window; web links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, json) => writeData(json));
ipcMain.on('data:save-sync', (e, json) => {
  try {
    writeData(json);
    e.returnValue = true;
  } catch {
    e.returnValue = false;
  }
});

ipcMain.handle('link:open', (_e, url) => {
  if (isSafeExternal(url)) shell.openExternal(url);
});

ipcMain.handle('backup:export', async (e, json) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export backup',
    defaultPath: `NoteNest-backup-${stamp}.json`,
    filters: [{ name: 'NoteNest backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, json, 'utf8');
  return true;
});

ipcMain.handle('backup:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'NoteNest backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return null;
  return fs.readFileSync(filePaths[0], 'utf8');
});

ipcMain.handle('data:reveal', () => shell.showItemInFolder(dataFile()));

ipcMain.handle('window:fullscreen', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen());
  return win.isFullScreen();
});

// A4 at 96 dpi minus 0.4in margins each side.
const A4_PRINTABLE_PX = (8.27 - 0.8) * 96;
let lastPdfPath = null;

ipcMain.handle('page:pdf', async (e, { title, widthPx }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const safe = (title || 'Untitled page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Page';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export page as PDF',
    defaultPath: `${safe}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    // Shrink wide pages to fit, keeping the on-screen layout so ink lines up with text.
    scale: Math.max(0.1, Math.min(1, A4_PRINTABLE_PX / Math.max(1, widthPx || A4_PRINTABLE_PX))),
  });
  fs.writeFileSync(filePath, pdf);
  lastPdfPath = filePath;
  return filePath;
});

ipcMain.handle('page:pdf-open', () => {
  if (lastPdfPath) shell.openPath(lastPdfPath);
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
