'use strict';

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const COLORS = ['#6b3fa0', '#2f6fd0', '#1f9d6b', '#e08a1e', '#d6455d', '#3aa6b9', '#8a6d3b', '#7a7f8c'];
const TRASH_DAYS = 60;
// Browser preview (no Electron preload): keep data in localStorage so the UI still works.
const store = window.api || {
  load: async () => JSON.parse(localStorage.getItem('notenest') || 'null'),
  save: async (json) => localStorage.setItem('notenest', json),
  saveSync: (json) => localStorage.setItem('notenest', json),
  openLink: async (url) => window.open(url, '_blank'),
  exportBackup: async () => false,
  importBackup: async () => null,
  revealData: async () => {},
  setFullscreen: async (on) => (on ? document.documentElement.requestFullscreen() : document.exitFullscreen?.()),
  onFullscreen: (cb) => document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement)),
  exportPdf: async () => {
    window.print();
    return null;
  },
  openLastPdf: async () => {},
};

const DEFAULT_INK_TOOLS = {
  pen1: { kind: 'pen', name: 'Pen 1', color: '#1f1d24', width: 2 },
  pen2: { kind: 'pen', name: 'Pen 2', color: '#1e5bd8', width: 2 },
  pen3: { kind: 'pen', name: 'Pen 3', color: '#d32f2f', width: 2 },
  pen4: { kind: 'pen', name: 'Pen 4', color: '#1f9d6b', width: 3.5 },
  eraser: { kind: 'eraser', name: 'Eraser', width: 14 },
  hl1: { kind: 'highlighter', name: 'Highlighter 1', color: '#ffeb3b', width: 18 },
  hl2: { kind: 'highlighter', name: 'Highlighter 2', color: '#69f0ae', width: 18 },
};
const PEN_COLORS = ['#1f1d24', '#1e5bd8', '#d32f2f', '#1f9d6b', '#7b3fbf', '#ef6c00', '#795548', '#78909c'];
const HL_COLORS = ['#ffeb3b', '#69f0ae', '#4dd0e1', '#ff80ab', '#ffab40', '#b388ff'];
const TOOL_SIZES = { pen: [1, 2, 3.5, 5, 8], highlighter: [10, 14, 18, 24, 32], eraser: [8, 14, 24, 40] };

