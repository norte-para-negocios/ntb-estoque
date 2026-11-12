// Produzindo PI: o Pacioli sobe e encolhe; a mão esquerda pega tomate e folha na prateleira e solta na panela,
// a direita mergulha e mexe (a mão é a colher), sobe vapor, e as duas mãos levam conchas da panela para
// três potes etiquetados "PI" (produto intermediário). Potes cheios: olhos ^ ^ e volta ao centro.
(() => {
  const DUR = 9;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const PX = 33, PY = 76;                        // boca da panela
  const POTES = [74, 91, 108], PB = 96;           // potes: x e fundo
  const PRAT = [[-6, 'tomate', 1.3], [6, 'folha', 2.55]];
  // mão esquerda: 2 viagens à prateleira, depois enche o pote do meio
  const ME = [[0.9, 30, 58, 0], [1.3, -6, 64, -0.3], [1.45, -6, 64, -0.3], [1.95, 29, 60, 0.1], [2.15, 29, 60, 0.1],
    [2.55, 6, 64, -0.3], [2.7, 6, 64, -0.3], [3.2, 37, 60, 0.1], [3.4, 37, 60, 0.1], [4.1, 26, 60, 0],
    [5.6, 26, 60, 0], [5.95, 28, 72, 0], [6.1, 28, 72, 0], [6.55, 91, 70, 0.3], [6.8, 91, 70, 0.3], [7.3, 30, 58, 0]];
  // mão direita: mexe a panela, depois enche o primeiro e o último pote
  const MD0 = [[0.9, 70, 58, 0], [3.2, 70, 58, 0], [3.55, PX, PY - 2, 0], [3.6, PX, PY - 2, 0]];
  const MD1 = [[4.95, PX, PY - 2, 0], [5.1, 40, 72, 0], [5.5, 74, 70, 0.3], [5.75, 74, 70, 0.3], [6.1, 40, 72, 0], [6.25, 40, 72, 0],
    [6.75, 108, 70, 0.3], [7.0, 108, 70, 0.3], [7.4, 70, 58, 0]];
  const pos = (m, t) => {
    if (m === 'e') return kf(ME, t);
    if (t < 3.6) return kf(MD0, t);
    if (t < 4.95) {                                // mexendo: círculo achatado dentro da panela
      const a = (t - 3.6) * 7.5, r = A_.seg01(t, 3.6, 3.8) * (1 - A_.seg01(t, 4.75, 4.95));
      return [t, PX + 9 * Math.sin(a) * r, PY - 2 + 2.6 * Math.cos(a) * r, -0.35 * Math.cos(a) * r];
    }
    return kf(MD1, t);
  };
  // conchas: mão, sai da panela, despeja em, pote
  const CONCHA = [{ mao: 'd', sai: 5.1, desp: 5.55, pote: 0 }, { mao: 'e', sai: 6.1, desp: 6.6, pote: 1 }, { mao: 'd', sai: 6.25, desp: 6.8, pote: 2 }];
  let A_;
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.6) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 7.3) / 0.5)));
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 8.1, 8.85)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.9, 8.4)));
  function icone(c, A, tipo, x, y, s = 1) {
    c.save(); c.translate(x, y); c.scale(s, s); c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round'; c.strokeStyle = A.rgb(A.cor.CREAM);
    if (tipo === 'tomate') {
      c.fillStyle = A.rgb(A.cor.RED); c.beginPath(); c.ellipse(0, 0.5, 5, 4.4, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = A.rgb(A.cor.GREEN); c.beginPath(); c.moveTo(-2.2, -3.4); c.lineTo(0, -5.6); c.lineTo(2.2, -3.4); c.closePath(); c.fill(); c.stroke();
    }
    if (tipo === 'folha') {
      c.fillStyle = A.rgb(A.cor.GREEN); c.beginPath(); c.moveTo(-5.5, 1); c.quadraticCurveTo(0, -5.5, 5.5, 0); c.quadraticCurveTo(0, 4.5, -5.5, 1); c.fill(); c.stroke();
    }
    if (tipo === 'gota') { c.fillStyle = A.rgb(A.cor.AMBER); c.beginPath(); c.arc(0, 0, 2.8, 0, Math.PI * 2); c.fill(); c.stroke(); }
    c.restore();
  }
  // nível do caldo: sobe com cada ingrediente, desce um pouco a cada concha
  const nivel = (t, A) => 0.5 * A.seg01(t, 2.15, 2.5) + 0.5 * A.seg01(t, 3.4, 3.75) - 0.25 * (A.seg01(t, 5.0, 5.2) + A.seg01(t, 6.0, 6.2) + A.seg01(t, 6.15, 6.35));
  Pacioli.acao({
    titulo: 'Produzindo PI', dur: DUR,
    humor: (t) => t > 7.2 && t < 8.2 ? 2 : t > 0.6 && t < 7.2 ? 1 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.55, s); b.y = A.lerp(b.y, -22, s);
      if (A.humor === 1) { b.pitch = 0.32; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.3; },
    olhos(o, t, A) {
      A_ = A; if (A.humor !== 1) return;
      const p = t < 3.5 ? pos('e', t) : t < 6.0 ? pos('d', t) : t < 6.7 ? pos('e', t) : pos('d', t);
      o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = 0.9; o.lid = 0.25; o.kL = 120; o.cL = 16;
    },
    maos(H, t, A) {
      A_ = A; const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 0.08 * Math.sin(A.T * 6), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3], s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      A_ = A; const ap = cena(t, A); if (ap <= 0.01) return;
      // prateleira da esquerda
      A.linha(c, [[-14, 70], [12, 70]], { a: 0.35 * ap });
      for (const [x, tipo, pega] of PRAT) if (t < pega) icone(c, A, tipo, x, 65, ap);
      // vapor (por trás da panela)
      const vap = A.seg01(t, 3.7, 4.2) * (1 - A.seg01(t, 6.6, 7.4)) * ap;
      if (vap > 0) for (let k = 0; k < 3; k++) {
        const ph = (A.T * 0.8 + k * 0.33) % 1, x = PX - 9 + k * 9;
        const w = (y) => x + 2.2 * Math.sin(y * 0.35 + k * 2 + A.T * 2);
        const y0 = PY - 5 - ph * 18, pts = []; for (let j = 0; j <= 4; j++) { const y = y0 - j * 2.5; pts.push([w(y), y]); }
        A.linha(c, pts, { a: Math.sin(Math.PI * ph) * vap * 0.75, lw: 1.5 });
      }
      // panela
      c.save(); c.translate(PX, PY + 9); c.scale(ap, ap); c.translate(-PX, -(PY + 9));
      c.lineWidth = 2.2; c.strokeStyle = A.rgb(A.cor.CREAM); c.fillStyle = A.rgb(A.cor.BG);
      c.beginPath(); c.moveTo(PX - 18, PY); c.lineTo(PX - 16, PY + 17); c.quadraticCurveTo(PX - 16, PY + 20, PX - 13, PY + 20);
      c.lineTo(PX + 13, PY + 20); c.quadraticCurveTo(PX + 16, PY + 20, PX + 16, PY + 17); c.lineTo(PX + 18, PY); c.fill(); c.stroke();
      A.linha(c, [[PX - 18, PY + 4], [PX - 23, PY + 4]], { lw: 2.2 }); A.linha(c, [[PX + 18, PY + 4], [PX + 23, PY + 4]], { lw: 2.2 });
      const nv = A.clamp(nivel(t, A), 0, 1);
      c.beginPath(); c.ellipse(PX, PY, 18, 3.6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      if (nv > 0.02) {                                   // caldo: superfície âmbar que sobe com o nível
        c.fillStyle = A.rgb(A.cor.AMBER); c.lineWidth = 1;
        c.beginPath(); c.ellipse(PX, PY + 0.4, 15.5 * A.clamp(nv * 3, 0, 1), 2.4 * A.clamp(nv * 3, 0, 1), 0, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      // potes com etiqueta PI
      for (const [k, x] of POTES.entries()) {
        const s = A.back(A.seg01(t, 0.5 + k * 0.08, 1.0 + k * 0.08)) * (1 - A.easeIn(A.seg01(t, 7.9, 8.4)));
        if (s <= 0.01) continue;
        const ch = A.easeOut(A.seg01(t, CONCHA[k].desp + 0.1, CONCHA[k].desp + 0.45));
        c.save(); c.translate(x, PB); c.scale(s, s);
        c.lineWidth = 2; c.strokeStyle = A.rgb(A.cor.CREAM); c.fillStyle = A.rgb(A.cor.BG);
        c.beginPath(); c.roundRect(-6, -18, 12, 18, 2.5); c.fill();
        if (ch > 0) { c.save(); c.clip(); c.fillStyle = A.rgb(A.cor.AMBER); c.fillRect(-6, -14 * ch, 12, 14 * ch); c.restore(); }
        c.stroke();
        c.beginPath(); c.roundRect(-7, -21.5, 14, 3.5, 1); c.fill(); c.stroke();                 // tampa
        c.fillStyle = A.rgb(A.cor.BG); c.lineWidth = 1.2; c.beginPath(); c.roundRect(-4.6, -11.5, 9.2, 6, 1); c.fill(); c.stroke();   // etiqueta
        A.texto(c, 'PI', 0, -8.4, { tam: 4, peso: 700 });
        c.restore();
      }
    },
    frente(c, t, A) {
      A_ = A;
      // ingredientes: na mão, depois caem na panela
      for (const [x, tipo, pega] of PRAT) {
        const solta = tipo === 'tomate' ? 2.15 : 3.4;
        if (t < pega) continue;
        if (t < solta) { const p = pos('e', t); icone(c, A, tipo, p[1], p[2] + 7); continue; }
        const u = A.seg01(t, solta, solta + 0.3); if (u >= 1) continue;
        const p = pos('e', solta); icone(c, A, tipo, p[1], A.lerp(p[2] + 7, PY, A.easeIn(u)), 1 - 0.5 * A.easeIn(u));
      }
      // respingo quando cai
      for (const tq of [2.45, 3.7]) {
        const u = A.seg01(t, tq, tq + 0.35); if (u <= 0 || u >= 1) continue;
        for (const s of [-1, 1]) icone(c, A, 'gota', PX + s * (3 + 7 * u), PY - 2 - 8 * A.arco(u), 0.55);
      }
      // conchas: gota amarela embaixo da mão, cai no pote
      for (const g of CONCHA) {
        if (t < g.sai || t > g.desp + 0.3) continue;
        if (t < g.desp) { const p = pos(g.mao, t); icone(c, A, 'gota', p[1], p[2] + 6); }
        else { const u = A.seg01(t, g.desp, g.desp + 0.3); icone(c, A, 'gota', POTES[g.pote], A.lerp(76, PB - 12, A.easeIn(u)), 1 - 0.4 * u); }
      }
    },
  });
})();
