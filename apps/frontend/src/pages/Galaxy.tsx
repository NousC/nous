import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft } from "lucide-react";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Full-page context graph — the war-room. Runs a self-contained canvas engine
// (force layout + render + interaction) against the live /api/graph snapshot.
// Deliberately NOT react-force-graph: we own the canvas so the encodings
// (committee, shared-claim bridges, patterns, dev rail, smooth zoom) match the
// design exactly. Mounted OUTSIDE the app sidebar as its own immersive surface.

/* eslint-disable @typescript-eslint/no-explicit-any */

// force-directed layout (Fruchterman-Reingold) — assigns x/y in place.
function layout(nodes: any[], edges: any[]) {
  const n = nodes.length; if (!n) return;
  const idx = new Map(nodes.map((nd, i) => [nd.i, i]));
  const P = nodes.map(() => [Math.random() * 2 - 1, Math.random() * 2 - 1]);
  const EI = edges.map(e => [idx.get(e.s), idx.get(e.t), e.k]).filter(a => a[0] != null && a[1] != null) as number[][];
  const grav = nodes.map(nd => nd.t === 1 ? (0.006 + (((nd.s || 30) / 100) + ((nd.a != null && nd.a <= 30) ? 0.4 : 0)) * 0.018) : nd.t === 3 ? 0.010 : 0.004);
  const k = Math.sqrt(1 / n) * 2.0; let t = 0.14;
  for (let it = 0; it < 170; it++) {
    const disp = nodes.map(() => [0, 0]);
    for (let i = 0; i < n; i++) {
      const xi = P[i][0], yi = P[i][1];
      for (let j = i + 1; j < n; j++) {
        let dx = xi - P[j][0], dy = yi - P[j][1]; let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) { dx = Math.random() * 1e-3; dy = Math.random() * 1e-3; d2 = dx * dx + dy * dy + 1e-6; }
        const dist = Math.sqrt(d2), f = k * k / dist, ux = dx / dist * f, uy = dy / dist * f;
        disp[i][0] += ux; disp[i][1] += uy; disp[j][0] -= ux; disp[j][1] -= uy;
      }
    }
    for (const [a, b, kk] of EI) {
      const w = kk === 0 ? 1.5 : 0.8;
      let dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1]; const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
      const f = dist * dist / k * w, ux = dx / dist * f, uy = dy / dist * f;
      disp[a][0] -= ux; disp[a][1] -= uy; disp[b][0] += ux; disp[b][1] += uy;
    }
    for (let i = 0; i < n; i++) { disp[i][0] -= P[i][0] * grav[i] * n * 0.02; disp[i][1] -= P[i][1] * grav[i] * n * 0.02; }
    for (let i = 0; i < n; i++) {
      const dl = Math.sqrt(disp[i][0] ** 2 + disp[i][1] ** 2) + 1e-9, step = Math.min(dl, t);
      P[i][0] += disp[i][0] / dl * step; P[i][1] += disp[i][1] / dl * step;
    }
    t *= 0.978;
  }
  let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
  for (const p of P) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); }
  const sc = Math.min(1350 / ((mxx - mnx) || 1), 1350 / ((mxy - mny) || 1));
  nodes.forEach((nd, i) => { nd.x = (P[i][0] - (mnx + mxx) / 2) * sc; nd.y = (P[i][1] - (mny + mxy) / 2) * sc; });
}