const els = {
  notebooks: $('#notebooks'),
  pages: $('#pages'),
  pagesTitle: $('#pages-title'),
  editor: $('#editor'),
  title: $('#page-title'),
  meta: $('#page-meta'),
  sheet: $('#sheet'),
  empty: $('#empty-state'),
  toolbar: $('#toolbar'),
  status: $('#status'),
  search: $('#search'),
  results: $('#search-results'),
  menu: $('#menu'),
  toast: $('#toast'),
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return withTime ? `${date}   ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date;
}

function shortDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString();
}

const htmlToText = (html) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
};

// ---------- data ----------
let db;
let saveTimer = null;
let dirty = false;
let loadedPageId = null;
let savedRange = null;

const WELCOME_HTML = `
<p>NoteNest keeps your notes in <b>notebooks</b>, split into <b>sections</b>, each holding <b>pages</b>. Everything saves automatically.</p>
<h2>Try it out</h2>
<ul class="todo">
  <li data-checked="true">Open NoteNest</li>
  <li data-checked="false">Create a notebook with the <b>+</b> next to "Notebooks"</li>
  <li data-checked="false">Add a page with <b>Ctrl+N</b></li>
  <li data-checked="false">Click a box to tick off a to-do (or press <b>Ctrl+1</b> to make one)</li>
</ul>
<h2>Handy shortcuts</h2>
<table>
  <tbody>
    <tr><td><b>Ctrl+N</b></td><td>New page</td></tr>
    <tr><td><b>Ctrl+E</b></td><td>Search every note</td></tr>
    <tr><td><b>Ctrl+1</b></td><td>To-do checkbox</td></tr>
    <tr><td><b>Ctrl+Alt+H</b></td><td>Highlight</td></tr>
    <tr><td><b>Ctrl+K</b></td><td>Insert link (Ctrl+click opens it)</td></tr>
    <tr><td><b>Ctrl+Alt+1 / 2 / 3</b></td><td>Headings</td></tr>
    <tr><td><b>Alt+Shift+F</b></td><td>Insert date and time</td></tr>
    <tr><td><b>Ctrl+PgUp / PgDn</b></td><td>Previous / next page</td></tr>
  </tbody>
</table>
<p>Right-click notebooks, sections and pages for more options. Drag pages to reorder them or drop them on another section.</p>`;

function newPage(title = '', html = '') {
  const now = Date.now();
  return { id: uid(), title, html, text: htmlToText(html), created: now, modified: now };
}

function defaultData() {
  return {
    version: 1,
    notebooks: [
      {
        id: uid(),
        name: 'My Notebook',
        color: COLORS[0],
        open: true,
        sections: [
          { id: uid(), name: 'Quick Notes', color: COLORS[1], pages: [newPage('Welcome to NoteNest', WELCOME_HTML)] },
          { id: uid(), name: 'Ideas', color: COLORS[2], pages: [] },
        ],
      },
    ],
    trash: [],
    ui: { notebookId: null, sectionId: null, pageId: null, theme: 'light', rules: false },
  };
}

function defaultUi() {
  return { theme: 'light', rules: false, tab: 'home', navCollapsed: false, pagesCollapsed: false };
}

function isValidData(d) {
  return d && Array.isArray(d.notebooks) && d.notebooks.every((n) => n && Array.isArray(n.sections));
}

function normalize(d) {
  d.trash = Array.isArray(d.trash) ? d.trash : [];
  const legacyRules = d.ui?.rules === true;
  d.ui = Object.assign(defaultUi(), d.ui || {});
  delete d.ui.rules;
  const saved = d.ui.inkTools || {};
  d.ui.inkTools = {};
  for (const [id, def] of Object.entries(DEFAULT_INK_TOOLS)) {
    d.ui.inkTools[id] = { ...def, ...(saved[id] || {}), kind: def.kind, name: def.name };
  }
  const cutoff = Date.now() - TRASH_DAYS * 864e5;
  d.trash = d.trash.filter((t) => t.deletedAt > cutoff);
  for (const nb of d.notebooks) {
    nb.id ||= uid();
    nb.color ||= COLORS[0];
    for (const s of nb.sections) {
      s.id ||= uid();
      s.color ||= COLORS[1];
      s.pages = Array.isArray(s.pages) ? s.pages : [];
      for (const p of s.pages) {
        p.id ||= uid();
        p.html ||= '';
        p.text ??= htmlToText(p.html);
        p.ink = Array.isArray(p.ink) ? p.ink : [];
        p.rules ??= legacyRules ? 'narrow' : ''; // rule lines used to be one global switch
      }
    }
  }
  return d;
}

// Full screen collapses panes temporarily; persist the layout from before it.
function serialize(indent) {
  const data = beforeFullscreen
    ? { ...db, ui: { ...db.ui, navCollapsed: beforeFullscreen.nav, pagesCollapsed: beforeFullscreen.pages, tab: beforeFullscreen.tab } }
    : db;
  return JSON.stringify(data, null, indent);
}

function scheduleSave() {
  dirty = true;
  setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  try {
    await store.save(serialize());
    setStatus('Saved');
  } catch (err) {
    dirty = true;
    setStatus('Could not save: ' + err.message);
  }
}

window.addEventListener('beforeunload', () => {
  if (dirty) store.saveSync(serialize());
});

// ---------- selection ----------
const findNotebook = (id) => db.notebooks.find((n) => n.id === id);
const curNotebook = () => findNotebook(db.ui.notebookId);
const curSection = () => curNotebook()?.sections.find((s) => s.id === db.ui.sectionId);
const curPage = () => curSection()?.pages.find((p) => p.id === db.ui.pageId);

function locatePage(pageId) {
  for (const nb of db.notebooks)
    for (const sec of nb.sections) {
      const idx = sec.pages.findIndex((p) => p.id === pageId);
      if (idx >= 0) return { nb, sec, page: sec.pages[idx], idx };
    }
  return null;
}

function locateSection(sectionId) {
  for (const nb of db.notebooks) {
    const sec = nb.sections.find((s) => s.id === sectionId);
    if (sec) return { nb, sec };
  }
  return null;
}

function ensureSelection() {
  let nb = curNotebook() || db.notebooks[0];
  db.ui.notebookId = nb?.id ?? null;
  let sec = nb?.sections.find((s) => s.id === db.ui.sectionId) || nb?.sections[0];
  db.ui.sectionId = sec?.id ?? null;
  const page = sec?.pages.find((p) => p.id === db.ui.pageId) || sec?.pages.find((p) => p.id === sec.lastPageId) || sec?.pages[0];
  db.ui.pageId = page?.id ?? null;
}

function selectSection(nbId, secId) {
  db.ui.notebookId = nbId;
  db.ui.sectionId = secId;
  db.ui.pageId = null;
  ensureSelection();
  renderAll();
  scheduleSave();
}

function selectPage(pageId) {
  const loc = locatePage(pageId);
  if (!loc) return;
  db.ui.notebookId = loc.nb.id;
  db.ui.sectionId = loc.sec.id;
  db.ui.pageId = pageId;
  loc.sec.lastPageId = pageId;
  loc.nb.open = true;
  renderAll();
  scheduleSave();
}

// ---------- rendering ----------
function renderAll() {
  ensureSelection();
  renderNav();
  renderPages();
  renderEditor();
}

function renderNav() {
  els.notebooks.innerHTML = '';
  for (const nb of db.notebooks) {
    const row = document.createElement('div');
    row.className = 'nb';
    row.innerHTML = `<span class="caret">${nb.open ? '▾' : '▸'}</span><span class="nb-icon" style="background:${nb.color}"></span><span class="name">${escapeHtml(nb.name)}</span>`;
    row.title = nb.name;
    row.onclick = () => {
      nb.open = !nb.open;
      if (nb.open && db.ui.notebookId !== nb.id && nb.sections[0]) return selectSection(nb.id, nb.sections[0].id);
      renderNav();
      scheduleSave();
    };
    row.oncontextmenu = (e) => notebookMenu(e, nb);
    els.notebooks.appendChild(row);
    if (!nb.open) continue;

    for (const sec of nb.sections) {
      const s = document.createElement('div');
      s.className = 'sec' + (sec.id === db.ui.sectionId ? ' active' : '');
      s.innerHTML = `<span class="dot" style="background:${sec.color}"></span><span class="name">${escapeHtml(sec.name)}</span><span class="count">${sec.pages.length || ''}</span>`;
      s.title = sec.name;
      s.onclick = () => selectSection(nb.id, sec.id);
      s.oncontextmenu = (e) => sectionMenu(e, nb, sec);
      s.ondragover = (e) => {
        if (!dragPageId) return;
        e.preventDefault();
        s.classList.add('drop-target');
      };
      s.ondragleave = () => s.classList.remove('drop-target');
      s.ondrop = (e) => {
        e.preventDefault();
        s.classList.remove('drop-target');
        if (dragPageId) movePage(dragPageId, sec.id);
      };
      els.notebooks.appendChild(s);
    }
    if (!nb.sections.length) {
      const hint = document.createElement('div');
      hint.className = 'empty-list';
      hint.style.paddingLeft = '30px';
      hint.textContent = 'No sections yet';
      els.notebooks.appendChild(hint);
    }
  }
}

let dragPageId = null;

function renderPages() {
  const sec = curSection();
  els.pagesTitle.textContent = sec ? sec.name : 'Pages';
  els.pages.innerHTML = '';
  if (!sec) {
    els.pages.innerHTML = '<div class="empty-list">Create a section to add pages.</div>';
    return;
  }
  if (!sec.pages.length) {
    els.pages.innerHTML = '<div class="empty-list">No pages yet. Press Ctrl+N or click + to add one.</div>';
    return;
  }
  for (const page of sec.pages) {
    const item = document.createElement('div');
    item.className = 'page-item' + (page.id === db.ui.pageId ? ' active' : '');
    item.draggable = true;
    item.dataset.id = page.id;
    const snippet = (page.text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    item.innerHTML = `<div class="t">${escapeHtml(page.title || 'Untitled page')}</div><div class="d">${shortDate(page.modified)}${snippet ? ' · ' + escapeHtml(snippet) : ''}</div>`;
    item.onclick = () => selectPage(page.id);
    item.oncontextmenu = (e) => pageMenu(e, page);
    item.ondragstart = (e) => {
      dragPageId = page.id;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    };
    item.ondragend = () => {
      dragPageId = null;
      document.querySelectorAll('.dragging,.drop-before,.drop-target').forEach((n) => n.classList.remove('dragging', 'drop-before', 'drop-target'));
    };
    item.ondragover = (e) => {
      if (!dragPageId || dragPageId === page.id) return;
      e.preventDefault();
      item.classList.add('drop-before');
    };
    item.ondragleave = () => item.classList.remove('drop-before');
    item.ondrop = (e) => {
      e.preventDefault();
      if (dragPageId) movePage(dragPageId, sec.id, page.id);
    };
    els.pages.appendChild(item);
  }
}

function renderEditor() {
  const page = curPage();
  if (!page) {
    els.sheet.hidden = true;
    els.empty.hidden = false;
    els.toolbar.style.visibility = 'hidden';
    loadedPageId = null;
    Ink.setPage(null);
    setStatus(dirty ? 'Saving…' : 'Saved');
    return;
  }
  els.sheet.hidden = false;
  els.empty.hidden = true;
  els.toolbar.style.visibility = '';
  if (loadedPageId !== page.id) {
    loadedPageId = page.id;
    els.title.value = page.title;
    els.editor.innerHTML = page.html;
    $('#editor-scroll').scrollTop = 0;
    fitSheetToInk(page);
    Ink.setPage(page);
  }
  els.meta.textContent = fmtDate(page.created);
  applyRules(page);
  updateWordCount();
}

// Rule lines are per page, like paper. Gaps are in px.
const RULE_STYLES = [
  { id: '', label: 'No lines' },
  { id: 'narrow', label: 'Narrow ruled', kind: 'lines', gap: 24 },
  { id: 'college', label: 'College ruled', kind: 'lines', gap: 32 },
  { id: 'wide', label: 'Wide ruled', kind: 'lines', gap: 40 },
  { id: 'xwide', label: 'Extra wide ruled', kind: 'lines', gap: 52 },
  { id: 'grid-s', label: 'Small grid', kind: 'grid', gap: 20 },
  { id: 'grid-m', label: 'Medium grid', kind: 'grid', gap: 32 },
  { id: 'grid-l', label: 'Large grid', kind: 'grid', gap: 48 },
];

function applyRules(page) {
  const style = RULE_STYLES.find((r) => r.id === (page?.rules || '')) || RULE_STYLES[0];
  els.sheet.dataset.rules = style.kind || '';
  if (style.gap) els.sheet.style.setProperty('--rule-gap', style.gap + 'px');
  els.sheet.style.setProperty('--rules-top', els.editor.offsetTop + 'px');
  $('#tb-rules').classList.toggle('on', !!style.kind);
}

function rulesMenu(e) {
  const page = curPage();
  if (!page) return;
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, RULE_STYLES.map((s) => ({
    label: (s.id === (page.rules || '') ? '✓ ' : '  ') + s.label + (s.gap ? `  (${s.gap}px)` : ''),
    action: () => {
      page.rules = s.id;
      db.ui.defaultRules = s.id; // new pages use the last choice
      applyRules(page);
      scheduleSave();
    },
  })));
}

function setStatus(text) {
  const page = curPage();
  const words = page ? (page.text.match(/\S+/g) || []).length : 0;
  els.status.textContent = page ? `${words} word${words === 1 ? '' : 's'} · ${text}` : text;
}

const updateWordCount = () => setStatus(dirty ? 'Saving…' : 'Saved');

// ---------- editing ----------
let pageListTimer = null;

function onEditorChange() {
  const page = curPage();
  if (!page) return;
  page.html = els.editor.innerHTML;
  page.text = els.editor.innerText;
  page.modified = Date.now();
  scheduleSave();
  clearTimeout(pageListTimer);
  pageListTimer = setTimeout(renderPages, 300);
}

els.editor.addEventListener('input', (e) => {
  // A new line inside a to-do list starts unchecked.
  if (e.inputType === 'insertParagraph') {
    const li = closestInEditor(caretNode(), 'li');
    if (li && li.parentElement.classList.contains('todo')) li.dataset.checked = 'false';
  }
  onEditorChange();
});

els.title.addEventListener('input', () => {
  const page = curPage();
  if (!page) return;
  page.title = els.title.value;
  page.modified = Date.now();
  scheduleSave();
  renderPages();
});

els.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    els.editor.focus();
  }
});

// Chromium sometimes reports the caret as (container element, child index), e.g. right
// after creating a list on an empty page; resolve that to the node actually holding it.
function caretNode() {
  const sel = getSelection();
  let node = sel.anchorNode;
  if (node && node.nodeType === 1 && node.childNodes.length) {
    node = node.childNodes[Math.min(sel.anchorOffset, node.childNodes.length - 1)];
    while (node.nodeType === 1 && node.firstChild && !node.matches('li')) node = node.firstChild;
  }
  return node;
}

function closestInEditor(node, selector) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el !== els.editor) {
    if (el.matches(selector)) return el;
    el = el.parentElement;
  }
  return null;
}

// Keep track of the caret so toolbar pickers and dialogs can restore it.
document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (sel.rangeCount && els.editor.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
    updateToolbarState();
  }
});

function restoreSelection() {
  els.editor.focus();
  if (savedRange && els.editor.contains(savedRange.startContainer)) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
}

function exec(cmd, value = null) {
  restoreSelection();
  document.execCommand(cmd, false, value);
  onEditorChange();
  updateToolbarState();
}

function updateToolbarState() {
  for (const btn of els.toolbar.querySelectorAll('[data-cmd]')) {
    const cmd = btn.dataset.cmd;
    if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) {
      btn.classList.toggle('on', document.queryCommandState(cmd));
    }
  }
  const block = closestInEditor(caretNode(), 'h1,h2,h3,blockquote,pre,p');
  $('#tb-block').value = block ? block.tagName.toLowerCase() : 'p';
}

for (const btn of els.toolbar.querySelectorAll('button')) {
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep editor selection
}
for (const btn of els.toolbar.querySelectorAll('[data-cmd]')) {
  btn.addEventListener('click', () => exec(btn.dataset.cmd));
}

$('#tb-block').addEventListener('change', (e) => exec('formatBlock', `<${e.target.value}>`));

const hlInput = $('#tb-highlight');
const fcInput = $('#tb-color');
const applyHighlight = () => exec('hiliteColor', hlInput.value);
const applyFontColor = () => exec('foreColor', fcInput.value);
$('#tb-hl-apply').onclick = applyHighlight;
$('#tb-fc-apply').onclick = applyFontColor;
hlInput.addEventListener('change', () => {
  $('#hl-swatch').style.background = hlInput.value;
  applyHighlight();
});
fcInput.addEventListener('change', () => {
  $('#fc-swatch').style.color = fcInput.value;
  applyFontColor();
});

function toggleTodo() {
  restoreSelection();
  const li = closestInEditor(caretNode(), 'li');
  const list = li?.parentElement;
  if (list?.classList.contains('todo')) {
    document.execCommand('insertUnorderedList'); // turn the to-do back into plain text
  } else {
    if (list?.tagName !== 'UL') document.execCommand('insertUnorderedList');
    const item = closestInEditor(caretNode(), 'li');
    if (item) {
      item.parentElement.classList.add('todo');
      for (const child of item.parentElement.children) child.dataset.checked ??= 'false';
    }
  }
  onEditorChange();
}
$('#tb-todo').onclick = toggleTodo;

// Clicking the box of a to-do item ticks it.
els.editor.addEventListener('mousedown', (e) => {
  const li = e.target.closest?.('ul.todo > li');
  if (!li || !els.editor.contains(li)) return;
  if (e.clientX - li.getBoundingClientRect().left < 22) {
    e.preventDefault();
    li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
    onEditorChange();
  }
});

els.editor.addEventListener('click', (e) => {
  const a = e.target.closest?.('a');
  if (a && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    store.openLink(a.href);
  }
});
els.editor.addEventListener('mouseover', (e) => {
  const a = e.target.closest?.('a');
  if (a && !a.title) a.title = `${a.href}\nCtrl+click to open`;
});

async function insertLink() {
  restoreSelection();
  const existing = closestInEditor(caretNode(), 'a');
  const selected = getSelection().toString();
  const range = savedRange;
  const url = await ask('Insert link', existing?.getAttribute('href') || (/^\S+\.\S+$/.test(selected) ? selected : ''), 'https://example.com');
  if (url === null) return;
  savedRange = range;
  restoreSelection();
  if (!url.trim()) {
    if (existing) exec('unlink');
    return;
  }
  const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
  if (getSelection().isCollapsed && !existing) {
    exec('insertHTML', `<a href="${escapeHtml(href)}">${escapeHtml(url.trim())}</a>&nbsp;`);
  } else {
    exec('createLink', href);
  }
}
$('#tb-link').onclick = insertLink;

function insertImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => exec('insertImage', reader.result);
  reader.readAsDataURL(file);
}
$('#tb-image').onclick = () => $('#image-input').click();
$('#image-input').addEventListener('change', (e) => {
  insertImageFile(e.target.files[0]);
  e.target.value = '';
});

els.editor.addEventListener('paste', (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    insertImageFile(file);
  }
});
els.editor.addEventListener('drop', (e) => {
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    insertImageFile(file);
  }
});

$('#tb-table').onclick = async () => {
  const range = savedRange;
  const ok = await openModal('Insert table', (body) => {
    body.innerHTML = `<label>Rows</label><input type="text" id="tbl-rows" value="3"><label>Columns</label><input type="text" id="tbl-cols" value="3">`;
  });
  if (!ok) return;
  const rows = Math.min(50, Math.max(1, parseInt($('#tbl-rows').value, 10) || 3));
  const cols = Math.min(12, Math.max(1, parseInt($('#tbl-cols').value, 10) || 3));
  const row = '<tr>' + '<td><br></td>'.repeat(cols) + '</tr>';
  savedRange = range;
  exec('insertHTML', `<table><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
};

