// Cansado: fim de um dia longo. O Pacioli fica afundado, cabeça baixa, olhos meio fechados e tela mais escura.
// Uma mão sobe e enxuga a "testa" (passa pelo alto da tela, cai uma gotinha); depois ele boceja (estica,
// olhos apertados, boca abre na tela), solta o ar e continua vigiando, devagar.
(() => {
  const DUR = 8;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  // mão direita: sobe pela direita, passa pela testa da direita para a esquerda, volta
  const MD = [[0.9, 72, 70, 1.0], [1.35, 70, 28, 1.0], [1.55, 68, 26, 1.0], [2.05, 36, 24, 1.15], [2.35, 40, 27, 1.1], [2.8, 72, 70, 1.0]];
  const mixM = (t) => Math.min(1, Math.max(0, (t - 0.9) / 0.3)) * (1 - Math.min(1, Math.max(0, (t - 2.5) / 0.4)));
  const BOC = [3.2, 4.7];                                   // bocejo
  const boceja = (t, A) => A.arco(A.seg01(t, BOC[0], BOC[1]));
  const abreBoca = (t, A) => A.easeOut(A.seg01(t, BOC[0] + 0.2, BOC[0] + 0.7)) * (1 - A.easeInOut(A.seg01(t, BOC[1] - 0.6, BOC[1] - 0.1)));
  // olhar cansado (valores no plano do rosto): baixo e lento; durante a passada da mão, acompanha a mão
  function olhar(t, A) {
    const sm = A.smooth, wv = sm(A.seg01(t, 1.1, 1.4)) * (1 - sm(A.seg01(t, 2.3, 2.6)));
    const p = kf(MD, A.clamp(t, 1.2, 2.4));
    let lx = A.lerp(0.35 * Math.sin(t * 0.8), A.clamp((p[1] - 50) / 30, -1, 1), wv), ly = A.lerp(0.35, -0.4, wv), lid = A.lerp(0.5, 0.6, wv);
    let hh = 1 - 0.9 * Math.max(A.arco(A.seg01(t, 0.3, 0.75)), A.arco(A.seg01(t, 6.1, 6.8)));   // piscadas compridas
    let w = 8.5;
    const ys = sm(A.seg01(boceja(t, A), 0.1, 0.4));                             // bocejo: olhos apertados
    hh = A.lerp(hh, 0.14, ys); lid = A.lerp(lid, 0, ys); w = A.lerp(w, 11, ys); ly = A.lerp(ly, -0.2, ys); lx = A.lerp(lx, 0, ys);
    lid *= sm(A.seg01(hh, 0.15, 0.6));                                         // fechado: sem pálpebra
    return { lx, ly, lid, hh, w };
  }
  Pacioli.acao({
    titulo: 'Cansado', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const y = boceja(t, A);
      // afundado: mais baixo, um pouco menor, cabeça pendendo; o bocejo estica para cima
      b.y = 5 - 4 * y; b.escala = 0.95 + 0.06 * y + 0.006 * Math.sin(t * 1.4);
      b.pitch = 0.42 - 0.4 * y; b.yaw = 0.08 * Math.sin(t * 0.5); b.roll = 0.03 * Math.sin(t * 0.7) * (1 - y); b.k = 18;
    },
    petalas(PT, t, A) { const y = boceja(t, A); for (let i = 0; i < PT.length; i++) PT[i].t = Math.max(PT[i].t, 0.32 * y); },
    tela(cor, t, A) { return A.mix(cor, A.cor.DEEP, 0.35 * (1 - 0.5 * boceja(t, A))); },
    // olhos próprios, desenhados em frente() no plano do rosto: o motor só corta a pálpebra inclinada para
    // dentro (lê como bravo); aqui a pálpebra pesada cai para fora (lê como cansaço). Os olhos do motor viram
    // um pontinho (o.a = 0 pinta da cor do fundo) escondido embaixo dos nossos.
    olhos(o, t, A) {
      const e = olhar(t, A);
      o.a = 0; o.w = 2.4; o.h = 1.8; o.piscar = false; o.kL = 600; o.cL = 50; o.lid = 0;
      o.lx = e.lx; o.ly = e.ly + A.seg01(e.hh, 0.2, 1);   // pontinho desce para a parte visível do olho
    },
    maos(H, t, A) {
      const m = mixM(t); if (m <= 0) return;
      const p = kf(MD, t);
      H[A.TRIS[3]] = { x: p[1], y: p[2], rot: p[3], s: 1, mix: A.easeInOut(m) };
    },
    naTela(c, t, A) {
      // boca do bocejo: oval escuro que abre embaixo dos olhos
      const b = abreBoca(t, A);
      if (b > 0.01) {
        c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM, 0.9); c.lineWidth = 1.4;
        c.beginPath(); c.ellipse(0, 16, 4 + 2 * b, 1 + 7 * b, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    },
    frente(c, t, A) {
      // olhos cansados por cima dos do motor, na mesma geometria que ele usa (encolhe quando as pétalas abrem)
      A.noRosto(c, (c) => {
        const { lx, ly, lid, hh, w } = olhar(t, A);
        const eo = A.smooth(A.aberto * 1.4), k = A.lerp(1.05, 0.95, eo), sc = A.lerp(1, 0.86, eo);
        const cy = A.lerp(-1.5, 0, eo), gap = A.lerp(9.8, 7.4, eo) * k, sx = A.lerp(3.6, 2.2, eo) * k, sy = A.lerp(4, 2.2, eo) * k;
        c.fillStyle = A.rgb(A.cor.CREAM);
        for (const sd of [-1, 1]) {
          const ww = w * sc * k, x = sd * gap * (1 - 0.1 * Math.abs(lx)) + lx * sx, y = cy + ly * sy, h = Math.max(2.8, 20 * hh * sc * k), top = y - h / 2 + lid * h, d = 2.6 * lid;
          c.save();
          if (lid > 0.01) { c.beginPath(); c.moveTo(x - sd * ww, top - d); c.lineTo(x + sd * ww, top + d); c.lineTo(x + sd * ww, y + h); c.lineTo(x - sd * ww, y + h); c.closePath(); c.clip(); }
          c.beginPath(); c.roundRect(x - ww / 2, y - h / 2, ww, h, Math.min(ww, h) / 2); c.fill();
          c.restore();
        }
      });
      // gotinha que sai da testa no fim da passada e cai
      const u = A.seg01(t, 2.0, 2.8); if (u <= 0 || u >= 1) return;
      const x = 32 - 8 * u, y = 24 + 30 * u * u;
      c.save(); c.translate(x, y); c.globalAlpha = 1 - A.easeIn(u);
      c.fillStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.moveTo(0, -3.4); c.quadraticCurveTo(2.4, 0, 0, 1.8); c.quadraticCurveTo(-2.4, 0, 0, -3.4); c.fill();
      c.restore();
    },
  });
})();
