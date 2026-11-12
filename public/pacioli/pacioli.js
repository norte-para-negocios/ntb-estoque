// Pacioli v7 · motor do mascote (v6/01 Tela que Desabrocha) para o catálogo de animações.
// Fábrica: PacioliMotor.criar(canvas, { acao, tema, fundo, veste }) desenha quantos mascotes a página quiser, num laço só
// que atualiza apenas os visíveis. Cada ação (acoes/NN-nome.js) chama Pacioli.acao({...}) e fica registrada pelo nome do arquivo.
// A ação controla, a cada quadro, olhos, corpo, pétalas, cor da tela, "mãos" (faces que se soltam) e desenha objetos de cena.
// Espaço de desenho: 100 x 100 unidades, mascote centrado em (50, 50) com raio ~41; o canvas tem folga até -21..121 (EXT).
(() => {
  const TAU = Math.PI * 2, HP = Math.PI / 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixc = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);   // 0→1 entre a e b
  const easeOut = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const easeIn = t => clamp(t, 0, 1) ** 3;
  const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
  const back = t => { t = clamp(t, 0, 1); const s = 1.70158; return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2; };
  const arco = (t) => Math.sin(Math.PI * clamp(t, 0, 1));    // 0→1→0
  const EXT = 92 / 64;
  // ?bg=0b0b14 troca o fundo (as faces de arame são preenchidas com ele); muda em tempo real por postMessage({ bg })
  const hex = (h) => (h = String(h || '').replace('#', ''), h.length === 6 ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : null);
  const ESCURO = [28, 28, 31], PAPEL = [245, 245, 249], OLHO = [244, 239, 230], TINTA = [20, 19, 43], AMBER = [242, 179, 61], TEAL = [22, 142, 154];
  const VIO = [110, 114, 224], MAG = [154, 59, 134], DEEP = [58, 60, 128], RED = [226, 84, 84], GREEN = [92, 196, 120];
  class Sp { constructor(v) { this.v = v; this.u = 0; }
    to(t, dt, k = 150, c = 17) { // passos de no máx. 1/240 s: com quadro lento a mola explodia em NaN
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for (let i = 0; i < n; i++) { this.u += ((t - this.v) * k - this.u * c) * h; this.v += this.u * h; }
      if (!Number.isFinite(this.v)) { this.v = t; this.u = 0; } return this.v; } }

  // ---------- geometria: rombicuboctaedro ----------
  const G = 1 + Math.SQRT2, RAD = Math.sqrt(2 + G * G);
  const V = [];
  for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) { V.push([a * G, b, c]); V.push([a, b * G, c]); V.push([a, b, c * G]); }
  const E = [];
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const d = (V[i][0] - V[j][0]) ** 2 + (V[i][1] - V[j][1]) ** 2 + (V[i][2] - V[j][2]) ** 2;
    if (Math.abs(d - 4) < 1e-6) E.push([i, j]);
  }
  const NS = [];
  for (let k = 0; k < 3; k++) for (const s of [1, -1]) { const n = [0, 0, 0]; n[k] = s; NS.push(n); }
  for (let k = 0; k < 3; k++) for (const s1 of [1, -1]) for (const s2 of [1, -1]) { const n = [0, 0, 0]; n[k] = s1 / Math.SQRT2; n[(k + 1) % 3] = s2 / Math.SQRT2; NS.push(n); }
  for (const a of [1, -1]) for (const b of [1, -1]) for (const c of [1, -1]) NS.push([a, b, c].map(x => x / Math.sqrt(3)));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const F = NS.map(n => {
    let m = -1e9; V.forEach(v => { m = Math.max(m, dot(n, v)); });
    const vs = []; V.forEach((v, i) => { if (dot(n, v) > m - 1e-6) vs.push(i); });
    const c = mul(vs.reduce((s, i) => add(s, V[i]), [0, 0, 0]), 1 / vs.length);
    const u0 = sub(V[vs[0]], c), w0 = cross(n, u0);
    vs.sort((p, q) => Math.atan2(dot(sub(V[p], c), w0), dot(sub(V[p], c), u0)) - Math.atan2(dot(sub(V[q], c), w0), dot(sub(V[q], c), u0)));
    return { n, vs, c, sq: vs.length === 4 };
  });
  const EF = E.map(([a, b]) => F.map((f, i) => (f.vs.includes(a) && f.vs.includes(b)) ? i : -1).filter(i => i >= 0));
  const m3 = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
  function hull(PV) {
    const p = PV.map(q => [q.X, q.Y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function poly(c, pts) { c.beginPath(); pts.forEach((p, i) => { const x = p.X ?? p[0], y = p.Y ?? p[1]; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); }

  // ======================= uma instância (um mascote num canvas) =======================
  function instancia(canvas, o) {
  const BG = hex(o.fundo) || (o.tema === 'claro' ? PAPEL.slice() : ESCURO.slice()), BG_ALVO = BG.slice();
  const CREAM = o.tema === 'claro' ? TINTA : OLHO;   // CREAM = cor do traço (creme no escuro, tinta da Norte no claro); os olhos são sempre OLHO
  // opacidade como mistura com o fundo: linhas que se cruzam não somam brilho
  const rgb = (c, a = 1) => `rgb(${c.map((x, i) => Math.round(BG[i] + (x - BG[i]) * a)).join(',')})`;
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1], VESTE = o.veste || null;
  function setRot(yaw, pitch, roll = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    M = m3([cr, -sr, 0, sr, cr, 0, 0, 0, 1], m3([1, 0, 0, 0, cp, -sp, 0, sp, cp], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]));
  }
  const rot = v => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

  // ---------- estado de quadro ----------
  let si = 0, st = 0, T = 0, t = 0, tPrev = -1, ACT = null, DUR = 6;
  let hover = false, mx = 0.5, my = 0.5, LX = 0, LY = 0;
  // HUMOR (base vinda do v6/01): 0 vigiando · 1 trabalhando (flor aberta) · 2 tudo certo · 3 precisa de você · 4 dormindo
  const EY = { lx: new Sp(0), ly: new Sp(0), w: new Sp(8.5), h: new Sp(20), hap: new Sp(0), dy: new Sp(0), lid: new Sp(0), a: new Sp(1), jx: 0, jy: 0 };
  const READ = { per: 1.25, lines: 3, p: 0, line: 0, x: -0.85 };
  function eyeUpdate(dt) {
    const ph = T / READ.per, ln = Math.floor(ph) % READ.lines;
    READ.p = ph % 1; READ.line = ln;
    READ.x = READ.p < 0.8 ? -0.85 + 1.7 * (READ.p / 0.8) : 0.85 - 1.7 * smooth((READ.p - 0.8) / 0.2);
    const tg = { w: 8.5, h: 20, hap: 0, dy: 0, lid: 0, lx: 0, ly: 0, kL: 55, cL: 12, a: 1, piscar: si === 0 || si === 3, tremor: si === 3 ? 1 : 0 };
    if (si === 0) { tg.lx = [0, -0.8, -0.8, 0, 0.8, 0.8][Math.floor(T / 0.9) % 6]; tg.ly = 0.12 * Math.sin(T * 0.6); }
    if (si === 1) { tg.lx = READ.x; tg.ly = -0.5 + READ.line * 0.5; tg.h = 17; tg.w = 9; tg.lid = 0.42; tg.kL = 420; tg.cL = 34; }
    if (si === 2) { tg.hap = 1; tg.h = 14; tg.ly = -0.25; tg.w = 6.6; }
    if (si === 3) { tg.w = 10.2; tg.h = 26; tg.dy = -3.4; tg.ly = -0.1; }
    if (si === 4) { tg.w = 11; tg.h = 2.8; tg.ly = 0.5; }
    if (hover && si !== 4) { tg.lx = LX; tg.ly = LY; tg.kL = 90; tg.cL = 14; }
    if (ACT.olhos) ACT.olhos(tg, t, A);
    const bt = (T + 0.6) % 3.7;
    if (tg.piscar && tg.hap < 0.5 && (bt < 0.12 || (Math.floor((T + 0.6) / 3.7) % 3 === 1 && bt > 0.26 && bt < 0.37))) tg.h = Math.min(tg.h, 2);
    EY.lx.to(tg.lx, dt, tg.kL, tg.cL); EY.ly.to(tg.ly, dt, tg.kL, tg.cL);
    EY.w.to(tg.w, dt, 260, 15); EY.h.to(tg.h, dt, 300, 15);
    EY.hap.to(tg.hap, dt, 190, 14); EY.dy.to(tg.dy, dt, 150, 12); EY.lid.to(tg.lid, dt, 200, 16); EY.a.to(tg.a, dt, 120, 16);
    const tr = tg.tremor * (0.6 + 0.4 * Math.max(0, Math.sin(st * 2.6)));
    EY.jx = tr * (0.36 * Math.sin(T * 53) + 0.2 * Math.sin(T * 37));
    EY.jy = tr * 0.22 * Math.sin(T * 47);
  }
  function drawEyes(c, cx, cy, k, col, o = {}) {
    const gap = (o.gap || 9.5) * k, sx = (o.sx ?? 4) * k, sy = (o.sy ?? 3) * k, sc = o.sc || 1, minT = o.minT || 0;
    const hap = clamp(EY.hap.v, 0, 1), lx = EY.lx.v, ly = EY.ly.v, lid = clamp(EY.lid.v, 0, 0.8);
    const parts = [];
    for (const s of [-1, 1]) {
      const far = Math.max(0, -s * lx);
      const e = { s,
        x: cx + s * gap * (1 - 0.1 * Math.abs(lx)) + lx * sx + EY.jx * k,
        y: cy + ly * sy + (s > 0 ? EY.dy.v * k * sc : 0) + EY.jy * k,
        w: Math.max(minT, 2.4 * sc * k, EY.w.v * sc * k * (1 - 0.2 * far)),
        h: Math.max(minT, 1.8 * sc * k, EY.h.v * sc * k) };
      // pílula achata até virar traço (1ª metade) e só então o traço curva em arco (2ª metade): misturar os dois desenhava um "+"
      const h1 = smooth(hap * 2), h2 = smooth(hap * 2 - 1);
      e.ph = Math.max(minT, lerp(e.h, e.w * 0.6, h1));
      e.aw = e.w * 0.82; e.ah = e.w * 0.62 * h2; e.lw = Math.max(minT, e.w * 0.6);
      e.top = e.y - e.ph / 2 + lid * e.ph;
      parts.push(e);
    }
    const pill = (e) => {
      if (hap >= 0.5) return;
      c.save();
      if (lid > 0.01) { const tt = -e.s * 0.2 * e.w; c.beginPath(); c.moveTo(e.x - e.w * 2, e.top - tt * 2); c.lineTo(e.x + e.w * 2, e.top + tt * 2); c.lineTo(e.x + e.w * 2, e.y + e.h * 2); c.lineTo(e.x - e.w * 2, e.y + e.h * 2); c.clip(); }
      c.beginPath(); c.roundRect(e.x - e.w / 2, e.y - e.ph / 2, e.w, e.ph, Math.min(e.w, e.ph) / 2); c.fill();
      c.restore();
    };
    const arc = (e) => {
      if (hap < 0.5) return;
      c.lineWidth = e.lw;
      c.beginPath(); c.moveTo(e.x - e.aw, e.y + e.ah * 0.45); c.quadraticCurveTo(e.x, e.y - e.ah * 1.45, e.x + e.aw, e.y + e.ah * 0.45); c.stroke();
    };
    c.lineCap = 'round'; c.fillStyle = col; c.strokeStyle = col;
    for (const e of parts) { pill(e); arc(e); }
  }

  // ---------- pétalas ----------
  const FRONT = F.findIndex(f => f.n[2] > 0.99);
  const LOOSE = F.findIndex(f => !f.sq && f.n[0] > 0 && f.n[1] > 0 && f.n[2] > 0);
  const RANK = F.map(f => (1 - f.n[2]) / 2);
  const ANG = F.map(f => Math.atan2(f.c[1], f.c[0]));
  const OS = F.map(() => new Sp(0));
  // os 4 triângulos da frente (viram as "mãos"): [cima-esq, cima-dir, baixo-esq, baixo-dir]
  const TRIS = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => F.findIndex(f => !f.sq && f.n[2] > 0 && Math.sign(f.n[0]) === a && Math.sign(f.n[1]) === b));
  let spin = 0, spinVel = 0;
  function rodr(p, k, th) {
    const c = Math.cos(th), s = Math.sin(th), kd = dot(k, p), kx = cross(k, p);
    return [p[0] * c + kx[0] * s + k[0] * kd * (1 - c), p[1] * c + kx[1] * s + k[1] * kd * (1 - c), p[2] * c + kx[2] * s + k[2] * kd * (1 - c)];
  }
  function petal(i) {
    const f = F[i], o = i === FRONT ? 0 : Math.max(0, OS[i].v);
    if (o < 1e-4) return f.vs.map(k => V[k]);
    const ax = [-f.n[1], f.n[0], 0], al2 = Math.hypot(ax[0], ax[1]);
    const k = al2 > 1e-6 ? [ax[0] / al2, ax[1] / al2, 0] : null;
    const cs = Math.cos(spin * o), sn = Math.sin(spin * o);
    return f.vs.map(vi => {
      let p = mul(sub(V[vi], f.c), 1 - 0.18 * o);
      if (k) p = rodr(p, k, -o * 0.4);
      p = add(add(f.c, p), mul(f.n, o * (0.95 - 0.45 * RANK[i])));
      return [p[0] * cs - p[1] * sn, p[0] * sn + p[1] * cs, p[2]];
    });
  }
  const openMean = () => { let s = 0; for (let i = 0; i < F.length; i++) if (i !== FRONT) s += clamp(OS[i].v, 0, 1); return s / (F.length - 1); };
  function splitHull(c, H, cx, cy, op, d0) {
    for (let i = 0; i < H.length; i++) {
      const a = H[i], b = H[(i + 1) % H.length], mxp = (a[0] + b[0]) / 2 - cx, myp = (a[1] + b[1]) / 2 - cy, L = Math.hypot(mxp, myp) || 1;
      const d = op * d0, sh = op * 0.22;
      c.beginPath();
      c.moveTo(lerp(a[0], b[0], sh) + mxp / L * d, lerp(a[1], b[1], sh) + myp / L * d);
      c.lineTo(lerp(b[0], a[0], sh) + mxp / L * d, lerp(b[1], a[1], sh) + myp / L * d); c.stroke();
    }
  }

  // ---------- corpo ----------
  const SC = 41 / RAD;
  const CAP = F.map(f => f.n[2] > 0.3);
  const FE = F.map((f, i) => f.vs.map((a, j) => {
    const b = f.vs[(j + 1) % f.vs.length], e = E.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
    const other = EF[e].find(x => x !== i);
    return { j, rim: CAP[i] && !CAP[other], seam: CAP[i] && CAP[other] };
  }));
  const yaw = new Sp(0), pitch = new Sp(0.16), roll = new Sp(0), scl = new Sp(1), sink = new Sp(0), hop = new Sp(0), al = new Sp(1), openAll = new Sp(0);
  const bx_ = new Sp(0), by_ = new Sp(0);
  let ARAME = false, FC = VIO.slice(), okAt = -9, CX = 50, CY = 50, op = 0, colorSnap = 7;
  // MÃOS: faces soltas que vão para um ponto da cena. H[i] = { x, y, rot, s, mix, cor } (sem mola: a ação anima direto)
  let HANDS = {};
  function enter(i) {
    if (i === 1) spin = 0;
    if (i === 2) { okAt = T; hop.u -= 62; }
    if (i === 3) { OS[LOOSE].u += 4; roll.u += 1.2; }
  }
  function update(dt) {
    let ty = EY.lx.v * 0.44, tp = 0.3 + EY.ly.v * 0.2, tr = 0, kk = 38;
    if (si === 0) ty += Math.sin(T * 0.45) * 0.05;
    if (si === 1) { ty = 0.05 + EY.lx.v * 0.08; tp = 0.1; kk = 50; }
    if (si === 2) { ty = 0; tp = 0.12; }
    if (si === 3) { ty = 0.05; tp = 0.18; tr = Math.sin(T * 38) * 0.03 * (0.6 + 0.4 * Math.max(0, Math.sin(st * 2.6))); }
    if (si === 4) { ty = 0.1; tp = 0.5 + Math.sin(T * 1.1) * 0.03; tr = 0.08; }
    if (hover && si !== 4 && si !== 1) { ty = EY.lx.v * 0.44; tp = 0.26 + EY.ly.v * 0.3; }
    const b = { yaw: ty, pitch: tp, roll: tr, k: kk, escala: si === 4 ? 0.94 + Math.sin(T * 1.1) * 0.012 : si === 1 ? 0.86 : si === 3 ? 1.02 : 1,
      x: 0, y: si === 4 ? 4 : 0, alfa: si === 4 && !hover ? 0.5 : 1, giro: si === 1 ? 0.6 : 0, onda: si === 1 ? 1 : 0 };
    if (ACT.corpo) ACT.corpo(b, t, A);
    ARAME = !!b.arame;   // b.arame: o corpo todo vira arame creme (sem tela), como o desenho de Leonardo
    yaw.to(b.yaw, dt, b.k, 10); pitch.to(b.pitch, dt, b.k, 10); roll.to(b.roll, dt, 140, 12);
    openAll.to(b.onda, dt, 60, 12);
    if (b.giro) spin += dt * b.giro;
    else spin += (Math.round(spin / HP) * HP - spin) * Math.min(1, dt * (si === 2 ? 8 : 2.5));
    // pétalas: alvo por face (0 fechada … 1 aberta); a ação pode trocar alvo e rigidez
    const PT = F.map((f, i) => {
      let tt = 0, k = 120 - RANK[i] * 60, c = 11;
      if (si === 1) tt = 0.85 + 0.15 * Math.sin(T * 2.4 - ANG[i] * 2);
      if (si === 2) { k = 260; c = 10; }
      if (si === 3 && i === LOOSE) { tt = 0.7 + 0.12 * Math.sin(T * 9); k = 200; }
      if (si === 4) tt = 0.05 + 0.04 * Math.sin(T * 1.15 - RANK[i]);
      if (hover && si === 0) tt = 0.08;
      return { t: tt, k, c };
    });
    if (ACT.petalas) ACT.petalas(PT, t, A);
    for (let i = 0; i < F.length; i++) if (i !== FRONT) OS[i].to(PT[i].t, dt, PT[i].k, PT[i].c);
    op = openMean();
    hop.to(0, dt, 170, 8);
    scl.to(b.escala, dt, 90, 12); al.to(b.alfa, dt, 40, 12);
    bx_.to(b.x, dt, 60, 13); by_.to(b.y, dt, 40, 10);
    const flash = si === 2 ? Math.exp(-Math.max(0, T - okAt - 0.15) * 1.6) : 0;
    let tc = si === 3 ? MAG : si === 4 && !hover ? DEEP : VIO;
    tc = mixc(tc, TEAL, flash);
    if (ACT.tela) { const r = ACT.tela(tc, t, A); if (r) tc = r; }
    FC = mixc(FC, tc, Math.min(1, dt * colorSnap));
    HANDS = {}; if (ACT.maos) ACT.maos(HANDS, t, A);
    CX = 50 + bx_.v; CY = 50 + by_.v + hop.v;
  }
  const P = v => { const r = rot(v), s = SC * scl.v; return { X: CX + r[0] * s, Y: CY - r[1] * s, z: r[2] }; };
  // transforma o contexto para o plano da face-rosto (coordenadas: 0,0 no centro da tela; ±SC*G ≈ ±35 até a borda do octógono)
  function noRosto(c, fn) {
    const p0 = P([0, 0, G]), px = P([1, 0, G]), py = P([0, -1, G]), s = SC;
    c.save(); c.transform((px.X - p0.X) / s, (px.Y - p0.Y) / s, (py.X - p0.X) / s, (py.Y - p0.Y) / s, p0.X, p0.Y); fn(c); c.restore();
  }
  function seg(c, a, b) { c.moveTo(a.X, a.Y); c.lineTo(b.X, b.Y); }
  // a face i desenhada como mão: forma da face projetada, recentrada, girada e escalada no ponto (x, y)
  // forma "de frente" de cada face (sem o encurtamento da projeção): solta, a mão vira um triângulo inteiro e não uma lasca
  const FLAT = F.map(f => { const u0 = (() => { const d = sub(V[f.vs[0]], f.c), L = Math.hypot(...d); return mul(d, 1 / L); })(), w0 = cross(f.n, u0);
    return f.vs.map(vi => { const d = sub(V[vi], f.c); return [dot(d, u0), dot(d, w0)]; }); });
  function handPts(pts, h, i) {
    const cx = pts.reduce((s, p) => s + p.X, 0) / pts.length, cy = pts.reduce((s, p) => s + p.Y, 0) / pts.length;
    if (i != null) {   // troca a forma projetada pela de frente, girada para o 1º vértice cair no mesmo ângulo e com o mesmo sentido
      const fl = FLAT[i], sc0 = SC * scl.v; let ar = 0;
      for (let j = 0; j < pts.length; j++) { const a = pts[j], b = pts[(j + 1) % pts.length]; ar += (a.X - cx) * (b.Y - cy) - (b.X - cx) * (a.Y - cy); }
      let ar2 = 0; for (let j = 0; j < fl.length; j++) { const a = fl[j], b = fl[(j + 1) % fl.length]; ar2 += a[0] * b[1] - b[0] * a[1]; }
      const m = Math.sign(ar) === Math.sign(ar2) ? 1 : -1, a0 = Math.atan2(pts[0].Y - cy, pts[0].X - cx), b0 = Math.atan2(fl[0][1] * m, fl[0][0]), dr = a0 - b0;
      const k = smooth(clamp((h.mix ?? 1) * 1.5, 0, 1));
      pts = pts.map((p, j) => { const x = fl[j][0] * sc0, y = fl[j][1] * m * sc0;
        return { X: lerp(p.X, cx + x * Math.cos(dr) - y * Math.sin(dr), k), Y: lerp(p.Y, cy + x * Math.sin(dr) + y * Math.cos(dr), k), z: p.z }; });
    }
    const cs = Math.cos(h.rot || 0), sn = Math.sin(h.rot || 0), s = h.s ?? 0.7, m = clamp(h.mix ?? 1, 0, 1);
    return pts.map(p => { const dx = (p.X - cx) * s, dy = (p.Y - cy) * s;
      return { X: lerp(p.X, h.x + dx * cs - dy * sn, m), Y: lerp(p.Y, h.y + dx * sn + dy * cs, m), z: 9 }; });
  }
  function draw(c, small, u) {
    setRot(yaw.v, pitch.v, roll.v);
    const gA = small ? Math.max(0.8, al.v) : al.v;
    const eyeC = rgb(OLHO, si === 4 && !hover ? 0.85 : 1), eyeA = clamp(EY.a.v, 0, 1);   // o.a = transparência de verdade (antes misturava com o fundo e virava pílula escura)
    const seamC = rgb(mixc(FC, BG, 0.22));
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (small) {
      const PV = V.map(P), H = hull(PV);
      c.strokeStyle = rgb(CREAM, gA); c.lineWidth = Math.max(2.2, 1.3 / u);
      splitHull(c, H, CX, CY, op, 9);
      const k = 1 - 0.4 * smooth(op);
      c.save(); c.translate(CX, CY); c.scale(k, k); c.translate(-CX, -CY);
      c.fillStyle = c.strokeStyle = rgb(FC); c.lineWidth = 0.7; c.beginPath();
      F.forEach((f, i) => { if (!CAP[i]) return; f.vs.forEach((q, j) => j ? c.lineTo(PV[q].X, PV[q].Y) : c.moveTo(PV[q].X, PV[q].Y)); c.closePath(); });
      c.fill(); c.stroke(); c.restore();
      noRosto(c, cc => drawEyes(cc, 0, -1.5, 1.05 * k, eyeC, { gap: 10.5, sx: 3, sy: 2, minT: 1.3 / u }));
      return;
    }
    const items = F.map((f, i) => {
      let pts = petal(i).map(P); const h = HANDS[i];
      if (h && (h.mix ?? 1) > 0) pts = handPts(pts, h, i);
      let ar = 0; for (let j = 0; j < pts.length; j++) { const a = pts[j], b = pts[(j + 1) % pts.length]; ar += a.X * b.Y - b.X * a.Y; }
      return { i, pts, z: pts.reduce((s, p) => s + p.z, 0) / pts.length, ar, o: i === FRONT ? 0 : clamp(OS[i].v, 0, 1), h };
    });
    const sgn = Math.sign(items[FRONT].ar) || 1;
    const closed = op < 0.025 && !Object.keys(HANDS).length;
    const late = [], handsL = [];
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      if (it.h && (it.h.mix ?? 1) > 0) { handsL.push(it); continue; }
      const vis = ARAME ? rot(F[it.i].n)[2] > 0 : Math.sign(it.ar) === sgn;   // girando 360° a face-rosto vai para trás: no arame vale a normal
      if (!vis) { c.strokeStyle = rgb(CREAM, 0.12 * gA); c.lineWidth = 1.6; poly(c, it.pts); c.stroke(); continue; }
      const wave = openAll.v > 0.02 && it.i !== FRONT ? openAll.v * Math.pow(Math.max(0, Math.cos(T * 3 - ANG[it.i])), 5) : 0;
      const loose = it.i === LOOSE ? smooth(OS[LOOSE].v * 2) * (si === 3 ? 1 : 0) : 0;
      if (!CAP[it.i] || ARAME) {
        const col = mixc(CREAM, AMBER, wave);
        c.fillStyle = rgb(BG); c.strokeStyle = rgb(col, gA); c.lineWidth = 2.4;
        poly(c, it.pts); c.fill(); c.stroke();
        continue;
      }
      let fc = mixc(FC, CREAM, 0.2 * wave);
      if (loose > 0) fc = mixc(fc, AMBER, loose);
      c.fillStyle = c.strokeStyle = rgb(fc); c.lineWidth = 0.7;
      poly(c, it.pts); c.fill(); c.stroke();
      const oo = smooth(Math.max(it.o, it.i === FRONT ? op : 0) * 2.5);
      if (closed) { late.push(it); continue; }
      for (const e of FE[it.i]) {
        const a = it.pts[e.j], b = it.pts[(e.j + 1) % it.pts.length];
        c.beginPath(); seg(c, a, b);
        if (e.rim) { c.strokeStyle = rgb(mixc(CREAM, AMBER, Math.max(wave, loose)), gA); c.lineWidth = 2.4; }
        else { c.strokeStyle = oo > 0.01 ? rgb(mixc(mixc(FC, BG, 0.22), mixc(CREAM, AMBER, Math.max(wave, loose)), oo), gA) : seamC; c.lineWidth = lerp(1.1, 2.2, oo); }
        c.stroke();
      }
    }
    if (closed) {
      c.strokeStyle = seamC; c.lineWidth = 1.1; c.beginPath();
      for (const it of late) for (const e of FE[it.i]) if (e.seam) seg(c, it.pts[e.j], it.pts[(e.j + 1) % it.pts.length]);
      c.stroke();
      c.strokeStyle = rgb(CREAM, gA); c.lineWidth = 2.4; c.beginPath();
      for (const it of late) for (const e of FE[it.i]) if (e.rim) seg(c, it.pts[e.j], it.pts[(e.j + 1) % it.pts.length]);
      c.stroke();
    }
    if (ACT.naTela) noRosto(c, cc => ACT.naTela(cc, t, A));   // desenho dentro da tela (números, ondas de voz…), por baixo dos olhos
    const eo = smooth(op * 1.4);
    if (eyeA > 0.02) noRosto(c, cc => { cc.globalAlpha = eyeA; drawEyes(cc, 0, lerp(-1.5, 0, eo), lerp(1.05, 0.95, eo), eyeC, { gap: lerp(9.8, 7.4, eo), sx: lerp(3.6, 2.2, eo), sy: lerp(4, 2.2, eo), sc: lerp(1, 0.86, eo) }); });
    // mãos por cima de tudo: peça da tela = violeta chapada com contorno creme; peça de arame = contorno creme
    for (const it of handsL) {
      const col = it.h.cor || (CAP[it.i] ? FC : null);
      c.lineWidth = 2.2; c.strokeStyle = rgb(CREAM, gA);
      c.fillStyle = col ? rgb(col) : rgb(BG);
      poly(c, it.pts); c.fill(); c.stroke();
    }
  }

  // ---------- API para as ações ----------
  const A = {
    // tempo
    get t() { return t; }, get T() { return T; }, get dur() { return DUR; },
    passou: (x) => tPrev >= 0 && (tPrev <= t ? tPrev < x && t >= x : (tPrev < x || t >= x)),   // cruzou x neste quadro (vale na volta do laço)
    seg01, easeOut, easeIn, easeInOut, back, arco, smooth, lerp, clamp, mix: mixc, rgb,
    // cores
    cor: { BG, CREAM, AMBER, TEAL, VIO, MAG, DEEP, RED, GREEN },
    // mascote
    get humor() { return si; }, get aberto() { return op; }, get centro() { return { x: CX, y: CY }; }, get escala() { return scl.v; },
    FRONT, LOOSE, TRIS, faces: F, CAP, RANK, ANG,
    faceXY: (i) => { const pts = petal(i).map(P); return { x: pts.reduce((s, p) => s + p.X, 0) / pts.length, y: pts.reduce((s, p) => s + p.Y, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length }; },
    P, noRosto,
    pulo: (forca = 62) => { hop.u -= forca; },
    tranco: (r = 1.2) => { roll.u += r; },
    estalo: () => { okAt = T; },     // pisca a tela teal (só no humor 2)
    // desenho de apoio
    texto(c, s, x, y, o = {}) {
      c.save(); c.font = `${o.peso || 600} ${o.tam || 6}px Geist, ui-sans-serif, system-ui, sans-serif`;
      c.textAlign = o.alinhar || 'center'; c.textBaseline = 'middle'; c.fillStyle = o.cor ? rgb(o.cor, o.a ?? 1) : rgb(CREAM, o.a ?? 1);
      if (o.monoNum) c.font = `${o.peso || 600} ${o.tam || 6}px "Geist Mono", ui-monospace, monospace`;
      c.fillText(s, x, y); c.restore();
    },
    linha(c, pts, o = {}) { c.save(); c.lineCap = c.lineJoin = 'round'; c.lineWidth = o.lw || 1.6; c.strokeStyle = rgb(o.cor || CREAM, o.a ?? 1);
      c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); if (o.fechar) c.closePath();
      if (o.preencher) { c.fillStyle = rgb(o.preencher, o.pa ?? 1); c.fill(); } c.stroke(); c.restore(); },
    poly,
  };

  // ---------- laço ----------
  // ---------- figurinos (desenhados no espaço da cena, acompanham o giro do corpo) ----------
  const unid = () => SC * scl.v;
  function contorno(c) { c.lineWidth = 2.2; c.strokeStyle = rgb(CREAM); c.lineJoin = c.lineCap = 'round'; }
  function vesteAtras(c) {
    if (VESTE !== 'capuz') return;   // capuz de frade (Luca Pacioli era franciscano): arco redondo atrás da cabeça + ombros; só aparece fora da silhueta
    const R = RAD * SC * scl.v, x = CX, y = CY;
    c.save(); c.translate(x, y); c.rotate(roll.v); contorno(c); c.fillStyle = rgb([126, 92, 64]);
    c.beginPath(); c.moveTo(-R * 1.02, R * 0.25);
    c.bezierCurveTo(-R * 1.18, -R * 0.9, -R * 0.45, -R * 1.32, 0, -R * 1.3);
    c.bezierCurveTo(R * 0.45, -R * 1.32, R * 1.18, -R * 0.9, R * 1.02, R * 0.25);
    c.quadraticCurveTo(R * 1.32, R * 0.62, R * 1.36, R * 1.08); c.lineTo(-R * 1.36, R * 1.08);
    c.quadraticCurveTo(-R * 1.32, R * 0.62, -R * 1.02, R * 0.25); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  function vesteFrente(c) {
    if (!VESTE || VESTE === 'capuz') return;
    const s = unid();
    if (VESTE === 'chef') {   // chapéu de cozinheiro sentado no topo; inclina com o corpo
      const a = P([-1, G, 0]), b = P([1, G, 0]), m = P([0, G, 0.2]);
      c.save(); c.translate(m.X, m.Y); c.rotate(Math.atan2(b.Y - a.Y, b.X - a.X)); contorno(c);
      const nuvem = [[-0.95, -1.15, 0.72], [0.95, -1.15, 0.72], [-0.45, -1.75, 0.8], [0.45, -1.75, 0.8], [0, -1.5, 0.9]];
      c.lineWidth = 4.4; c.beginPath(); for (const [x, y, r] of nuvem) { c.moveTo(x * s + r * s, y * s); c.arc(x * s, y * s, r * s, 0, TAU); } c.stroke();
      c.fillStyle = '#FFFFFF'; c.beginPath(); for (const [x, y, r] of nuvem) { c.moveTo(x * s + r * s, y * s); c.arc(x * s, y * s, r * s, 0, TAU); } c.fill();
      contorno(c); c.beginPath(); c.roundRect(-1.3 * s, -0.75 * s, 2.6 * s, 0.95 * s, 0.18 * s); c.fill(); c.stroke();
      c.beginPath(); for (const x of [-0.55, 0, 0.55]) { c.moveTo(x * s, -0.62 * s); c.lineTo(x * s, 0.06 * s); } c.lineWidth = 1.2; c.stroke();
      c.restore();
    }
    if (VESTE === 'fone') {   // fone com microfone: arco por cima e conchas nas laterais
      const l = P([-G - 0.1, 0.25, 0.1]), r = P([G + 0.1, 0.25, 0.1]), topo = P([0, G + 1.25, 0]);
      c.save(); contorno(c);
      c.lineWidth = 6.2; c.beginPath(); c.moveTo(l.X, l.Y); c.quadraticCurveTo(topo.X, topo.Y - s * 1.1, r.X, r.Y); c.stroke();
      c.lineWidth = 3.4; c.strokeStyle = rgb(DEEP); c.stroke();
      const concha = (p) => { contorno(c); c.fillStyle = rgb(DEEP); c.beginPath(); c.roundRect(p.X - 0.42 * s, p.Y - 0.8 * s, 0.84 * s, 1.6 * s, 0.4 * s); c.fill(); c.stroke(); };
      const boca = P([-0.9, -1.55, G + 0.15]);
      contorno(c); c.lineWidth = 2.6; c.beginPath(); c.moveTo(l.X, l.Y + 0.5 * s); c.quadraticCurveTo(l.X + 0.1 * s, boca.Y + 0.2 * s, boca.X, boca.Y); c.stroke();
      concha(l); concha(r);
      contorno(c); c.fillStyle = rgb(DEEP); c.beginPath(); c.arc(boca.X, boca.Y, 0.3 * s, 0, TAU); c.fill(); c.stroke();
      c.restore();
    }
    if (VESTE === 'oculos') noRosto(c, (cc) => {   // óculos redondos sobre os olhos + lápis atrás da "orelha"
      const eo = smooth(op * 1.4), gx = lerp(10.3, 7.8, eo), y = lerp(-1.5, 0, eo), r = lerp(8.4, 6.4, eo);
      cc.save(); cc.lineWidth = 2.3; cc.strokeStyle = rgb(CREAM); cc.lineCap = 'round';
      cc.fillStyle = 'rgba(255,255,255,0.12)';
      for (const sx of [-1, 1]) { cc.beginPath(); cc.arc(sx * gx, y, r, 0, TAU); cc.fill(); cc.stroke(); }
      cc.beginPath(); cc.moveTo(-gx + r * 0.75, y - r * 0.55); cc.quadraticCurveTo(0, y - r * 0.95, gx - r * 0.75, y - r * 0.55); cc.stroke();
      for (const sx of [-1, 1]) { cc.beginPath(); cc.moveTo(sx * (gx + r), y - 1); cc.lineTo(sx * (gx + r + 9), y - 2.5); cc.stroke(); }
      cc.restore();
    });
  }

  // ---------- vida da instância ----------
  let warm = Math.round((o.warm || 0) * 60);
  const vida = {
    canvas, ico: o.ico || null, visivel: true, vivo: true, congelado: !!o.congelar, DPR: 1,
    get ACT() { return ACT; },
    trocar(nome) { return carregar(nome).then(() => { const def = REG[nome]; if (!def || !vida.vivo) return; ACT = def; DUR = def.dur || 6; T = 0; t = 0; tPrev = -1;
      if (def.titulo && o.titulo) document.title = def.titulo;
      for (; warm > 0; warm--) vida.tick(1 / 60); }); },
    fundo(h) { const c = hex(h); if (c) for (let i = 0; i < 3; i++) BG_ALVO[i] = c[i]; },
    veste(v) { VESTE = v || null; },
    olhar(pt) { if (pt) { mx = pt[0]; my = pt[1]; hover = true; } else hover = false; },
    reagir() { T += DUR - t; },   // recomeça a ação
    tick(dt) {
      if (!ACT) return;
      T += dt; tPrev = t; t = T % DUR;
      const h = ACT.humor ? ACT.humor(t, A) : 0;
      if (h !== si) { si = h; st = 0; enter(si); } st += dt;
      if (ACT.passo) ACT.passo(dt, t, A);
      LX = clamp((mx - 0.5) * 2.4, -1, 1); LY = clamp((my - 0.5) * 2.4, -1, 1);
      eyeUpdate(dt); update(dt);
      for (let i = 0; i < 3; i++) BG[i] += (BG_ALVO[i] - BG[i]) * Math.min(1, dt * 5);
    },
    paint() {
      if (!ACT) return;
      const px = Math.max(2, Math.round(canvas.clientWidth * vida.DPR));
      if (canvas.width !== px || canvas.height !== px) canvas.width = canvas.height = px;
      const pinta = (ctx, px, small) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
        const k = small ? px / 100 * 1.1 : px / (100 * EXT);
        ctx.setTransform(k, 0, 0, k, px / 2 - 50 * k, px / 2 - 50 * k);
        if (!small && ACT.atras) { ctx.save(); ACT.atras(ctx, t, A); ctx.restore(); }
        if (!small) { setRot(yaw.v, pitch.v, roll.v); vesteAtras(ctx); }
        draw(ctx, small, k / vida.DPR);
        if (!small) vesteFrente(ctx);
        if (!small && ACT.frente) { ctx.save(); ACT.frente(ctx, t, A); ctx.restore(); }
      };
      pinta(vida.ctx, canvas.width, false);
      if (vida.ico) { const ip = Math.round(24 * vida.DPR); if (vida.ico.width !== ip) vida.ico.width = vida.ico.height = ip; pinta(vida.icx, ip, true); }
    },
  };
  vida.ctx = canvas.getContext('2d'); vida.icx = vida.ico && vida.ico.getContext('2d');
  return vida;
  }
  // ======================= fim da instância =======================

  // ---------- registro de ações e fábrica ----------
  const REG = {}, PEND = {}, INST = [];
  const BASE = (() => { const s = document.currentScript?.src || location.href; return s.slice(0, s.lastIndexOf('/') + 1); })();
  const nomeDe = (src) => (String(src).match(/acoes\/([\w-]+)\.js/) || [])[1];
  function carregar(nome) {
    nome = String(nome).replace(/[^\w-]/g, '');
    if (REG[nome]) return Promise.resolve();
    return PEND[nome] || (PEND[nome] = new Promise((ok, erro) => {
      const sc = document.createElement('script'); sc.src = BASE + 'acoes/' + nome + '.js';
      sc.onload = () => ok(); sc.onerror = () => { delete PEND[nome]; erro(new Error('ação não encontrada: ' + nome)); };
      document.head.appendChild(sc);
    }));
  }
  // as ações chamam Pacioli.acao(def); o nome vem do arquivo que está rodando
  window.Pacioli = { acao(def) { const n = nomeDe(document.currentScript?.src || ''); if (n) REG[n] = def; } };

  const visto = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
    for (const e of es) { const v = INST.find((x) => x.canvas === e.target && x.vivo); if (v) v.visivel = e.isIntersecting; e.target.dataset.vivo = e.isIntersecting ? '1' : '0'; }
  }, { rootMargin: '0px' }) : null;
  let rodando = false, antes = 0;
  function laco(agora) {
    requestAnimationFrame(laco);
    if (document.hidden) { antes = agora; return; }   // aba escondida: não acumula tempo
    const dt = Math.min(0.04, (agora - antes) / 1000); antes = agora;
    for (const v of INST) {
      if (!v.vivo || !v.visivel) continue;
      if (!v.congelado) v.tick(dt);
      v.paint(); MOTOR._quadros[v.id]++;
    }
  }
  const MOTOR = window.PacioliMotor = {
    _quadros: [],
    carregar,
    criar(canvas, o = {}) {
      const v = instancia(canvas, o); v.id = INST.length; INST.push(v); MOTOR._quadros[v.id] = 0;
      v.DPR = Math.max(1, Math.min(o.dpr || 2, window.devicePixelRatio || 1));
      if (visto) { v.visivel = false; visto.observe(canvas); }
      if (!o.semMouse) {   // mouse por cima do próprio canvas: olhos seguem; sair solta; clique recomeça
        canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(), w = r.width / EXT;
          v.olhar([0.5 + (e.clientX - (r.left + r.width / 2)) / w, 0.5 + (e.clientY - (r.top + r.height / 2)) / w]); });
        canvas.addEventListener('pointerleave', () => v.olhar(null));
      }
      if (!o.semClique) canvas.addEventListener('pointerdown', () => v.reagir());
      if (o.acao) v.trocar(o.acao);
      if (!rodando) { rodando = true; antes = performance.now(); requestAnimationFrame(laco); }
      return {
        trocar: (a) => v.trocar(a), fundo: (h) => v.fundo(h), veste: (x) => v.veste(x), olhar: (p) => v.olhar(p), reagir: () => v.reagir(),
        destruir() { v.vivo = false; canvas.dataset.vivo = '0'; if (visto) visto.unobserve(canvas); },
      };
    },
  };
})();