$('#tb-hr').onclick = () => exec('insertHorizontalRule');
const insertDateTime = () => exec('insertText', new Date().toLocaleString());
$('#tb-date').onclick = insertDateTime;
$('#tb-rules').onclick = rulesMenu;
$('#tb-print').onclick = () => window.print();

els.editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (closestInEditor(caretNode(), 'li')) exec(e.shiftKey ? 'outdent' : 'indent');
    else if (!e.shiftKey) exec('insertHTML', '&emsp;&emsp;');
  }
});

// ---------- pen / tablet drawing ----------
function toolIcon(t) {
  if (t.kind === 'eraser') {
    return `<svg viewBox="0 0 26 32"><path d="M4 21 14 7l8 5.5L12 27H7.5z" fill="#f48fb1" stroke="rgba(0,0,0,.35)"/><path d="M9.3 14.5l8 5.5" stroke="rgba(0,0,0,.25)"/><rect x="3" y="29" width="${Math.min(20, t.width / 2)}" height="2" rx="1" fill="var(--muted)"/></svg>`;
  }
  if (t.kind === 'highlighter') {
    return `<svg viewBox="0 0 26 32"><path d="M8 2h10v14l-2.5 3v5h-5v-5L8 16z" fill="${t.color}" stroke="rgba(0,0,0,.3)"/><rect x="3" y="27" width="20" height="${Math.min(4, 1 + t.width / 8)}" rx="1" fill="${t.color}" opacity=".7"/></svg>`;
  }
  return `<svg viewBox="0 0 26 32"><path d="M10 2h6v15l-3 7-3-7z" fill="${t.color}" stroke="rgba(0,0,0,.3)"/><path d="M10 17h6" stroke="rgba(255,255,255,.6)"/><rect x="3" y="28" width="20" height="${Math.min(4, 0.6 + t.width / 2)}" rx="1" fill="${t.color}"/></svg>`;
}

