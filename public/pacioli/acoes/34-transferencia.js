// Transferência: duas lojas nas laterais. Uma caixa sai da loja da esquerda, a mão esquerda leva em arco até o meio,
// passa para a direita, que entrega na outra loja; duas vezes. Os números das lojas mudam (8→6, 2→4) e ele fica contente.
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
  const LX = [-1, 101], LB = 98, PORTA = 93.5, D = 18;          // lojas: centro x, chão, altura da caixa na porta
  const S = [1.3, 3.6];                              // começo de cada transferência
  const ME = [[0.9, 32, 70, 0]], MD = [[0.9, 68, 70, 0]];
  for (const s of S) {
    ME.push([s + 0.4, LX[0] + D, PORTA - 9, 0], [s + 0.55, LX[0] + D, PORTA - 9, 0], [s + 0.95, 26, 62, 0], [s + 1.3, 45, 70, 0], [s + 1.45, 45, 70, 0], [s + 1.9, 32, 70, 0]);
    MD.push([s + 1.0, 68, 70, 0], [s + 1.3, 55, 70, 0], [s + 1.45, 55, 70, 0], [s + 1.8, 74, 62, 0], [s + 2.15, LX[1] - D, PORTA - 9, 0], [s + 2.3, LX[1] - D, PORTA - 9, 0], [s + 2.6, 68, 70, 0]);
  }
  ME.push([6.6, 32, 70, 0]); MD.push([6.6, 68, 70, 0]);
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.8) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 6.5) / 0.45)));
  const OK = S[1] + 2.4;
  // caixa da transferência k no tempo t: { x, y, s } ou null
  function caixa(k, t, A) {
    const s = S[k];
    if (t < s || t > s + 2.45) return null;
    if (t < s + 0.4) { const u = A.easeOut(A.seg01(t, s, s + 0.4)); return { x: A.lerp(LX[0], LX[0] + D, u), y: PORTA, s: 1, chao: 1 }; }   // sai de dentro da loja
    if (t < s + 0.55) return { x: LX[0] + D, y: PORTA, s: 1, chao: 1 };
    if (t < s + 1.3) { const p = pos('e', t); return { x: p[1], y: p[2] + 9, s: 1 }; }
    if (t < s + 1.45) { const u = A.easeInOut(A.seg01(t, s + 1.3, s + 1.45)), e = pos('e', t), d = pos('d', t); return { x: A.lerp(e[1], d[1], u), y: A.lerp(e[2], d[2], u) + 9, s: 1 }; }  // passa de mão
    if (t < s + 2.15) { const p = pos('d', t); return { x: p[1], y: p[2] + 9, s: 1 }; }
    const u = A.easeIn(A.seg01(t, s + 2.15, s + 2.45)); return { x: A.lerp(LX[1] - D, LX[1], u), y: PORTA, s: 1, chao: 1 };            // entra na outra
  }
  const nE = (t) => 8 - S.filter((s) => t >= s + 0.2).length, nD = (t) => 2 + S.filter((s) => t >= s + 2.3).length;
  function loja(c, A, x, n, ultimo, t, ap, ok) {
    c.save(); c.translate(x, LB); c.scale(ap, ap);
    c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath(); c.rect(-11, -15, 22, 15); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-14, -15); c.lineTo(0, -26); c.lineTo(14, -15); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.rect(-3.5, -9, 7, 9); c.stroke();
    const pop = 1 + 0.3 * A.arco(A.seg01(t, ultimo, ultimo + 0.3));
    c.translate(0, -36); c.scale(pop, pop);
    A.texto(c, String(n), 0, 0.5, { tam: 10, monoNum: true, cor: A.mix(A.cor.CREAM, A.cor.TEAL, ok) });
    c.restore();
  }
  function cx(c, A, b) {
    c.save(); c.translate(b.x, b.y); c.scale(b.s, b.s);
    c.fillStyle = A.rgb(A.cor.AMBER); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.6; c.lineJoin = 'round';
    c.beginPath(); c.rect(-5, -4.5, 10, 9); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-5, -1.5); c.lineTo(5, -1.5); c.strokeStyle = A.rgb(A.cor.BG, 0.7); c.lineWidth = 1; c.stroke();
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Transferência', dur: DUR,
    humor: (t) => t > OK && t < 7.6 ? 2 : t > 0.5 && t < OK ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.5, 8.3)));
      b.escala = A.lerp(1, 0.58, s); b.y = A.lerp(b.y, -18, s);
      if (A.humor === 1) { b.pitch = 0.3; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (A.humor !== 1) return;
      const b = caixa(0, t, A) || caixa(1, t, A); const x = b ? b.x : 50, y = b ? b.y : 80;
      o.lx = A.clamp((x - 50) / 42, -1, 1); o.ly = A.clamp((y - 32) / 45, -0.4, 1); o.lid = 0.2; o.kL = 140; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 2.36 + 0.06 * Math.sin(A.T * 5), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] - 2.36 + 0.06 * Math.sin(A.T * 5 + 1), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 7.4, 7.9)));
      if (ap <= 0.01) return;
      const ok = A.seg01(t, OK, OK + 0.3) * (1 - A.seg01(t, 7.1, 7.4));
      A.linha(c, [[-14, LB], [114, LB]], { a: 0.3 * ap, lw: 1.2 });
      // trilha pontilhada do arco
      const tr = A.seg01(t, 1.0, 1.4) * (1 - A.seg01(t, 6.6, 7.0));
      if (tr > 0) { c.save(); c.setLineDash([1.5, 3.5]); A.linha(c, [[LX[0] + D, 84], [28, 70], [50, 77], [72, 70], [LX[1] - D, 84]], { a: 0.28 * tr, lw: 1.2 }); c.restore(); }
      for (let k = 0; k < S.length; k++) { const b = caixa(k, t, A); if (b && b.chao) cx(c, A, b); }   // no chão: passa por trás da parede da loja
      const sE = S.filter((s) => t >= s + 0.2), sD = S.filter((s) => t >= s + 2.3);
      loja(c, A, LX[0], nE(t), sE.length ? sE[sE.length - 1] + 0.2 : -9, t, ap, 0);
      loja(c, A, LX[1], nD(t), sD.length ? sD[sD.length - 1] + 2.3 : -9, t, ap, ok);
    },
    frente(c, t, A) {
      for (let k = 0; k < S.length; k++) { const b = caixa(k, t, A); if (b && !b.chao) cx(c, A, b); }
    },
  });
})();