// second layout: claims as hubs, companies orbiting the claims they share. People
// are parked near their company (hidden in patterns mode). Sets xp/yp in place.
function layoutPatterns(nodes: any[], edges: any[]) {
  const pl = nodes.filter(n => n.t === 1 || n.t === 3); const pn = pl.length; if (!pn) return;
  const pidx = new Map(pl.map((n, i) => [n.i, i]));
  const PP = pl.map(() => [Math.random() * 2 - 1, Math.random() * 2 - 1]);
  const PE = edges.filter(e => e.k === 2).map(e => [pidx.get(e.s), pidx.get(e.t)]).filter(a => a[0] != null && a[1] != null) as number[][];
  const k = Math.sqrt(1 / pn) * 2.2; let t = 0.14;
  for (let it = 0; it < 160; it++) {
    const disp = pl.map(() => [0, 0]);
    for (let i = 0; i < pn; i++) { const xi = PP[i][0], yi = PP[i][1]; for (let j = i + 1; j < pn; j++) { let dx = xi - PP[j][0], dy = yi - PP[j][1]; let d2 = dx * dx + dy * dy; if (d2 < 1e-6) { dx = Math.random() * 1e-3; dy = Math.random() * 1e-3; d2 = dx * dx + dy * dy + 1e-6; } const dist = Math.sqrt(d2), f = k * k / dist, ux = dx / dist * f, uy = dy / dist * f; disp[i][0] += ux; disp[i][1] += uy; disp[j][0] -= ux; disp[j][1] -= uy; } }
    for (const [a, b] of PE) { let dx = PP[a][0] - PP[b][0], dy = PP[a][1] - PP[b][1]; const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4; const f = dist * dist / k * 1.7, ux = dx / dist * f, uy = dy / dist * f; disp[a][0] -= ux; disp[a][1] -= uy; disp[b][0] += ux; disp[b][1] += uy; }
    for (let i = 0; i < pn; i++) { disp[i][0] -= PP[i][0] * 0.02; disp[i][1] -= PP[i][1] * 0.02; }
    for (let i = 0; i < pn; i++) { const dl = Math.sqrt(disp[i][0] ** 2 + disp[i][1] ** 2) + 1e-9, step = Math.min(dl, t); PP[i][0] += disp[i][0] / dl * step; PP[i][1] += disp[i][1] / dl * step; }
    t *= 0.978;
  }
  let a = 1e9, c = -1e9, b = 1e9, d = -1e9;
  for (const p of PP) { a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); d = Math.max(d, p[1]); }
  const sc = Math.min(1200 / ((c - a) || 1), 1200 / ((d - b) || 1));
  const compxp = new Map<string, number[]>();
  pl.forEach((nd, i) => { nd.xp = (PP[i][0] - (a + c) / 2) * sc; nd.yp = (PP[i][1] - (b + d) / 2) * sc; if (nd.t === 1) compxp.set(nd.i, [nd.xp, nd.yp]); });
  for (const nd of nodes) if (nd.t === 0) { const base = nd.co ? compxp.get(nd.co) : null; if (base) { nd.xp = base[0] + (Math.random() * 18 - 9); nd.yp = base[1] + (Math.random() * 18 - 9); } else { nd.xp = nd.xa * 0.35; nd.yp = nd.ya * 0.35; } }
}