function renderTools() {
  for (const btn of document.querySelectorAll('#draw-panel [data-tool]')) {
    const id = btn.dataset.tool;
    if (id) btn.innerHTML = toolIcon(db.ui.inkTools[id]);
    btn.classList.toggle('on', (Ink.getTool() || '') === id);
  }
}

let lastDrawTool = 'pen1';
function setDrawTool(id) {
  Ink.setTool(id || null);
  if (id && id !== 'space' && id !== 'eraser') lastDrawTool = id;
  if (id) {
    getSelection().removeAllRanges();
    els.editor.blur();
  }
  renderTools();
  $('#tb-space').classList.toggle('on', id === 'space');
  $('#mode-label').textContent = !id
    ? ''
    : id === 'space'
      ? 'Drag down on the page to insert space, up to remove it'
      : `${db.ui.inkTools[id].name} · Esc to type · Ctrl+Z to undo`;
}

for (const btn of document.querySelectorAll('#draw-panel [data-tool]')) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tool;
    if (id && Ink.getTool() === id) showToolSettings(id, btn);
    else setDrawTool(id);
  });
}

function showToolSettings(id, anchor) {
  const t = db.ui.inkTools[id];
  const colors = t.kind === 'pen' ? PEN_COLORS : t.kind === 'highlighter' ? HL_COLORS : null;
  const sizes = TOOL_SIZES[t.kind];
  const update = () => {
    renderTools();
    Ink.redraw();
    scheduleSave();
  };
  els.menu.innerHTML = '';
  const pop = document.createElement('div');
  pop.className = 'tool-pop';
  pop.innerHTML = `<label>${escapeHtml(t.name)} · thickness</label><div class="sizes"></div>`;
  const sizeRow = pop.querySelector('.sizes');
  for (const s of sizes) {
    const b = document.createElement('button');
    const dot = Math.max(3, Math.min(22, t.kind === 'pen' ? s * 2 : s * 0.7));
    b.innerHTML = `<i style="width:${dot}px;height:${dot}px;${colors ? 'background:' + t.color : ''}"></i>`;
    b.title = `${s}px`;
    b.classList.toggle('on', s === t.width);
    b.onclick = () => {
      t.width = s;
      for (const x of sizeRow.children) x.classList.toggle('on', x === b);
      update();
    };
    sizeRow.appendChild(b);
  }
  if (colors) {
    pop.insertAdjacentHTML('beforeend', '<label>Color</label><div class="swatches"></div>');
    const row = pop.querySelector('.swatches');
    for (const c of colors) {
      const sw = document.createElement('span');
      sw.style.background = c;
      sw.classList.toggle('on', c === t.color);
      sw.onclick = () => {
        t.color = c;
        hideMenu();
        update();
      };
      row.appendChild(sw);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.value = t.color;
    custom.title = 'Custom color';
    custom.onchange = () => {
      t.color = custom.value;
      update();
    };
    pop.appendChild(custom);
  }
  els.menu.appendChild(pop);
  els.menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  els.menu.style.left = Math.min(r.left, innerWidth - els.menu.offsetWidth - 8) + 'px';
  els.menu.style.top = r.bottom + 4 + 'px';
}

// Grow the sheet so all ink fits (plus room to keep writing below it). Ink drawn on a wide
// screen keeps the page at least that wide on smaller ones, scrolling sideways if needed.
function fitSheetToInk(page = curPage()) {
  let bottom = 0;
  let right = 0;
  for (const s of page?.ink || []) {
    for (const p of s.p) {
      bottom = Math.max(bottom, p[1] + s.w);
      right = Math.max(right, p[0] + s.w);
    }
  }
  growSheet(bottom ? bottom + 200 : 0);
  els.sheet.style.minWidth = right ? `max(calc(var(--text-w) + 88px), ${Math.ceil(right + 40)}px)` : '';
}

function growSheet(px) {
  els.sheet.style.minHeight = px ? `max(calc(100% - 20px), ${Math.ceil(px)}px)` : '';
}

function onInkChange() {
  const page = curPage();
  if (!page) return;
  page.modified = Date.now();
  scheduleSave();
  clearTimeout(pageListTimer);
  pageListTimer = setTimeout(renderPages, 300);
}

// Insert space: push ink and text below y0 down by dy (or pull it up when dy < 0).
function insertSpace(y0, dy) {
  Ink.shiftBelow(y0, dy);
  const clientY = els.sheet.getBoundingClientRect().top + y0;
  const blocks = [...els.editor.children];
  if (dy > 0) {
    const target = blocks.find((b) => b.getBoundingClientRect().bottom > clientY);
    if (target) {
      const prev = target.previousElementSibling;
      if (prev?.classList.contains('nn-space') && prev.getBoundingClientRect().bottom >= clientY - 4) {
        prev.style.height = parseFloat(prev.style.height) + dy + 'px';
      } else {
        const spacer = document.createElement('div');
        spacer.className = 'nn-space';
        spacer.contentEditable = 'false';
        spacer.style.height = dy + 'px';
        target.before(spacer);
      }
    }
  } else {
    let remaining = -dy;
    const spacers = blocks.filter((b) => {
      if (!b.classList.contains('nn-space')) return false;
      const r = b.getBoundingClientRect();
      return r.bottom > clientY + dy - 4 && r.top < clientY + 4;
    });
    for (const s of spacers.reverse()) {
      if (remaining <= 0) break;
      const h = parseFloat(s.style.height) || 0;
      const take = Math.min(h, remaining);
      remaining -= take;
      if (h - take < 4) s.remove();
      else s.style.height = h - take + 'px';
    }
  }
  onEditorChange();
  fitSheetToInk();
  setDrawTool(null);
}

$('#tb-space').onclick = () => setDrawTool(Ink.getTool() === 'space' ? null : 'space');

// ---------- ribbon tabs, panes, full screen ----------
function applyTab() {
  for (const t of document.querySelectorAll('.tabs .tab')) t.classList.toggle('active', t.dataset.tab === db.ui.tab);
  for (const p of document.querySelectorAll('.toolbar .panel')) p.classList.toggle('active', p.dataset.panel === db.ui.tab);
}

function setTab(tab) {
  db.ui.tab = tab;
  applyTab();
  if (tab === 'draw' && !Ink.getTool()) setDrawTool(lastDrawTool);
  if (tab !== 'draw' && Ink.getTool() && Ink.getTool() !== 'space') setDrawTool(null);
  scheduleSave();
}

for (const t of document.querySelectorAll('.tabs .tab')) t.addEventListener('click', () => setTab(t.dataset.tab));

function applyPanes() {
  const layout = $('#layout');
  layout.classList.toggle('nav-collapsed', !!db.ui.navCollapsed);
  layout.classList.toggle('pages-collapsed', !!db.ui.pagesCollapsed);
  $('#tb-nav').classList.toggle('on', !db.ui.navCollapsed);
  $('#tb-pages').classList.toggle('on', !db.ui.pagesCollapsed);
  $('#expand-panes').hidden = !(db.ui.navCollapsed && db.ui.pagesCollapsed);
  // Ink canvases follow the sheet size once the column animation settles.
  setTimeout(() => Ink.resize(), 220);
}

function togglePane(which, collapsed) {
  const key = which === 'nav' ? 'navCollapsed' : 'pagesCollapsed';
  db.ui[key] = collapsed ?? !db.ui[key];
  applyPanes();
  scheduleSave();
}

$('#btn-nav').onclick = () => togglePane('nav');
$('#collapse-nav').onclick = () => togglePane('nav', true);
$('#collapse-pages').onclick = () => togglePane('pages', true);
$('#tb-nav').onclick = () => togglePane('nav');
$('#tb-pages').onclick = () => togglePane('pages');
$('#expand-panes').onclick = () => {
  db.ui.navCollapsed = false;
  db.ui.pagesCollapsed = false;
  applyPanes();
  scheduleSave();
};

let isFullscreen = false;
let beforeFullscreen = null;

const toggleFullscreen = () => store.setFullscreen(!isFullscreen);
$('#btn-fullscreen').onclick = toggleFullscreen;
$('#tb-fullscreen').onclick = toggleFullscreen;

// Full screen hides both panes and brings up the pen toolbar; leaving restores the layout.
function onFullscreenChanged(on) {
  if (on === isFullscreen) return;
  isFullscreen = on;
  document.body.classList.toggle('fullscreen', on);
  if (on) {
    beforeFullscreen = { nav: db.ui.navCollapsed, pages: db.ui.pagesCollapsed, tab: db.ui.tab };
    db.ui.navCollapsed = true;
    db.ui.pagesCollapsed = true;
    setTab('draw');
  } else if (beforeFullscreen) {
    db.ui.navCollapsed = beforeFullscreen.nav;
    db.ui.pagesCollapsed = beforeFullscreen.pages;
    setTab(beforeFullscreen.tab);
    beforeFullscreen = null;
  }
  applyPanes();
  for (const b of [$('#btn-fullscreen'), $('#tb-fullscreen')]) b.title = on ? 'Exit full screen (F11 or Esc)' : 'Full screen (F11)';
  $('#tb-fullscreen').textContent = on ? '⛶ Exit full screen' : '⛶ Full screen';
  $('#tb-fullscreen').classList.toggle('on', on);
}
store.onFullscreen(onFullscreenChanged);

// ---------- PDF / print ----------
// Pin the sheet width and height so ink lines up with the text in the printed page.
// Prints only as wide as the text column or the ink, whichever reaches further.
function preparePrint() {
  const editorBottom = els.editor.offsetTop + els.editor.offsetHeight;
  const inkBottom = Ink.contentHeight();
  const width = Math.ceil(Math.max(els.editor.offsetLeft + els.editor.offsetWidth + 44, Ink.contentWidth() + 40));
  els.sheet.style.setProperty('--print-width', width + 'px');
  els.sheet.style.setProperty('--print-height', Math.ceil(Math.max(editorBottom, inkBottom) + 30) + 'px');
  if (db.ui.theme === 'dark') Ink.setDark(false);
  return width;
}

function endPrint() {
  Ink.setDark(db.ui.theme === 'dark');
}

window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', endPrint);

async function exportPdf() {
  const page = curPage();
  if (!page) return toast('Open a page to export it.');
  await flushSave();
  const width = preparePrint();
  try {
    const path = await store.exportPdf(page.title || 'Untitled page', width);
    if (path) toast('Page exported as PDF.', 'Open', () => store.openLastPdf());
  } catch (err) {
    toast('Could not export PDF: ' + err.message);
  } finally {
    endPrint();
  }
}
$('#tb-pdf').onclick = exportPdf;

// ---------- page / section / notebook actions ----------
function addPage() {
  const sec = curSection();
  if (!sec) return toast('Create a section first.');
  const page = newPage();
  page.rules = db.ui.defaultRules || '';
  sec.pages.push(page);
  selectPage(page.id);
  els.title.focus();
}

async function addSection() {
  let nb = curNotebook();
  if (!nb) {
    await addNotebook();
    return;
  }
  const name = await ask('New section', `New Section ${nb.sections.length + 1}`);
  if (!name) return;
  const sec = { id: uid(), name, color: COLORS[(nb.sections.length + 1) % COLORS.length], pages: [] };
  nb.sections.push(sec);
  nb.open = true;
  selectSection(nb.id, sec.id);
}

async function addNotebook() {
  const name = await ask('New notebook', 'New Notebook');
  if (!name) return;
  const nb = {
    id: uid(),
    name,
    color: COLORS[db.notebooks.length % COLORS.length],
    open: true,
    sections: [{ id: uid(), name: 'New Section 1', color: COLORS[1], pages: [newPage()] }],
  };
  db.notebooks.push(nb);
  selectSection(nb.id, nb.sections[0].id);
}

function trashPages(nb, sec, pages) {
  const now = Date.now();
  for (const page of pages) {
    db.trash.unshift({ page, notebookId: nb.id, notebookName: nb.name, sectionId: sec.id, sectionName: sec.name, deletedAt: now });
  }
}

function deletePage(pageId) {
  const loc = locatePage(pageId);
  if (!loc) return;
  loc.sec.pages.splice(loc.idx, 1);
  trashPages(loc.nb, loc.sec, [loc.page]);
  if (db.ui.pageId === pageId) {
    const next = loc.sec.pages[Math.min(loc.idx, loc.sec.pages.length - 1)];
    db.ui.pageId = next?.id ?? null;
  }
  renderAll();
  scheduleSave();
  toast(`"${loc.page.title || 'Untitled page'}" moved to the Recycle bin.`, 'Undo', () => restoreFromTrash(loc.page.id, loc.idx));
}

function restoreFromTrash(pageId, index) {
  const i = db.trash.findIndex((t) => t.page.id === pageId);
  if (i < 0) return;
  const [entry] = db.trash.splice(i, 1);
  let target = locateSection(entry.sectionId);
  if (!target) {
    // Original section is gone: recreate it in the original notebook, or the first notebook.
    let nb = findNotebook(entry.notebookId) || db.notebooks[0];
    if (!nb) {
      nb = { id: uid(), name: entry.notebookName || 'Restored', color: COLORS[0], open: true, sections: [] };
      db.notebooks.push(nb);
    }
    const sec = { id: entry.sectionId, name: entry.sectionName || 'Restored', color: COLORS[5], pages: [] };
    nb.sections.push(sec);
    target = { nb, sec };
  }
  const at = index ?? target.sec.pages.length;
  target.sec.pages.splice(Math.min(at, target.sec.pages.length), 0, entry.page);
  selectPage(entry.page.id);
}

function duplicatePage(pageId) {
  const loc = locatePage(pageId);
  const copy = newPage((loc.page.title || 'Untitled page') + ' (copy)', loc.page.html);
  copy.ink = structuredClone(loc.page.ink || []);
  loc.sec.pages.splice(loc.idx + 1, 0, copy);
  selectPage(copy.id);
}

function movePage(pageId, sectionId, beforePageId = null) {
  const loc = locatePage(pageId);
  const target = locateSection(sectionId);
  if (!loc || !target || pageId === beforePageId) return;
  loc.sec.pages.splice(loc.idx, 1);
  const pages = target.sec.pages;
  const at = beforePageId ? pages.findIndex((p) => p.id === beforePageId) : -1;
  pages.splice(at < 0 ? pages.length : at, 0, loc.page);
  if (db.ui.pageId === pageId) {
    db.ui.notebookId = target.nb.id;
    db.ui.sectionId = target.sec.id;
  }
  renderAll();
  scheduleSave();
}

async function deleteSection(nb, sec) {
  const ok = await confirmBox('Delete section', `Delete "${sec.name}"? Its ${sec.pages.length} page(s) will go to the Recycle bin.`, 'Delete');
  if (!ok) return;
  trashPages(nb, sec, sec.pages);
  nb.sections.splice(nb.sections.indexOf(sec), 1);
  if (db.ui.sectionId === sec.id) db.ui.sectionId = null;
  renderAll();
  scheduleSave();
}

async function deleteNotebook(nb) {
  const count = nb.sections.reduce((n, s) => n + s.pages.length, 0);
  const ok = await confirmBox('Delete notebook', `Delete "${nb.name}"? Its ${count} page(s) will go to the Recycle bin.`, 'Delete');
  if (!ok) return;
  for (const sec of nb.sections) trashPages(nb, sec, sec.pages);
  db.notebooks.splice(db.notebooks.indexOf(nb), 1);
  if (db.ui.notebookId === nb.id) db.ui.notebookId = null;
  renderAll();
  scheduleSave();
}

async function rename(obj, title) {
  const name = await ask(title, obj.name);
  if (!name) return;
  obj.name = name;
  renderAll();
  scheduleSave();
}

function moveInArray(arr, item, delta) {
  const i = arr.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderAll();
  scheduleSave();
}

function colorSwatches(onPick) {
  return { swatches: COLORS, onPick };
}

function notebookMenu(e, nb) {
  showMenu(e, [
    { label: 'New section', action: () => { db.ui.notebookId = nb.id; addSection(); } },
    { label: 'Rename notebook', action: () => rename(nb, 'Rename notebook') },
    colorSwatches((c) => { nb.color = c; renderNav(); scheduleSave(); }),
    { label: 'Move up', action: () => moveInArray(db.notebooks, nb, -1) },
    { label: 'Move down', action: () => moveInArray(db.notebooks, nb, 1) },
    '-',
    { label: 'Delete notebook', danger: true, action: () => deleteNotebook(nb) },
  ]);
}

function sectionMenu(e, nb, sec) {
  showMenu(e, [
    { label: 'New page', action: () => { selectSection(nb.id, sec.id); addPage(); } },
    { label: 'Rename section', action: () => rename(sec, 'Rename section') },
    colorSwatches((c) => { sec.color = c; renderNav(); scheduleSave(); }),
    { label: 'Move up', action: () => moveInArray(nb.sections, sec, -1) },
    { label: 'Move down', action: () => moveInArray(nb.sections, sec, 1) },
    '-',
    { label: 'Delete section', danger: true, action: () => deleteSection(nb, sec) },
  ]);
}

function pageMenu(e, page) {
  showMenu(e, [
    { label: 'Duplicate page', action: () => duplicatePage(page.id) },
    { label: 'Move to…', action: () => movePageDialog(page.id) },
    { label: 'Export as PDF…', action: () => { selectPage(page.id); exportPdf(); } },
    '-',
    { label: 'Delete page', danger: true, action: () => deletePage(page.id) },
  ]);
}

async function movePageDialog(pageId) {
  const options = db.notebooks.flatMap((nb) =>
    nb.sections.map((s) => `<option value="${s.id}">${escapeHtml(nb.name)} › ${escapeHtml(s.name)}</option>`),
  );
  const ok = await openModal('Move page to', (body) => {
    body.innerHTML = `<select id="move-target">${options.join('')}</select>`;
  }, { okText: 'Move' });
  if (ok) movePage(pageId, $('#move-target').value);
}

// ---------- recycle bin ----------
function openTrash() {
  const build = (body) => {
    if (!db.trash.length) {
      body.innerHTML = '<p class="empty-list">The Recycle bin is empty.</p>';
      return;
    }
    body.innerHTML = `<p style="font-size:12px;color:var(--muted);margin-top:0">Deleted pages are kept for ${TRASH_DAYS} days.</p>`;
    for (const t of db.trash) {
      const row = document.createElement('div');
      row.className = 'trash-row';
      row.innerHTML = `<div class="info"><div>${escapeHtml(t.page.title || 'Untitled page')}</div><div>${escapeHtml(t.notebookName)} › ${escapeHtml(t.sectionName)} · deleted ${shortDate(t.deletedAt)}</div></div>`;
      const restore = document.createElement('button');
      restore.textContent = 'Restore';
      restore.onclick = () => {
        closeModal(false);
        restoreFromTrash(t.page.id);
      };
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.onclick = () => {
        db.trash.splice(db.trash.indexOf(t), 1);
        scheduleSave();
        build(body);
      };
      row.append(restore, del);
      body.appendChild(row);
    }
    const empty = document.createElement('button');
    empty.textContent = 'Empty Recycle bin';
    empty.className = 'link-btn';
    empty.style.cssText = 'color:#d32f2f;margin-top:8px';
    empty.onclick = async () => {
      db.trash = [];
      scheduleSave();
      build(body);
    };
    body.appendChild(empty);
  };
  openModal('Recycle bin', build, { okText: 'Close', hideCancel: true });
}

// ---------- search ----------
let results = [];
let activeResult = 0;

function runSearch() {
  const q = els.search.value.trim().toLowerCase();
  if (!q) {
    els.results.hidden = true;
    return;
  }
  const terms = q.split(/\s+/);
  results = [];
  for (const nb of db.notebooks)
    for (const sec of nb.sections)
      for (const page of sec.pages) {
        const hay = ((page.title || '') + '\n' + (page.text || '')).toLowerCase();
        if (terms.every((t) => hay.includes(t))) results.push({ nb, sec, page });
      }
  activeResult = 0;
  renderResults(terms);
}

function snippetFor(text, term) {
  const flat = (text || '').replace(/\s+/g, ' ');
  const i = flat.toLowerCase().indexOf(term);
  if (i < 0) return escapeHtml(flat.slice(0, 90));
  const start = Math.max(0, i - 35);
  const piece = flat.slice(start, i + term.length + 55);
  const at = i - start;
  return (start ? '…' : '') + escapeHtml(piece.slice(0, at)) + '<mark>' + escapeHtml(piece.slice(at, at + term.length)) + '</mark>' + escapeHtml(piece.slice(at + term.length)) + '…';
}

function renderResults(terms) {
  els.results.hidden = false;
  if (!results.length) {
    els.results.innerHTML = '<div class="empty-list">No matching pages.</div>';
    return;
  }
  els.results.innerHTML = '';
  results.slice(0, 50).forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'result' + (i === activeResult ? ' active' : '');
    div.innerHTML = `<div class="rt">${escapeHtml(r.page.title || 'Untitled page')}</div><div class="rp">${escapeHtml(r.nb.name)} › ${escapeHtml(r.sec.name)}</div><div class="rs">${snippetFor(r.page.text, terms[0])}</div>`;
    div.onmousedown = (e) => {
      e.preventDefault();
      openResult(i);
    };
    els.results.appendChild(div);
  });
}

