// Electron smoke test: runs the real app against a throwaway data folder, toggles full screen,
// exports a page with ink to PDF and saves a screenshot.
// Usage: electron tools/smoke-test.js <output-dir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'smoke-out'));
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', path.join(outDir, 'userdata'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });

const circle = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 39) * Math.PI * 2;
  return [round(230 + Math.cos(a) * 190), round(45 + Math.sin(a) * 30), 0.3 + 0.6 * Math.abs(Math.sin(a))];
});
function round(n) {
  return Math.round(n * 10) / 10;
}
const page = {
  id: 'p1',
  title: 'Ink test page',
  rules: 'college',
  html: '<p>This line has a green highlighter stroke over it.</p><p>The title above is circled with a red pen.</p><p>Below is handwriting-style squiggle in blue.</p>',
  text: '',
  created: Date.now(),
  modified: Date.now(),
  ink: [
    { k: 'pen', c: '#d32f2f', w: 2, p: circle },
    { k: 'hl', c: '#69f0ae', w: 18, p: [[44, 118, 0.5], [420, 118, 0.5]] },
    { k: 'pen', c: '#1e5bd8', w: 3.5, p: Array.from({ length: 60 }, (_, i) => [round(60 + i * 8), round(240 + Math.sin(i / 2) * 18), 0.2 + (i % 10) / 12]) },
  ],
};
const data = {
  version: 1,
  notebooks: [{ id: 'n1', name: 'Test', color: '#6b3fa0', open: true, sections: [{ id: 's1', name: 'Ink', color: '#2f6fd0', pages: [page] }] }],
  trash: [],
  ui: { notebookId: 'n1', sectionId: 's1', pageId: 'p1', theme: 'light' },
};
fs.writeFileSync(path.join(app.getPath('userData'), 'notenest-data.json'), JSON.stringify(data));

require('../main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (code) => win.webContents.executeJavaScript(code);
  const state = () => js('({isFullscreen, tab: db.ui.tab, tool: Ink.getTool(), nav: db.ui.navCollapsed, pages: db.ui.pagesCollapsed, inkStrokes: curPage().ink.length})');
  const results = { start: await state() };

  win.setFullScreen(true);
  await wait(1500);
  results.fullscreen = await state();
  fs.writeFileSync(path.join(outDir, 'fullscreen.png'), (await win.webContents.capturePage()).toPNG());
  win.setFullScreen(false);
  await wait(1500);
  results.afterExit = await state();

  const widthPx = await js('preparePrint()');
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    scale: Math.min(1, ((8.27 - 0.8) * 96) / widthPx),
  });
  await js('endPrint()');
  fs.writeFileSync(path.join(outDir, 'page.pdf'), pdf);
  results.pdfBytes = pdf.length;
  results.errors = await js('window.__errors || []');

  console.log('SMOKE ' + JSON.stringify(results));
  app.quit();
});