// the canvas engine — returns a disposer. Faithful port of the standalone.
function runEngine(root: HTMLElement, D: any): () => void {
  const cv = root.querySelector('#gx-c') as HTMLCanvasElement;
  const ctx = cv.getContext('2d', { alpha: false })!;
  const tip = root.querySelector('#gx-tip') as HTMLElement;
  const rail = root.querySelector('#gx-rail') as HTMLElement;
  let W = 0, H = 0; const DPR = Math.min(1.6, window.devicePixelRatio || 1);
  const RAIL = 262;
  function size() { W = window.innerWidth; H = window.innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  size();
  const GREEN = '#34d399', GREEN_D = '#12694a', GOLD = '#f5b942', SLATE = '#2a3446', SLATEB = '#3f4b63', INK = '231,236,245', ACC = '#8b5cf6', CLA = '#a78bfa', BG = '#0a0c11';
  const CATCOL: Record<string, string> = { stack: '#a78bfa', pain: '#f0665c', intent: '#4fd1c5', segment: '#f2b263', theme: '#8a8fa0' };
  const nodes = D.nodes, byId = new Map(nodes.map((n: any) => [n.i, n]));
  for (const n of nodes) n.r = n.t === 1 ? (4.5 + (n.pc || 0) * 0.9) : n.t === 3 ? (4 + Math.sqrt(n.sz || 1) * 1.6) : 3.0;
  const fillP = (n: any) => n.a == null ? SLATE : (n.s != null && n.s >= 85 && n.a <= 30) ? GOLD : n.a <= 30 ? GREEN : n.a <= 75 ? GREEN_D : SLATE;
  const fillC = (n: any) => n.a == null ? '#26313f' : n.a <= 30 ? '#2c5647' : '#2a3446';
  const edges = D.edges.map((e: any) => ({ a: byId.get(e.s), b: byId.get(e.t), k: e.k })).filter((e: any) => e.a && e.b);
  const adj = new Map(nodes.map((n: any) => [n.i, [] as string[]]));
  const memberOf = new Map<string, string[]>(); for (const n of nodes) if (n.t === 1) memberOf.set(n.i, []);
  for (const e of edges) { adj.get(e.a.i)!.push(e.b.i); adj.get(e.b.i)!.push(e.a.i); if (e.k === 0 && memberOf.has(e.b.i)) memberOf.get(e.b.i)!.push(e.a.i); }
  let scale = 1, tx = 0, ty = 0, ts = 1, ttx = 0, tty = 0, anim = false, fast = false, hov: any = null, sel: any = null, hi: Set<string> | null = null, pending = false, mode = 'accounts', dead = false;
  const F = (v: any) => Number.isFinite(v);
  function fit() { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const n of nodes) { a = Math.min(a, n.x); b = Math.min(b, n.y); c = Math.max(c, n.x); d = Math.max(d, n.y); } const gw = (c - a) || 1, gh = (d - b) || 1, s = Math.min((W - RAIL) / (gw * 1.16), H / (gh * 1.16)); ts = scale = s; ttx = tx = (W - RAIL) / 2 - (a + c) / 2 * s; tty = ty = H / 2 - (b + d) / 2 * s; }
  fit();
  let trans = false, transStart = 0;
  function fitTarget(m: string) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const n of nodes) { if (m === 'patterns' && n.t === 0) continue; if (m === 'accounts' && n.t === 3) continue; const X = m === 'accounts' ? n.xa : n.xp, Y = m === 'accounts' ? n.ya : n.yp; a = Math.min(a, X); b = Math.min(b, Y); c = Math.max(c, X); d = Math.max(d, Y); } const gw = (c - a) || 1, gh = (d - b) || 1, s = Math.min((W - RAIL) / (gw * 1.16), H / (gh * 1.16)); ts = s; ttx = (W - RAIL) / 2 - (a + c) / 2 * s; tty = H / 2 - (b + d) / 2 * s; }
  function toMode(m: string) { mode = m; for (const n of nodes) { n._x0 = n.x; n._y0 = n.y; n._xt = m === 'accounts' ? n.xa : n.xp; n._yt = m === 'accounts' ? n.ya : n.yp; } fitTarget(m); trans = true; transStart = performance.now(); sel = null; hi = null; clearActive(); kick(); }
  function animate(now?: number) { if (dead) return; now = now || performance.now(); fast = true; let d = false; scale += (ts - scale) * 0.45; if (Math.abs(ts - scale) > 0.0004) d = true; else scale = ts; tx += (ttx - tx) * 0.45; ty += (tty - ty) * 0.45; if (Math.abs(ttx - tx) > 0.3 || Math.abs(tty - ty) > 0.3) d = true; else { tx = ttx; ty = tty; } if (trans) { const p = Math.min(1, (now - transStart) / 500); const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; for (const n of nodes) { n.x = n._x0 + (n._xt - n._x0) * e; n.y = n._y0 + (n._yt - n._y0) * e; } if (p < 1) d = true; else trans = false; } draw(); if (d) requestAnimationFrame(animate); else { fast = false; draw(); anim = false; } }
  function kick() { if (!anim && !dead) { anim = true; requestAnimationFrame(animate); } }
  function req() { if (anim || dead) return; if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; if (!dead) draw(); }); } }
  function zoomAt(mx: number, my: number, factor: number) { const ns = Math.max(0.1, Math.min(9, ts * factor)), wx = (mx - tx) / scale, wy = (my - ty) / scale; ttx = mx - wx * ns; tty = my - wy * ns; ts = ns; kick(); }
  function expand(node: any) { const s = new Set<string>([node.i]); for (const nb of adj.get(node.i)!) { s.add(nb); const nn: any = byId.get(nb); if (nn && nn.t === 3) for (const nb2 of adj.get(nb)!) s.add(nb2); } if (node.t === 0) for (const c of adj.get(node.i)!) { const cc: any = byId.get(c); if (cc && cc.t === 1) for (const cl of adj.get(c)!) s.add(cl); } return s; }
  function fset(): Set<string> | null { if (hi) return hi; const f = sel || hov; return f ? expand(f) : null; }
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * tx, DPR * ty); const S = fset();
    if (!fast) { const f = sel || hov; const comp = f && f.t === 1 ? f : null; if (comp) { const pts = [comp, ...memberOf.get(comp.i)!.map(id => byId.get(id))].filter((p: any) => p && F(p.x)) as any[]; let cx = 0, cy = 0; for (const p of pts) { cx += p.x; cy += p.y; } cx /= pts.length; cy /= pts.length; let R = 0; for (const p of pts) R = Math.max(R, Math.hypot(p.x - cx, p.y - cy) + p.r); R += 14; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fillStyle = 'rgba(139,92,246,0.06)'; ctx.fill(); ctx.lineWidth = 1 / scale; ctx.strokeStyle = 'rgba(139,92,246,0.2)'; ctx.stroke(); } }
    for (const e of edges) { if (!F(e.a.x) || !F(e.b.x)) continue; if (mode === 'patterns' && e.k === 0) continue; if (mode === 'accounts' && e.k === 2) continue; const on = !S || (S.has(e.a.i) && S.has(e.b.i)); let col, w; if (!on) { col = 'rgba(' + INK + ',0.035)'; w = 0.5; } else if (e.k === 2) { col = 'rgba(167,139,250,0.4)'; w = 0.9; } else { col = e.a.dm ? 'rgba(245,185,66,0.55)' : 'rgba(150,166,196,0.28)'; w = e.a.dm ? 1.1 : 0.6; } ctx.strokeStyle = col; ctx.lineWidth = w / scale; ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke(); }
    for (const n of nodes) {
      if (!F(n.x)) continue; if (mode === 'patterns' && n.t === 0) continue; if (mode === 'accounts' && n.t === 3) continue;
      const faded = S && !S.has(n.i); ctx.globalAlpha = faded ? 0.12 : 1;
      if (n.t === 3) { const r = n.r, cc = CATCOL[n.cat] || CLA; ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(0.785); if (!fast && !faded) { ctx.shadowColor = cc; ctx.shadowBlur = 10; } ctx.fillStyle = '#1c1c28'; ctx.fillRect(-r, -r, 2 * r, 2 * r); ctx.shadowBlur = 0; ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = cc; ctx.strokeRect(-r, -r, 2 * r, 2 * r); ctx.restore(); ctx.globalAlpha = 1; continue; }
      const col = n.t === 1 ? fillC(n) : fillP(n); const lit = !faded && ((n.t === 0 && (col === GREEN || col === GOLD)) || (n.t === 1 && n.look));
      if (!fast && lit) { ctx.shadowColor = n.t === 1 ? GOLD : col; ctx.shadowBlur = n.t === 1 ? 16 : 11; } else ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
      if (n.t === 1) {
        ctx.lineWidth = (n.look ? 2 : 1.2) / scale; ctx.strokeStyle = n.look ? GOLD : (n === sel ? ACC : SLATEB); ctx.stroke();
        if (!fast) { const by = n.y - n.r - 4 / scale; if (n.single) { ctx.fillStyle = '#f0a33a'; ctx.font = 'bold ' + (9 / scale) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', n.x + n.r * 0.8, by); } if (n.budget) { ctx.strokeStyle = '#e5573b'; ctx.lineWidth = 1.3 / scale; const bx = n.x - n.r * 0.8; ctx.beginPath(); ctx.arc(bx, by, 3 / scale, 0, 6.283); ctx.moveTo(bx - 2 / scale, by - 2 / scale); ctx.lineTo(bx + 2 / scale, by + 2 / scale); ctx.stroke(); } }
      } else { ctx.lineWidth = (n.dm ? 1.5 : 0.7) / scale; ctx.strokeStyle = n.dm ? GOLD : (n === sel ? ACC : SLATEB); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of nodes) {
      if (!F(n.x)) continue; if (mode === 'patterns' && n.t === 0) continue; if (mode === 'accounts' && n.t === 3) continue; const near = S && S.has(n.i);
      const show = near || (n.t === 3 && scale > 0.2) || (n.t === 1 && scale > 0.62) || scale > 2.1; if (!show) continue;
      let lb = n.l || (n.t === 1 ? 'company' : 'person'); if (!lb) continue; if (lb.length > 26) lb = lb.slice(0, 25) + '…';
      const big = n.t === 3 || n.t === 1; const fs = (near ? 12 : (big ? 11 : 10)) / scale;
      ctx.font = (big ? '600 ' : '500 ') + fs + 'px ui-sans-serif,system-ui,sans-serif';
      ctx.lineWidth = 3.4 / scale; ctx.strokeStyle = BG; ctx.strokeText(lb, n.x, n.y + n.r + 3 / scale);
      ctx.fillStyle = n.t === 3 ? (CATCOL[n.cat] || CLA) : 'rgba(' + INK + ',' + (near ? 1 : (n.t === 1 ? 0.85 : 0.4)) + ')';
      ctx.fillText(lb, n.x, n.y + n.r + 3 / scale);
    }
  }
  draw();
  function pick(mx: number, my: number) { const wx = (mx - tx) / scale, wy = (my - ty) / scale; let best: any = null, bd = 1e9; for (const n of nodes) { if (!F(n.x)) continue; if (mode === 'patterns' && n.t === 0) continue; if (mode === 'accounts' && n.t === 3) continue; const dx = wx - n.x, dy = wy - n.y, d = dx * dx + dy * dy, rr = (n.r + 7 / scale) ** 2; if (d < rr && d < bd) { bd = d; best = n; } } return best; }
  let drag = false, lx = 0, ly = 0, moved = 0;
  const onMove = (e: MouseEvent) => {
    if (drag) { tx += e.clientX - lx; ty += e.clientY - ly; ttx = tx; tty = ty; lx = e.clientX; ly = e.clientY; moved++; fast = true; tip.style.display = 'none'; req(); return; }
    const n: any = pick(e.clientX, e.clientY);
    if (n) { let html; if (n.t === 3) html = '<b>' + n.l + '</b><span>' + (n.cat || 'theme') + ' · shared by ' + n.sz + ' accounts</span>'; else if (n.t === 1) { const f = []; if (n.single) f.push('single-threaded'); if (n.budget) f.push('no budget-holder'); html = '<b>' + (n.l || 'Company') + '</b><span>' + (n.pc || 0) + ' in committee' + (n.s != null ? ' · ICP ' + n.s : '') + (n.a == null ? ' · dormant' : ' · active ' + n.a + 'd') + '</span>' + (f.length ? '<em>' + f.join(' · ') + '</em>' : ''); } else html = '<b>' + (n.l || 'Person') + (n.dm ? ' <i>◆ decision-maker</i>' : '') + '</b><span>' + [n.jt, (n.s != null ? 'ICP ' + n.s : null), (n.a == null ? 'dormant' : 'active ' + n.a + 'd')].filter(Boolean).join(' · ') + '</span>'; tip.innerHTML = html; tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; cv.style.cursor = 'pointer'; }
    else { tip.style.display = 'none'; cv.style.cursor = 'grab'; }
    if (n !== hov) { hov = n; req(); }
  };
  const onDown = (e: MouseEvent) => { drag = true; moved = 0; lx = e.clientX; ly = e.clientY; cv.style.cursor = 'grabbing'; };
  const onUp = (e: MouseEvent) => { if (!drag) return; drag = false; fast = false; cv.style.cursor = 'grab'; if (moved < 3) { const n = pick(e.clientX, e.clientY); sel = (n === sel) ? null : n; if (n) { hi = null; clearActive(); } } req(); };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); let d = e.deltaY; if (e.deltaMode === 1) d *= 16; d = Math.max(-50, Math.min(50, d)); zoomAt(e.clientX, e.clientY, Math.exp(-d * 0.003)); };
  const onDbl = () => { sel = null; hi = null; clearActive(); fit(); kick(); };
  const onResize = () => { size(); fit(); req(); };
  cv.addEventListener('mousemove', onMove); cv.addEventListener('mousedown', onDown); window.addEventListener('mouseup', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('dblclick', onDbl); window.addEventListener('resize', onResize);
  (root.querySelector('#gx-zin') as HTMLElement).onclick = () => zoomAt((W - RAIL) / 2, H / 2, 1.4);
  (root.querySelector('#gx-zout') as HTMLElement).onclick = () => zoomAt((W - RAIL) / 2, H / 2, 1 / 1.4);
  (root.querySelector('#gx-zfit') as HTMLElement).onclick = () => { sel = null; hi = null; clearActive(); fit(); kick(); };
  // dev rail
  const memberSet = (cids: string[]) => { const s = new Set<string>(); for (const cid of cids) { s.add(cid); for (const p of (memberOf.get(cid) || [])) s.add(p); } return s; };
  const P = D.patterns; let active: HTMLElement | null = null;
  const snake = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
  function clearActive() { active = null; hi = null; rail.querySelectorAll('.row').forEach(r => r.classList.remove('on')); }
  function setActive(el: HTMLElement, ids: string[], clusterNode?: string) { if (active === el) { clearActive(); req(); return; } clearActive(); active = el; el.classList.add('on'); const s = memberSet(ids); if (clusterNode) s.add(clusterNode); hi = s; sel = null; req(); }
  let html = '<div class="ttl">$ nous.context_graph<i>' + ' — ' + nodes.filter((n: any) => n.t === 1).length + ' acct · ' + nodes.filter((n: any) => n.t === 0).length + ' ppl</i></div>';
  const cats: [string, string][] = [['pain', 'shared_pain'], ['segment', 'shared_segment'], ['stack', 'shared_stack'], ['intent', 'shared_intent']];
  const rowHtml = (c: any, i: number, cat: string) => '<div class="row cl" data-c="' + i + '"><span class="mk" style="color:' + (CATCOL[cat] || '#a78bfa') + '">◆</span><span class="lb">' + snake(c.label) + '</span><span class="ld"></span><b>' + c.ids.length + '</b></div>';
  for (const [cat, title] of cats) {
    const items = P.clusters.map((c: any, i: number) => [c, i] as [any, number]).filter((a: [any, number]) => (a[0].cat || 'theme') === cat);
    html += '<div class="h">## ' + title + '</div>';
    if (!items.length) { html += '<div class="mut">// none identified yet</div>'; continue; }
    for (const [c, i] of items) html += rowHtml(c, i, cat);
  }
  const th = P.clusters.map((c: any, i: number) => [c, i] as [any, number]).filter((a: [any, number]) => (a[0].cat || 'theme') === 'theme');
  if (th.length) { html += '<div class="h">## shared_themes</div>'; for (const [c, i] of th) html += rowHtml(c, i, 'theme'); }
  html += '<div class="h" style="margin-top:15px">## account_risk</div>';
  html += '<div class="row" data-k="single"><span class="mk" style="color:#f0a33a">●</span><span class="lb">single_threaded</span><span class="ld"></span><b>' + P.single.length + '</b></div>';
  html += '<div class="row" data-k="budget"><span class="mk" style="color:#e5573b">●</span><span class="lb">missing_budget_holder</span><span class="ld"></span><b>' + P.budget.length + '</b></div>';
  rail.innerHTML = html;
  rail.querySelectorAll('.row').forEach(el => { (el as HTMLElement).onclick = () => { const k = (el as HTMLElement).dataset.k; if (k) setActive(el as HTMLElement, k === 'single' ? P.single : P.budget); else { const cl = P.clusters[+(el as HTMLElement).dataset.c!]; setActive(el as HTMLElement, cl.ids, cl.node); } }; });
  root.querySelectorAll('#gx-modes button').forEach(b => { (b as HTMLElement).onclick = () => { root.querySelectorAll('#gx-modes button').forEach(x => x.classList.toggle('on', x === b)); toMode((b as HTMLElement).dataset.m!); }; });

  return () => { dead = true; cv.removeEventListener('mousemove', onMove); cv.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp); cv.removeEventListener('wheel', onWheel); cv.removeEventListener('dblclick', onDbl); window.removeEventListener('resize', onResize); };
}