function openResult(i) {
  const r = results[i];
  if (!r) return;
  const term = els.search.value.trim().split(/\s+/)[0];
  els.results.hidden = true;
  selectPage(r.page.id);
  els.editor.focus();
  getSelection().collapse(els.editor, 0);
  if (term) window.find(term, false, false, false, false, false, false);
}

els.search.addEventListener('input', runSearch);
els.search.addEventListener('focus', runSearch);
els.search.addEventListener('blur', () => setTimeout(() => (els.results.hidden = true), 150));
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeResult = Math.max(0, Math.min(results.length - 1, activeResult + (e.key === 'ArrowDown' ? 1 : -1)));
    renderResults(els.search.value.trim().toLowerCase().split(/\s+/));
  } else if (e.key === 'Enter') {
    openResult(activeResult);
  } else if (e.key === 'Escape') {
    els.search.value = '';
    els.results.hidden = true;
    els.editor.focus();
  }
});

// ---------- menus, dialogs, toast ----------
function showMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  els.menu.innerHTML = '';
  for (const item of items) {
    if (item === '-') {
      els.menu.appendChild(document.createElement('hr'));
    } else if (item.swatches) {
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const c of item.swatches) {
        const sw = document.createElement('span');
        sw.style.background = c;
        sw.title = 'Change color';
        sw.onclick = () => {
          hideMenu();
          item.onPick(c);
        };
        row.appendChild(sw);
      }
      els.menu.appendChild(row);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      if (item.danger) btn.className = 'danger';
      btn.onclick = () => {
        hideMenu();
        item.action();
      };
      els.menu.appendChild(btn);
    }
  }
  els.menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = els.menu.getBoundingClientRect();
  els.menu.style.left = Math.min(e.clientX, w - rect.width - 8) + 'px';
  els.menu.style.top = Math.min(e.clientY, h - rect.height - 8) + 'px';
}

