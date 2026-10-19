// Water Sort solver.
// Grows out of the DS131 project: a grid is a list of strings (one per tube,
// bottom -> top, one letter per color), a deque drives breadth-first search,
// and a set of visited configurations stops us exploring the same state twice.
//
// Fixes over the original Python version:
//  - goal test: every tube must hold a single color (the original checked that
//    letters were in alphabetical order, and patched the end with hard-coded moves)
//  - a pour moves the whole same-colored top run that fits, like the real game
//  - visited keys keep tube boundaries ("ab","" and "a","b" no longer collide)
//    and ignore tube order, since swapping two tubes gives an equivalent puzzle
//  - pointless moves are pruned (moving a finished tube, emptying a one-color
//    tube into an empty tube, trying several identical empty tubes)
//  - big puzzles fall back to best-first search with a priority queue, which
//    finds a solution quickly when plain BFS would run out of memory
(function (root) {
  'use strict';

  // ----- the deque from the original project (array-backed ring buffer) -----
  class Deque {
    constructor() { this.buf = new Array(1024); this.head = 0; this.size = 0; }
    get length() { return this.size; }
    append(x) {
      if (this.size === this.buf.length) {
        const nb = new Array(this.buf.length * 2);
        for (let i = 0; i < this.size; i++) nb[i] = this.buf[(this.head + i) % this.buf.length];
        this.buf = nb; this.head = 0;
      }
      this.buf[(this.head + this.size) % this.buf.length] = x;
      this.size++;
    }
    popleft() {
      const x = this.buf[this.head];
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.buf.length;
      this.size--;
      return x;
    }
  }

  // ----- binary heap for best-first search -----
  class MinHeap {
    constructor() { this.a = []; }
    get length() { return this.a.length; }
    push(item, pri) {
      const a = this.a; a.push([pri, item]);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top[1];
    }
  }

  const top = (t) => t[t.length - 1];

  function topRun(t) {
    let n = 0;
    const c = top(t);
    for (let i = t.length - 1; i >= 0 && t[i] === c; i--) n++;
    return n;
  }

  const uniform = (t) => t.length === 0 || topRun(t) === t.length;

  // Is pouring from tube i into tube j allowed? (valid_move in the original)
  function validMove(src, dst, cap) {
    if (src.length === 0) return false;           // nothing to pour
    if (dst.length >= cap) return false;          // target is full
    if (dst.length > 0 && top(src) !== top(dst)) return false; // colors must match
    return true;
  }

  // Goal: each tube is empty or one color, and no color is split over tubes.
  function isSolved(grid) {
    const seen = new Set();
    for (const t of grid) {
      if (t.length === 0) continue;
      if (!uniform(t)) return false;
      if (seen.has(t[0])) return false;
      seen.add(t[0]);
    }
    return true;
  }

  // Order-independent key; '|' keeps tube boundaries.
  const keyOf = (grid) => grid.slice().sort().join('|');

  // Every useful move from this grid, as [from, to, count].
  function movesFrom(grid, cap) {
    const out = [];
    let triedEmpty = false;
    for (let i = 0; i < grid.length; i++) {
      const src = grid[i];
      if (src.length === 0) continue;
      const run = topRun(src);
      const srcUniform = run === src.length;
      if (srcUniform && src.length === cap) continue; // finished tube
      triedEmpty = false;
      for (let j = 0; j < grid.length; j++) {
        if (i === j) continue;
        const dst = grid[j];
        if (!validMove(src, dst, cap)) continue;
        if (dst.length === 0) {
          if (srcUniform || triedEmpty) continue; // pointless or duplicate
          triedEmpty = true;
        }
        out.push([i, j, Math.min(run, cap - dst.length)]);
      }
    }
    return out;
  }

  function apply(grid, [i, j, n]) {
    const g = grid.slice();
    g[j] = g[j] + g[i].slice(g[i].length - n);
    g[i] = g[i].slice(0, g[i].length - n);
    return g;
  }

  // Heuristic for best-first: how "mixed" the puzzle still is.
  function mixedness(grid) {
    let h = 0;
    const tubesWith = {};
    for (const t of grid) {
      for (let k = 1; k < t.length; k++) if (t[k] !== t[k - 1]) h++;
      const s = new Set(t);
      for (const c of s) tubesWith[c] = (tubesWith[c] || 0) + 1;
    }
    for (const c in tubesWith) h += tubesWith[c] - 1;
    return h;
  }

  // Breadth-first search with a deque (the original solve()).
  // Returns the shortest list of pours, null if impossible, or 'limit'.
  function bfs(start, cap, limit) {
    const visited = new Set([keyOf(start)]);
    const queue = new Deque();
    queue.append([start, null]);
    let explored = 0;
    while (queue.length) {
      const node = queue.popleft();
      const grid = node[0];
      if (isSolved(grid)) return { path: unwind(node), explored };
      if (++explored > limit) return { path: 'limit', explored };
      for (const m of movesFrom(grid, cap)) {
        const ng = apply(grid, m);
        const k = keyOf(ng);
        if (visited.has(k)) continue;
        visited.add(k);
        queue.append([ng, [node, m]]);
      }
    }
    return { path: null, explored };
  }

  // Best-first (weighted A*) for puzzles too big for plain BFS.
  function bestFirst(start, cap, limit) {
    const best = new Map([[keyOf(start), 0]]);
    const heap = new MinHeap();
    heap.push([start, null, 0], 3 * mixedness(start));
    let explored = 0;
    while (heap.length) {
      const node = heap.pop();
      const [grid, , g] = node;
      if (isSolved(grid)) return { path: unwind(node), explored };
      if (++explored > limit) return { path: 'limit', explored };
      for (const m of movesFrom(grid, cap)) {
        const ng = apply(grid, m);
        const k = keyOf(ng);
        const prev = best.get(k);
        if (prev !== undefined && prev <= g + 1) continue;
        best.set(k, g + 1);
        heap.push([ng, [node, m], g + 1], g + 1 + 3 * mixedness(ng));
      }
    }
    return { path: null, explored };
  }

  function unwind(node) {
    const path = [];
    let link = node[1];
    while (link) { path.push(link[1]); link = link[0][1]; }
    return path.reverse();
  }

  // Check the puzzle makes sense before searching.
  function validate(grid, cap) {
    const problems = [];
    if (!Array.isArray(grid) || grid.length === 0) return ['Add at least one tube.'];
    if (!(cap >= 1)) problems.push('Tube capacity must be at least 1.');
    grid.forEach((t, i) => {
      if (t.length > cap) problems.push(`Tube ${i + 1} holds ${t.length} layers but capacity is ${cap}.`);
    });
    const counts = {};
    for (const t of grid) for (const c of t) counts[c] = (counts[c] || 0) + 1;
    const colors = Object.keys(counts);
    if (colors.length > grid.length) problems.push(`There are ${colors.length} colors but only ${grid.length} tubes.`);
    for (const c of colors) {
      if (counts[c] !== cap) problems.push(`Color "${c}" has ${counts[c]} layers; each color usually needs exactly ${cap}.`);
    }
    return problems;
  }

  // Main entry. grid: array of strings bottom->top. Returns
  // { moves: [{from,to,count,color}], method, explored, optimal } or { error }.
  function solve(grid, cap, opts = {}) {
    grid = grid.map((t) => String(t));
    const bfsLimit = opts.bfsLimit ?? 150000;
    const bestLimit = opts.bestLimit ?? 2000000;
    let method = 'bfs', res = bfs(grid, cap, bfsLimit), explored = res.explored;
    if (res.path === 'limit') {
      method = 'best-first';
      res = bestFirst(grid, cap, bestLimit);
      explored += res.explored;
    }
    if (res.path === 'limit') return { error: 'Search limit reached without finding a solution.', explored };
    if (res.path === null) return { error: 'This puzzle cannot be solved.', explored };
    let g = grid;
    const moves = res.path.map((m) => {
      const step = { from: m[0], to: m[1], count: m[2], color: top(g[m[0]]) };
      g = apply(g, m);
      return step;
    });
    return { moves, method, explored, optimal: method === 'bfs' };
  }

  // Replay moves to get every intermediate grid (for step-by-step display).
  function states(grid, moves) {
    const out = [grid.slice()];
    let g = grid.slice();
    for (const m of moves) { g = apply(g, [m.from, m.to, m.count]); out.push(g); }
    return out;
  }

  const api = { solve, validate, isSolved, validMove, states, movesFrom, apply, Deque };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterSort = api;

  // When loaded as a Web Worker, solve off the main thread.
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = (e) => root.postMessage(solve(e.data.grid, e.data.cap));
  }
})(typeof self !== 'undefined' ? self : this);