const CSS = `
.gx-root{position:fixed;inset:0;background:#0a0c11;overflow:hidden;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.gx-root #gx-c{display:block;cursor:grab;position:fixed;left:0;top:0}
.gx-back{position:fixed;left:16px;top:16px;z-index:7;width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:9px;color:rgba(255,255,255,.8);cursor:pointer;backdrop-filter:blur(8px)}
.gx-back:hover{background:rgba(255,255,255,.13)}
.gx-root #gx-modes{position:fixed;left:62px;top:16px;z-index:6;display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:9px;padding:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.gx-root #gx-modes button{background:none;border:0;color:rgba(255,255,255,.5);font-size:11px;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit}
.gx-root #gx-modes button.on{background:rgba(167,139,250,.22);color:#fff}
.gx-root #gx-rail{position:fixed;right:0;top:0;width:262px;height:100%;padding:16px 14px;background:rgba(8,10,15,.86);backdrop-filter:blur(16px);border-left:1px solid rgba(255,255,255,.08);z-index:6;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5}
.gx-root #gx-rail .ttl{font-size:12px;font-weight:600;color:#7ee787;margin-bottom:16px}
.gx-root #gx-rail .ttl i{color:rgba(255,255,255,.32);font-style:normal;font-weight:400;font-size:10px}
.gx-root #gx-rail .h{color:rgba(126,231,135,.55);margin-bottom:6px;font-size:10.5px}
.gx-root #gx-rail .row{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.72);padding:4px 7px;border-radius:6px;cursor:pointer}
.gx-root #gx-rail .row:hover{background:rgba(255,255,255,.06)}
.gx-root #gx-rail .row.on{background:rgba(167,139,250,.2);color:#fff}
.gx-root #gx-rail .mk{flex:none;color:#a78bfa;font-size:9px}
.gx-root #gx-rail .lb{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gx-root #gx-rail .ld{flex:1;border-bottom:1px dotted rgba(255,255,255,.16);margin:0 3px;position:relative;top:-3px;min-width:8px}
.gx-root #gx-rail .row b{color:#7ee787;font-weight:600;flex:none}
.gx-root #gx-rail .mut{color:rgba(255,255,255,.3)}
.gx-root #gx-bar{position:fixed;left:16px;bottom:16px;display:flex;gap:6px;z-index:6}
.gx-root #gx-bar button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.8);width:32px;height:32px;border-radius:9px;font-size:16px;cursor:pointer;backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center}
.gx-root #gx-bar button:hover{background:rgba(255,255,255,.13)}
.gx-root #gx-tip{position:fixed;display:none;z-index:9;pointer-events:none;background:rgba(14,17,24,.96);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:7px 10px;backdrop-filter:blur(10px);max-width:240px}
.gx-root #gx-tip b{display:block;color:#fff;font-size:12px;font-weight:600}.gx-root #gx-tip b i{color:#f5b942;font-style:normal;font-weight:500;font-size:10px}
.gx-root #gx-tip span{display:block;color:rgba(255,255,255,.5);font-size:10.5px;margin-top:2px}.gx-root #gx-tip em{display:block;color:#f0a33a;font-size:10px;font-style:normal;margin-top:3px}
.gx-msg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:13px}
`;