const hideMenu = () => (els.menu.hidden = true);
document.addEventListener('mousedown', (e) => {
  if (!els.menu.contains(e.target)) hideMenu();
});
window.addEventListener('blur', hideMenu);

let modalResolve = null;

function openModal(title, build, { okText = 'OK', hideCancel = false } = {}) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  build(body);
  $('#modal-ok').textContent = okText;
  $('#modal-cancel').hidden = hideCancel;
  $('#modal-backdrop').hidden = false;
  const first = body.querySelector('input,select');
  if (first) {
    first.focus();
    first.select?.();
  } else {
    $('#modal-ok').focus();
  }
  return new Promise((resolve) => (modalResolve = resolve));
}

function closeModal(result) {
  $('#modal-backdrop').hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  resolve?.(result);
}

$('#modal-ok').onclick = () => closeModal(true);
$('#modal-cancel').onclick = () => closeModal(false);
$('#modal-backdrop').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal(false);
});
$('#modal-backdrop').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    closeModal(true);
  } else if (e.key === 'Escape') {
    closeModal(false);
  }
});

async function ask(title, value = '', placeholder = '') {
  let input;
  const ok = await openModal(title, (body) => {
    input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    body.appendChild(input);
  });
  return ok ? input.value.trim() : null;
}

function confirmBox(title, text, okText = 'OK') {
  return openModal(title, (body) => {
    const p = document.createElement('p');
    p.textContent = text;
    body.appendChild(p);
  }, { okText });
}

