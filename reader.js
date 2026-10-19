// Reads a water sort screenshot into tubes and colors.
// Works on raw RGBA pixels ({ data, width, height }), so it runs both in the
// browser (canvas ImageData) and in Node tests.
//
// Steps:
//  1. find tubes: outline and liquid pixels grouped into tall, thin shapes
//  2. sort tubes into rows (top row first), left to right
//  3. walk down the middle of each tube and split the liquid into runs of one color
//  4. work out how tall one layer is, so a run two layers tall counts as two
//  5. group similar colors across all tubes
(function (root) {
  'use strict';

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function read(img, opts = {}) {
    const { data, width: W, height: H } = img;
    const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

    // ---- 1. outline mask on a reduced grid ----
    const s = Math.max(1, Math.round(W / 450));
    const w = Math.floor(W / s), h = Math.floor(H / s);
    const mask = new Uint8Array(w * h);
    // a cell counts as outline if any pixel in it does, so thin outlines survive
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cell: for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const [r, g, b] = px(x * s + dx, y * s + dy);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        // tube outline (light gray) or liquid (bright or colorful)
        if ((mn > 140 && mx - mn < 40) || mx > 90 || mx - mn > 60) { mask[y * w + x] = 1; break cell; }
      }
    }

    // connected components (iterative flood fill)
    const label = new Int32Array(w * h);
    const comps = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || label[start]) continue;
      const id = comps.length + 1;
      let x0 = w, x1 = 0, y0 = h, y1 = 0, n = 0;
      label[start] = id; stack.push(start);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const q of [p - 1, p + 1, p - w, p + w]) {
          if (q < 0 || q >= w * h || !mask[q] || label[q]) continue;
          if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
          label[q] = id; stack.push(q);
        }
      }
      comps.push({ x0, x1, y0, y1, n, cw: x1 - x0 + 1, ch: y1 - y0 + 1 });
    }

    let tubes = comps.filter(c =>
      c.ch >= h * 0.05 && c.cw >= w * 0.02 &&
      c.ch / c.cw >= 1.5 && c.ch / c.cw <= 12);
    if (!tubes.length) return { error: 'No tubes found. Try a screenshot that shows the whole board.' };

    // keep shapes the size of a typical tube
    const med = (a) => { const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
    const mh = med(tubes.map(t => t.ch)), mw = med(tubes.map(t => t.cw));
    tubes = tubes.filter(t => t.ch > mh * 0.75 && t.ch < mh * 1.3 && t.cw > mw * 0.7 && t.cw < mw * 1.4);

    // ---- 2. rows, then left to right ----
    tubes.sort((a, b) => a.y0 - b.y0);
    const rows = [];
    for (const t of tubes) {
      const row = rows.find(r => Math.abs(r[0].y0 - t.y0) < mh * 0.5);
      if (row) row.push(t); else rows.push([t]);
    }
    rows.forEach(r => r.sort((a, b) => a.x0 - b.x0));
    tubes = rows.flat().map(t => ({
      x0: t.x0 * s, x1: (t.x1 + 1) * s, y0: t.y0 * s, y1: (t.y1 + 1) * s, row: rows.findIndex(r => r.includes(t)),
    }));

    // ---- 3. liquid runs down the middle of each tube ----
    for (const t of tubes) {
      const tw = t.x1 - t.x0;
      const bx0 = Math.round(t.x0 + tw * 0.32), bx1 = Math.round(t.x1 - tw * 0.32);
      const step = Math.max(1, Math.round((bx1 - bx0) / 8));
      const runs = [];
      let cur = null;
      for (let y = t.y0; y < t.y1; y++) {
        let r = 0, g = 0, b = 0, k = 0;
        for (let x = bx0; x <= bx1; x += step) { const p = px(x, y); r += p[0]; g += p[1]; b += p[2]; k++; }
        const c = [r / k, g / k, b / k];
        const mx = Math.max(...c), mn = Math.min(...c);
        const liquid = mx > 75 || mx - mn > 45;
        if (!liquid) { cur = null; continue; }
        if (cur && dist(c, cur.c) < 40) {
          cur.c = cur.c.map((v, i) => (v * cur.len + c[i]) / (cur.len + 1));
          cur.len++; cur.y1 = y;
        } else {
          cur = { c, len: 1, y0: y, y1: y };
          runs.push(cur);
        }
      }
      t.runs = runs;
    }

    // ---- 4. layer height ----
    const all = tubes.flatMap(t => t.runs).filter(r => r.len >= 4);
    if (!all.length) {
      return { tubes: tubes.map(t => ({ box: t, layers: [] })), colors: [], cap: opts.cap || 4, warnings: ['Every tube looks empty.'] };
    }
    const bigMed = med(all.map(r => r.len));
    const solid = all.filter(r => r.len > bigMed * 0.4);
    const minLen = Math.min(...solid.map(r => r.len));
    const unit = med(solid.filter(r => r.len < minLen * 1.5).map(r => r.len));

    // ---- 5. color groups ----
    const colors = [];
    for (const t of tubes) {
      t.layers = [];
      for (const r of t.runs) {
        const n = Math.round(r.len / unit);
        if (n < 1) continue; // rim, outline or a highlight
        let ci = colors.findIndex(c => dist(c.rgb, r.c) < 40);
        if (ci < 0) { ci = colors.length; colors.push({ rgb: r.c.slice(), weight: 0 }); }
        const c = colors[ci];
        c.rgb = c.rgb.map((v, i) => (v * c.weight + r.c[i] * r.len) / (c.weight + r.len));
        c.weight += r.len;
        for (let i = 0; i < n; i++) t.layers.push(ci);
      }
      t.layers.reverse(); // runs were top -> bottom; puzzles are bottom -> top
    }

    // capacity: how many layers each color has (most common), or the fullest tube
    const totals = colors.map((_, ci) => tubes.reduce((a, t) => a + t.layers.filter(l => l === ci).length, 0));
    const freq = {};
    totals.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    const modeTotal = +Object.keys(freq).sort((a, b) => freq[b] - freq[a] || b - a)[0];
    const fullest = Math.max(...tubes.map(t => t.layers.length));
    const cap = opts.cap || Math.max(modeTotal, fullest);

    const warnings = [];
    totals.forEach((n, ci) => { if (n !== cap) warnings.push({ color: ci, count: n }); });

    return {
      tubes: tubes.map(t => ({ box: { x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1, row: t.row }, layers: t.layers })),
      colors: colors.map(c => ({ rgb: c.rgb.map(Math.round) })),
      cap,
      unit,
      warnings,
    };
  }

  const api = { read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterSortReader = api;
})(typeof self !== 'undefined' ? self : this);
