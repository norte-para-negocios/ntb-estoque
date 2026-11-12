// Fila de OPs: cartões de OP passam numa esteira por baixo do Pacioli. A mão direita segura o carimbo teal
// e carimba cada um; a OP 42 é recusada: a mão esquerda carimba em âmbar, pega o cartão e o leva para o fim
// da fila. Quando a 42 volta, passa no teal. Fila vazia: olhos ^ ^, mãos voltam, cena some.
(() => {
  const DUR = 8.6;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const SX = 50, CY = 86, D = 25, BY = 95;          // estação de carimbo, centro do cartão, passo da esteira, esteira
  const C = [0, 1, 2, 3, 4].map(k => 1.0 + 1.2 * k); // início de cada ciclo (carimbo + avanço)
  const REJ = 1;                                     // ciclo da recusa
  // fila: posição q na esteira; a OP 42 ocupa q=1 e, depois de recusada, q=4
  const FILA = ['41', '42', '43', '44', '42'];
  const esteira = (t, A) => C.reduce((s, c) => s + A.easeInOut(A.seg01(t, c + 0.6, c + 1.1)), 0);
  const xq = (q, t, A) => SX + (esteira(t, A) - q) * D;
  // mão direita (carimbo teal): desce e sobe em todo ciclo menos o da recusa
  const MD = [[0.9, 68, 62, 0]];
  C.forEach((c, k) => { if (k === REJ) return; MD.push([c, 68, 62, 0], [c + 0.15, SX + 2, 64, 0], [c + 0.3, SX + 2, 80, 0], [c + 0.38, SX + 2, 80, 0], [c + 0.5, SX + 2, 64, 0], [c + 0.65, 68, 62, 0]); });
  // mão esquerda (carimbo âmbar): carimba a 42, pega e leva para o fim da fila
  const c1 = C[REJ];
  const ME0 = [[0.9, 30, 62, 0], [c1, 30, 62, 0], [c1 + 0.15, SX - 2, 64, 0], [c1 + 0.3, SX - 2, 80, 0], [c1 + 0.4, SX - 2, 80, 0], [c1 + 0.5, SX, 72, 0]];
  const LEVA0 = c1 + 0.5, LEVA1 = c1 + 1.15;
  const carregada = (t, A) => {                     // posição da OP 42 enquanto é levada
    const u = A.easeInOut(A.seg01(t, LEVA0, LEVA1)), x1 = xq(4, LEVA1, A);
    return { x: A.lerp(SX, x1, u), y: CY - 24 * Math.sin(Math.PI * u) };
  };
  const ME1 = (A) => [[LEVA1, xq(4, LEVA1, A), CY - 14, 0], [LEVA1 + 0.15, xq(4, LEVA1, A), CY - 18, 0], [LEVA1 + 0.6, 30, 62, 0]];
  const posE = (t, A) => {
    if (t < LEVA0) return kf(ME0, t);
    if (t < LEVA1) { const p = carregada(t, A); return [t, p.x, p.y - 14, -0.2 * Math.sin(Math.PI * A.seg01(t, LEVA0, LEVA1))]; }
    return kf(ME1(A), t);
  };
  const posD = (t) => kf(MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.6) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - (C[4] + 0.7)) / 0.5)));
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.7, 8.5)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.3, 7.8)));
  function carimbo(c, A, cor, x, y) {                // a almofada embaixo da ponta da mão
    c.save(); c.translate(x, y); c.lineWidth = 1.4; c.strokeStyle = A.rgb(A.cor.CREAM); c.fillStyle = A.rgb(cor);
    c.beginPath(); c.roundRect(-5, 0, 10, 3.6, 1); c.fill(); c.stroke(); c.restore();
  }
  function marca(c, A, cor, ok, x, y, s) {           // a impressão no cartão
    c.save(); c.translate(x, y); c.rotate(-0.12); c.scale(s, s); c.lineWidth = 1.5; c.strokeStyle = A.rgb(cor);
    c.beginPath(); c.roundRect(-4.5, -4, 9, 8, 1.5); c.stroke();
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 1.7; c.beginPath();
    if (ok) { c.moveTo(-2.2, 0.1); c.lineTo(-0.5, 1.8); c.lineTo(2.4, -1.6); } else { c.moveTo(-2, -2); c.lineTo(2, 2); c.moveTo(2, -2); c.lineTo(-2, 2); }
    c.stroke(); c.restore();
  }
  function cartao(c, A, n, x, y, t, q) {
    c.save(); c.translate(x, y);
    c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.8;
    c.beginPath(); c.roundRect(-11, -8, 22, 16, 2.5); c.fill(); c.stroke();
    A.texto(c, 'OP ' + n, 0, -3.6, { tam: 4.2, peso: 600 });
    // marca: teal no ciclo dela; a 42 leva âmbar na 1ª passada (q=1) e teal na 2ª (q=4)
    const ts = C[q] + 0.3;
    if (t >= ts) marca(c, A, q === REJ ? A.cor.AMBER : A.cor.TEAL, q !== REJ, 0, 3.4, A.back(A.seg01(t, ts, ts + 0.15)));
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Fila de OPs', dur: DUR,
    humor: (t) => t > C[4] + 0.6 && t < 7.4 ? 2 : t > 0.6 && t <= C[4] + 0.6 ? 1 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.55, s); b.y = A.lerp(b.y, -20, s);
      if (A.humor === 1) { b.pitch = 0.3; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.3; },
    olhos(o, t, A) {
      if (A.humor !== 1) return;
      o.lx = 0; o.ly = 0.9; o.lid = 0.25; o.kL = 120; o.cL = 16;
      if (t > c1 + 0.3 && t < LEVA1 + 0.2) { const p = posE(t, A); o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = A.clamp((p[2] - 30) / 40, -0.5, 1); o.dy = -3; o.lid = 0; }
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = posE(t, A), d = posD(t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3], s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3], s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      // esteira: duas linhas e roletes que andam junto
      const sh = (esteira(t, A) * D) % 12;
      c.save(); c.globalAlpha = ap;
      A.linha(c, [[-24, BY], [124, BY]], { lw: 2 }); A.linha(c, [[-24, BY + 6], [124, BY + 6]], { lw: 2 });
      for (let x = -24 + sh; x < 124; x += 12) { c.beginPath(); c.arc(x, BY + 3, 1.3, 0, Math.PI * 2); c.fillStyle = A.rgb(A.cor.CREAM, 0.5); c.fill(); }
      c.restore();
      // cartões na esteira (a 42 some da posição 1 quando é levantada)
      for (let q = 0; q < FILA.length; q++) {
        if (q === REJ && t >= LEVA0) continue;
        if (q === 4 && t < LEVA1) continue;
        const x = xq(q, t, A); if (x < -40 || x > 140) continue;
        c.save(); c.translate(x, CY); c.scale(ap, ap); c.translate(-x, -CY); cartao(c, A, FILA[q], x, CY, t, q); c.restore();
      }
    },
    frente(c, t, A) {
      const m = mix(t); if (m <= 0.5) return;
      // OP 42 no ar, levada pela mão esquerda
      if (t >= LEVA0 && t < LEVA1) { const p = carregada(t, A); cartao(c, A, '42', p.x, p.y, t, REJ); }
      // carimbos embaixo das mãos
      const a = A.seg01(m, 0.5, 1);
      if (a > 0) {
        const d = posD(t), e = posE(t, A);
        c.save(); c.globalAlpha = a;
        carimbo(c, A, A.cor.TEAL, d[1], d[2] + 4.5);
        if (t < LEVA0 - 0.05 || t > LEVA1 + 0.3) carimbo(c, A, A.cor.AMBER, e[1], e[2] + 4.5);
        c.restore();
      }
    },
  });
})();