let toastTimer = null;
function toast(text, actionLabel, action) {
  els.toast.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  els.toast.appendChild(span);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.onclick = () => {
      els.toast.hidden = true;
      action();
    };
    els.toast.appendChild(btn);
  }
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 6000);
}

// ---------- top bar ----------
function applyTheme() {
  document.documentElement.dataset.theme = db.ui.theme;
  Ink.setDark(db.ui.theme === 'dark');
}

$('#btn-theme').onclick = () => {
  db.ui.theme = db.ui.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  scheduleSave();
};

$('#btn-more').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.right - 200, clientY: r.bottom + 4 }, [
    { label: 'New notebook', action: addNotebook },
    { label: 'Recycle bin', action: openTrash },
    { label: 'Export page as PDF…', action: exportPdf },
    '-',
    { label: 'Export backup…', action: exportBackup },
    { label: 'Import backup…', action: importBackup },
    { label: 'Show data file', action: () => store.revealData() },
    '-',
    { label: 'Keyboard shortcuts', action: showShortcuts },
  ]);
};

async function exportBackup() {
  await flushSave();
  if (await store.exportBackup(serialize(2))) toast('Backup exported.');
}

async function importBackup() {
  const text = await store.importBackup();
  if (!text) return;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return toast('That file is not a valid NoteNest backup.');
  }
  if (!isValidData(data)) return toast('That file is not a valid NoteNest backup.');
  const ok = await confirmBox('Import backup', 'Replace all current notebooks with this backup? Export a backup first if you want to keep them.', 'Replace');
  if (!ok) return;
  db = normalize(data);
  loadedPageId = null;
  Ink.setTools(db.ui.inkTools);
  setDrawTool(null);
  applyTheme();
  applyTab();
  applyPanes();
  renderAll();
  scheduleSave();
  toast('Backup imported.');
}