export default function Galaxy() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = (userData as any)?.workspace?.id ?? "";
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId || !rootRef.current) return;
    let disposed = false; let dispose: (() => void) | null = null;
    setLoading(true); setErr(null);
    fetch(`${apiUrl}/api/graph?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : r.json().then((j: any) => Promise.reject(j)))
      .then((DATA: any) => {
        if (disposed || !rootRef.current) return;
        setLoading(false);
        if (!DATA.nodes?.length) return;
        layout(DATA.nodes, DATA.edges);
        DATA.nodes.forEach((n: any) => { n.xa = n.x; n.ya = n.y; });
        layoutPatterns(DATA.nodes, DATA.edges);
        dispose = runEngine(rootRef.current, DATA);
      })
      .catch((e: any) => { if (!disposed) { setErr(e?.error || "failed_to_load"); setLoading(false); } });
    return () => { disposed = true; if (dispose) dispose(); };
  }, [token, workspaceId]);

  return (
    <div ref={rootRef} className="gx-root">
      <style>{CSS}</style>
      <canvas id="gx-c" />
      <button className="gx-back" onClick={() => navigate("/accounts")} title="Back"><ArrowLeft size={16} /></button>
      <div id="gx-modes"><button data-m="accounts" className="on">accounts</button><button data-m="patterns">patterns</button></div>
      <div id="gx-rail" />
      <div id="gx-bar"><button id="gx-zout">−</button><button id="gx-zfit">⤢</button><button id="gx-zin">+</button></div>
      <div id="gx-tip" />
      {loading && <div className="gx-msg">building your context graph…</div>}
      {err && <div className="gx-msg">could not load the graph ({err})</div>}
    </div>
  );
}
