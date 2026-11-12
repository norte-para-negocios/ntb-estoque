// Contando inventário: o Pacioli sobe, solta duas mãos e toca as caixas da prateleira uma a uma; cada toque
// acende a caixa e o contador ao lado sobe. No fim o total fica teal com um check, e as mãos voltam ao corpo.
(() => {
  const DUR = 8.5;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  // quadros-chave [tempo, x, y, giro]; entre eles, vai e volta suave
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const BX = [6, 28, 50, 72, 94], TOPO = 80, BW = 16, BH = 14;        // caixas na prateleira
  const TOQ = [1.6, 2.4, 3.2, 4.0, 4.8];                              // quando cada caixa é tocada
  const QUEM = ['e', 'e', 'e', 'd', 'd'];
  // mão sobre a caixa: chega por cima, desce até encostar, sobe
  const toque = (i) => [[TOQ[i] - 0.3, BX[i], TOPO - 12, 0], [TOQ[i], BX[i], TOPO - 5, 0], [TOQ[i] + 0.25, BX[i], TOPO - 12, 0]];
  const ME = [[0.9, 34, 64, 0], ...toque(0), ...toque(1), ...toque(2), [5.2, 30, 66, 0], [6.6, 30, 66, 0], [7.0, 34, 64, 0]];
  const MD = [[0.9, 66, 64, 0], [3.0, 66, 64, 0], ...toque(3), ...toque(4), [5.4, 70, 66, 0], [6.6, 70, 66, 0], [7.0, 66, 64, 0]];
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.6) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 6.6) / 0.45)));
  const contagem = (t) => TOQ.filter((x) => t >= x).length;
  const FIM = 5.4;                                                    // total fechado
  Pacioli.acao({
    titulo: 'Contando inventário', dur: DUR,
    humor: (t) => t > FIM && t < 6.9 ? 2 : t > 0.5 && t < FIM ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.2, 7.9)));
      b.escala = A.lerp(1, 0.6, s); b.y = A.lerp(b.y, -20, s);
      if (A.humor === 1) { b.pitch = 0.32; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }              // pose calma de começo e fim
      if (A.humor !== 1) return;
      const quem = t < 3.5 ? 'e' : 'd', p = pos(quem, t);
      o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = 0.9; o.lid = 0.2; o.kL = 140; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 2.36 + 0.06 * Math.sin(A.T * 5), s: 1, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] - 2.36 + 0.06 * Math.sin(A.T * 5 + 1), s: 1, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 7.3, 7.8)));
      if (ap <= 0.01) return;
      A.linha(c, [[-12, TOPO + BH], [112, TOPO + BH]], { a: 0.45 * ap, lw: 1.6 });
      for (let i = 0; i < BX.length; i++) {
        const k = t < 7.3 ? A.seg01(t, TOQ[i], TOQ[i] + 0.15) : 1, fl = Math.exp(-Math.max(0, t - TOQ[i]) * 3) * (t >= TOQ[i] ? 1 : 0);
        c.save(); c.translate(BX[i], TOPO + BH); c.scale(ap, ap * (1 - 0.08 * fl));
        c.lineWidth = 1.8; c.lineJoin = 'round'; c.strokeStyle = A.rgb(A.cor.CREAM);
        const ok = A.seg01(t, FIM + i * 0.06, FIM + i * 0.06 + 0.2);     // no fim, todas viram teal em onda
        c.fillStyle = k > 0 ? A.rgb(A.mix(A.cor.AMBER, A.cor.TEAL, ok)) : A.rgb(A.cor.BG);
        c.beginPath(); c.rect(-BW / 2, -BH, BW, BH); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(-BW / 2, -BH + 4); c.lineTo(BW / 2, -BH + 4); c.lineWidth = 1.1; c.strokeStyle = A.rgb(A.cor.CREAM, 0.55); c.stroke();
        c.restore();
      }
    },
    frente(c, t, A) {
      const ap = A.seg01(t, 0.6, 1.0) * (1 - A.easeIn(A.seg01(t, 7.3, 7.8)));
      if (ap <= 0.01) return;
      // contador: visor ao lado do mascote
      const n = contagem(t), ult = n ? TOQ[n - 1] : -9, pop = 1 + 0.25 * A.arco(A.seg01(t, ult, ult + 0.3));
      const fim = A.seg01(t, FIM, FIM + 0.3);
      const X = 99, Y = 30;
      c.save(); c.globalAlpha = ap;
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.mix(A.cor.CREAM, A.cor.TEAL, fim)); c.lineWidth = 1.8;
      c.beginPath(); c.roundRect(X - 12, Y - 11, 24, 22, 4); c.fill(); c.stroke();
      c.translate(X, Y + 0.6); c.scale(pop, pop);
      A.texto(c, String(n), 0, 0, { tam: 15, peso: 600, monoNum: true, cor: A.mix(A.cor.CREAM, A.cor.TEAL, fim) });
      c.restore();
      A.texto(c, 'caixas', X, Y + 16, { tam: 3.8, peso: 500, a: 0.7 * ap });
      const ok = A.seg01(t, FIM, FIM + 0.3) * (1 - A.seg01(t, 7.2, 7.5));
      if (ok > 0) {
        c.save(); c.translate(X, Y - 20); c.scale(A.back(ok), A.back(ok));
        c.fillStyle = A.rgb(A.cor.TEAL); c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
        A.linha(c, [[-2.8, 0.2], [-0.7, 2.3], [3, -2.1]], { lw: 1.7 });
        c.restore();
      }
    },
  });
})();
