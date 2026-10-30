'use strict';

// Pen / graphics-tablet ink drawn over the page. Strokes are stored as vectors on the
// page (page.ink) in sheet coordinates, so they scroll with the page and survive resizes.
// Each stroke: { k: 'pen' | 'hl', c: color, w: width, p: [[x, y, pressure], ...] }
const Ink = (() => {
  const MAX_CANVAS_PX = 16000;
  const NEAR_BLACK = /^#(0|1|2)[0-9a-f](0|1|2)[0-9a-f](0|1|2)[0-9a-f]$/i;

  let sheet, main, live, mctx, lctx;
  let page = null;
  let tools = {};
  let toolId = null; // null = typing mode
  let dark = false;
  let dpr = 1;
  let onChange = () => {};
  let onInsertSpace = () => {};
  let onGrow = () => {};

  let current = null; // stroke being drawn
  let lastRaw = null; // latest unfiltered pen position
  let erasing = null; // { removed: [...] } while the eraser is down
  let spaceStart = null; // y where an insert-space drag began
  let lastPenTime = 0;
  let undoStack = [];

  const toolOf = (id) => tools[id];
  const displayColor = (c) => (dark && NEAR_BLACK.test(c) ? '#ece8f2' : c);
  const pressureWidth = (p) => 0.45 + Math.min(1, Math.max(0, p)) * 1.1;
  const round = (n) => Math.round(n * 10) / 10;

  function init(opts) {
    sheet = opts.sheet;
    main = opts.main;
    live = opts.live;
    mctx = main.getContext('2d');
    lctx = live.getContext('2d');
    tools = opts.tools;
    onChange = opts.onChange || onChange;
    onInsertSpace = opts.onInsertSpace || onInsertSpace;
    onGrow = opts.onGrow || onGrow;

    // Resize on the next frame so canvas changes never feed back into the same observer pass.
    let pending = false;
    new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        resize();
      });
    }).observe(sheet);
    // Browser zoom and moving to a screen with different scaling change the pixel ratio.
    window.addEventListener('resize', () => {
      if ((window.devicePixelRatio || 1) !== dpr) resize();
    });
    live.addEventListener('pointerdown', down);
    live.addEventListener('pointermove', move);
    live.addEventListener('pointerup', up);
    live.addEventListener('pointercancel', up);
    live.addEventListener('pointerleave', () => {
      if (!current && !erasing && spaceStart === null) clearLive();
    });
    // A tablet pen's eraser end works even while typing.
    sheet.addEventListener('pointerdown', (e) => {
      if (toolId === null && e.pointerType === 'pen' && e.buttons & 32 && e.target !== live) {
        setTool('eraser', true);
        down(e);
      }
    }, true);
  }

  function setPage(p) {
    page = p;
    if (page && !Array.isArray(page.ink)) page.ink = [];
    undoStack = [];
    current = null;
    resize();
  }

  let returnToTyping = false;
  function setTool(id, temporary = false) {
    toolId = id;
    returnToTyping = temporary;
    live.classList.toggle('active', id !== null);
    live.dataset.tool = id ? (id === 'space' ? 'space' : toolOf(id).kind) : '';
    clearLive();
  }

  const getTool = () => toolId;
  const setTools = (t) => {
    tools = t;
  };

  function setDark(on) {
    dark = on;
    redraw();
  }

  // Lowest / rightmost point used by ink, so the sheet can grow to fit it.
  function contentHeight() {
    let max = 0;
    for (const s of page?.ink || []) for (const pt of s.p) if (pt[1] + s.w > max) max = pt[1] + s.w;
    return max;
  }

  function contentWidth() {
    let max = 0;
    for (const s of page?.ink || []) for (const pt of s.p) if (pt[0] + s.w > max) max = pt[0] + s.w;
    return max;
  }

  function resize() {
    const w = sheet.clientWidth;
    const h = sheet.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PX / h, MAX_CANVAS_PX / w);
    for (const c of [main, live]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    redraw();
    if (current) drawStroke(lctx, current);
  }

  function prep(ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function redraw() {
    if (!mctx) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, main.width, main.height);
    prep(mctx);
    for (const s of page?.ink || []) drawStroke(mctx, s);
  }

  function clearLive() {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
  }

  function drawStroke(ctx, s) {
    if (!s.p.length) return;
    prep(ctx);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = displayColor(s.c);
    if (s.k === 'hl') {
      // Whole path at once so overlapping parts of one stroke don't darken.
      const smp = samples(s, 0, s.p.length - 1);
      ctx.globalAlpha = dark ? 0.35 : 0.42;
      ctx.lineWidth = s.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(smp[0][0], smp[0][1]);
      for (const [x, y] of smp) ctx.lineTo(x, y);
      if (smp.length === 1) ctx.lineTo(smp[0][0] + 0.5, smp[0][1]);
      ctx.stroke();
    } else {
      fillPen(ctx, samples(s, 0, s.p.length - 1));
    }
    ctx.restore();
  }

  // Pressure smoothed along the stroke so width changes gradually.
  function smoothedPressures(pts) {
    let pr = pts[0][2];
    return pts.map((p) => (pr += (p[2] - pr) * 0.3));
  }

  // Catmull-Rom spline through the stored points, sampled every ~1px, as [x, y, width].
  // Covers segments [from, to) plus the end point when `to` is the last point.
  function samples(s, from, to) {
    const pts = s.p;
    const prs = smoothedPressures(pts);
    const width = (i) => (s.k === 'hl' ? s.w : s.w * pressureWidth(prs[i]));
    if (pts.length === 1) return [[pts[0][0], pts[0][1], width(0)]];
    const out = [];
    for (let i = Math.max(0, from); i < Math.min(to, pts.length - 1); i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const w1 = width(i);
      const w2 = width(i + 1);
      const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
        out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), w1 + (w2 - w1) * t]);
      }
    }
    if (to >= pts.length - 1) {
      const last = pts.length - 1;
      out.push([pts[last][0], pts[last][1], width(last)]);
    }
    return out;
  }

  // Variable-width pen ink as one filled shape: a disc at every sample joined by
  // tangent quads, all wound the same way so the nonzero fill is their clean union.
  function fillPen(ctx, smp) {
    if (!smp.length) return;
    ctx.beginPath();
    for (let i = 0; i < smp.length; i++) {
      const [x, y, w] = smp[i];
      const r = Math.max(0.35, w / 2);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (!i) continue;
      const [x0, y0, w0] = smp[i - 1];
      const r0 = Math.max(0.35, w0 / 2);
      const d = Math.hypot(x - x0, y - y0);
      if (d < 0.01) continue;
      const nx = -(y - y0) / d;
      const ny = (x - x0) / d;
      const q = [
        [x0 + nx * r0, y0 + ny * r0],
        [x + nx * r, y + ny * r],
        [x - nx * r, y - ny * r],
        [x0 - nx * r0, y0 - ny * r0],
      ];
      let area = 0;
      for (let k = 0; k < 4; k++) area += q[k][0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * q[k][1];
      if (area < 0) q.reverse(); // match the arcs' winding
      ctx.moveTo(q[0][0], q[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]);
      ctx.closePath();
    }
    ctx.fill();
  }

  // While drawing, only the last few segments change; draw just those onto the live layer.
  function drawPenTail(ctx, s) {
    prep(ctx);
    ctx.save();
    ctx.fillStyle = displayColor(s.c);
    const n = s.p.length - 1;
    fillPen(ctx, samples(s, n - 3, n));
    ctx.restore();
  }

  function pointFrom(e) {
    const r = live.getBoundingClientRect();
    // Mice report 0.5 pressure while pressed; pens report the real value.
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    return [round(e.clientX - r.left), round(e.clientY - r.top), Math.round(p * 100) / 100];
  }

  function ignore(e) {
    if (e.pointerType === 'pen') lastPenTime = Date.now();
    // Palm rejection: ignore touches shortly after the pen was used.
    return e.pointerType === 'touch' && Date.now() - lastPenTime < 1500;
  }

  function down(e) {
    if (!page || toolId === null || ignore(e)) return;
    if (e.button !== 0 && !(e.buttons & 32)) return;
    e.preventDefault();
    try {
      live.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only an optimization; drawing works without it.
    }
    const pt = pointFrom(e);
    if (toolId === 'space') {
      spaceStart = pt[1];
      drawSpaceGuide(pt[1], pt[1]);
      return;
    }
    const tool = toolOf(toolId);
    if (tool.kind === 'eraser' || e.buttons & 32) {
      erasing = { removed: [] };
      eraseAt(pt);
      return;
    }
    current = { k: tool.kind === 'highlighter' ? 'hl' : 'pen', c: tool.color, w: tool.width, p: [pt] };
    clearLive();
    drawStroke(lctx, current);
  }

  function move(e) {
    if (ignore(e)) return;
    const coalesced = e.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e];
    if (spaceStart !== null) {
      drawSpaceGuide(spaceStart, pointFrom(e)[1]);
      return;
    }
    if (erasing) {
      for (const ev of events) eraseAt(pointFrom(ev));
      return;
    }
    if (!current) {
      if (toolId && toolOf(toolId)?.kind === 'eraser') drawEraserCursor(pointFrom(e));
      return;
    }
    let added = false;
    for (const ev of events) {
      const raw = pointFrom(ev);
      lastRaw = raw;
      const last = current.p[current.p.length - 1];
      // Light stabilizer: follow the pen 60% of the way to filter tablet jitter.
      const pt = [round(last[0] + (raw[0] - last[0]) * 0.6), round(last[1] + (raw[1] - last[1]) * 0.6), raw[2]];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.75) continue;
      current.p.push(pt);
      added = true;
    }
    if (!added) return;
    if (current.k === 'hl') {
      clearLive();
      drawStroke(lctx, current);
    } else {
      drawPenTail(lctx, current);
    }
    const y = current.p[current.p.length - 1][1];
    if (y > sheet.clientHeight - 120) onGrow(y + 400);
  }

  function up(e) {
    if (spaceStart !== null) {
      const dy = Math.round(pointFrom(e)[1] - spaceStart);
      const y0 = spaceStart;
      spaceStart = null;
      clearLive();
      if (Math.abs(dy) >= 4) onInsertSpace(y0, dy);
      return;
    }
    if (erasing) {
      if (erasing.removed.length) {
        undoStack.push({ type: 'erase', removed: erasing.removed });
        onChange();
      }
      erasing = null;
      clearLive();
      if (returnToTyping) setTool(null);
      return;
    }
    if (!current) return;
    // The stabilizer trails the pen; finish exactly where the pen lifted.
    const last = current.p[current.p.length - 1];
    if (lastRaw && Math.hypot(lastRaw[0] - last[0], lastRaw[1] - last[1]) > 0.75) current.p.push(lastRaw);
    lastRaw = null;
    page.ink.push(current);
    undoStack.push({ type: 'add', stroke: current });
    drawStroke(mctx, current);
    current = null;
    clearLive();
    onChange();
  }

  function distToSegment(px, py, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }

  function eraseAt(pt) {
    const r = (toolOf('eraser')?.width || 14) / 2;
    drawEraserCursor(pt);
    let hit = false;
    for (let i = page.ink.length - 1; i >= 0; i--) {
      const s = page.ink[i];
      const reach = r + s.w / 2;
      const pts = s.p;
      const touches = pts.length === 1
        ? Math.hypot(pt[0] - pts[0][0], pt[1] - pts[0][1]) <= reach
        : pts.some((p, j) => j > 0 && distToSegment(pt[0], pt[1], pts[j - 1], p) <= reach);
      if (touches) {
        erasing.removed.push({ stroke: s, index: i });
        page.ink.splice(i, 1);
        hit = true;
      }
    }
    if (hit) redraw();
  }

  function drawEraserCursor(pt) {
    const r = (toolOf('eraser')?.width || 14) / 2;
    clearLive();
    prep(lctx);
    lctx.save();
    lctx.strokeStyle = dark ? '#ece8f2' : '#6b6676';
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
    lctx.stroke();
    lctx.restore();
  }

  function drawSpaceGuide(y0, y1) {
    clearLive();
    prep(lctx);
    lctx.save();
    const w = live.clientWidth;
    lctx.fillStyle = y1 >= y0 ? 'rgba(107,63,160,0.10)' : 'rgba(214,69,93,0.12)';
    lctx.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
    lctx.strokeStyle = '#6b3fa0';
    lctx.setLineDash([6, 4]);
    lctx.lineWidth = 1.5;
    for (const y of [y0, y1]) {
      lctx.beginPath();
      lctx.moveTo(0, y);
      lctx.lineTo(w, y);
      lctx.stroke();
    }
    lctx.restore();
  }

  // Move every stroke that starts below y0 by dy (insert space / remove space).
  function shiftBelow(y0, dy) {
    if (!page) return;
    const moved = page.ink.filter((s) => Math.min(...s.p.map((p) => p[1])) >= y0 - 2);
    for (const s of moved) for (const p of s.p) p[1] = round(p[1] + dy);
    if (moved.length) undoStack.push({ type: 'shift', strokes: moved, dy });
    redraw();
  }

  function undo() {
    const action = undoStack.pop();
    if (!action || !page) return false;
    if (action.type === 'add') {
      const i = page.ink.indexOf(action.stroke);
      if (i >= 0) page.ink.splice(i, 1);
    } else if (action.type === 'erase') {
      for (const { stroke, index } of action.removed.slice().reverse()) page.ink.splice(Math.min(index, page.ink.length), 0, stroke);
    } else if (action.type === 'shift') {
      for (const s of action.strokes) for (const p of s.p) p[1] = round(p[1] - action.dy);
    }
    redraw();
    onChange();
    return true;
  }

  return { init, setPage, setTool, getTool, setTools, setDark, contentHeight, contentWidth, resize, redraw, shiftBelow, undo };
})();