function showShortcuts() {
  openModal('Keyboard shortcuts', (body) => {
    body.innerHTML = `<table style="width:100%;font-size:13px;line-height:1.9">
      ${[
        ['Ctrl+N', 'New page'],
        ['Ctrl+E', 'Search all notes'],
        ['Ctrl+PgUp / PgDn', 'Previous / next page'],
        ['Ctrl+B / I / U', 'Bold / italic / underline'],
        ['Ctrl+-', 'Strikethrough'],
        ['Ctrl+Alt+H', 'Highlight'],
        ['Ctrl+Alt+1 / 2 / 3', 'Heading 1 / 2 / 3'],
        ['Ctrl+Shift+N', 'Normal text, clear formatting'],
        ['Ctrl+1', 'To-do checkbox'],
        ['Ctrl+K', 'Insert link (Ctrl+click opens)'],
        ['Alt+Shift+F', 'Insert date and time'],
        ['Tab / Shift+Tab', 'Indent / outdent list item'],
        ['Ctrl+P', 'Print page'],
        ['F11', 'Full screen (pen toolbar, panes hidden)'],
        ['Esc', 'Stop drawing / leave full screen'],
        ['Ctrl+Z (while drawing)', 'Undo last ink change'],
        ['Ctrl+Shift+B', 'Show/hide notebooks'],
        ['Ctrl+Shift+G', 'Show/hide pages'],
      ].map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')}
    </table>`;
  }, { okText: 'Close', hideCancel: true });
}

$('#add-notebook').onclick = addNotebook;
$('#add-section').onclick = addSection;
$('#add-page').onclick = addPage;
$('#empty-add').onclick = addPage;
$('#open-trash').onclick = openTrash;

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!$('#modal-backdrop').hidden) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const inEditor = els.editor.contains(document.activeElement) || document.activeElement === els.editor;
  const key = e.key.toLowerCase();

  if (e.key === 'Escape') {
    if (!els.menu.hidden) return hideMenu();
    if (Ink.getTool()) return setDrawTool(null);
    if (isFullscreen) return store.setFullscreen(false);
  }
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  } else if (ctrl && !e.shiftKey && key === 'z' && Ink.getTool()) {
    e.preventDefault();
    Ink.undo();
  } else if (ctrl && e.shiftKey && key === 'b') {
    e.preventDefault();
    togglePane('nav');
  } else if (ctrl && e.shiftKey && key === 'g') {
    e.preventDefault();
    togglePane('pages');
  } else if (ctrl && !e.shiftKey && !e.altKey && key === 'n') {
    e.preventDefault();
    addPage();
  } else if (ctrl && key === 'e') {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  } else if (ctrl && key === 'p') {
    e.preventDefault();
    window.print();
  } else if (ctrl && (e.key === 'PageDown' || e.key === 'PageUp')) {
    e.preventDefault();
    const sec = curSection();
    if (!sec) return;
    const i = sec.pages.findIndex((p) => p.id === db.ui.pageId);
    const next = sec.pages[i + (e.key === 'PageDown' ? 1 : -1)];
    if (next) selectPage(next.id);
  } else if (inEditor) {
    if (ctrl && e.altKey && key === 'h') {
      e.preventDefault();
      applyHighlight();
    } else if (ctrl && e.altKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      exec('formatBlock', `<h${e.key}>`);
    } else if (ctrl && e.shiftKey && key === 'n') {
      e.preventDefault();
      exec('removeFormat');
      exec('formatBlock', '<p>');
    } else if (ctrl && !e.altKey && e.key === '1') {
      e.preventDefault();
      toggleTodo();
    } else if (ctrl && key === 'k') {
      e.preventDefault();
      insertLink();
    } else if (ctrl && e.key === '-') {
      e.preventDefault();
      exec('strikeThrough');
    } else if (e.altKey && e.shiftKey && key === 'f') {
      e.preventDefault();
      insertDateTime();
    }
  }
});

// ---------- start ----------
(async function init() {
  document.execCommand('defaultParagraphSeparator', false, 'p');
  let data = null;
  try {
    data = await store.load();
  } catch {
    data = null;
  }
  db = normalize(isValidData(data) ? data : defaultData());
  Ink.init({
    sheet: els.sheet,
    main: $('#ink-main'),
    live: $('#ink-live'),
    tools: db.ui.inkTools,
    onChange: onInkChange,
    onInsertSpace: insertSpace,
    onGrow: growSheet,
  });
  applyTheme();
  applyTab();
  applyPanes();
  renderTools();
  renderAll();
  if (!isValidData(data)) scheduleSave();
})();
