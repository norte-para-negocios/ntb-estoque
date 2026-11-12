// Ouvindo: ele se inclina para a frente, os olhos encolhem e sobem, e a tela vira a onda da sua voz:
// barras que sobem e descem no ritmo de sílabas com pausas. As pétalas dos lados se abrem um pouco, como orelhas.
// Quando a fala acaba, as barras se apagam e ele volta a vigiar.
(() => {
  const DUR = 7;
  // a "fala" simulada: [início, duração] de cada sílaba (com pausas entre as palavras)
  const SIL = [[1.0, 0.22], [1.26, 0.18], [1.48, 0.3], [2.05, 0.2], [2.3, 0.26], [2.62, 0.18], [2.84, 0.34],
    [3.55, 0.2], [3.8, 0.22], [4.06, 0.3], [4.6, 0.18], [4.82, 0.24], [5.1, 0.4]];
  const fala = (t) => { let e = 0; for (const [a, d] of SIL) e = Math.max(e, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - a) / d)))); return e; };
  const ouvindo = (t, A) => A.easeInOut(A.seg01(t, 0.4, 0.9)) * (1 - A.easeInOut(A.seg01(t, 5.8, 6.4)));
  const NB = 11;
  Pacioli.acao({
    titulo: 'Ouvindo', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = ouvindo(t, A);
      b.pitch = A.lerp(b.pitch, 0.36, k); b.yaw = A.lerp(b.yaw, 0, k); b.escala += 0.07 * k; b.y += 2 * k;
      b.roll = -0.06 * k;                                             // cabeça levemente de lado, prestando atenção
    },
    petalas(PT, t, A) {
      const k = ouvindo(t, A), e = fala(t);
      for (let i = 0; i < PT.length; i++) if (Math.abs(A.faces[i].n[0]) > 0.99) { PT[i].t = k * (0.18 + 0.12 * e); PT[i].k = 160; }
    },
    olhos(o, t, A) {
      const k = ouvindo(t, A); if (k <= 0) return;
      o.lx = 0; o.ly = A.lerp(o.ly, -1.2, k); o.h = A.lerp(20, 9, k); o.w = A.lerp(8.5, 7.2, k); o.kL = 120; o.cL = 16;
      if (k > 0.5) o.piscar = false;
      if (t > 3.3 && t < 3.42) o.h = 2;                               // uma piscada na pausa
    },
    naTela(c, t, A) {
      const k = ouvindo(t, A); if (k <= 0.01) return;
      const e = fala(t), W = 4.4, y0 = 12.5;
      c.lineCap = 'round'; c.lineWidth = 3; c.strokeStyle = A.rgb(A.cor.CREAM, k);
      c.beginPath();
      for (let i = 0; i < NB; i++) {
        const u = i / (NB - 1) - 0.5, x = u * (NB - 1) * W;
        const forma = Math.cos(u * Math.PI * 1.1);                    // mais alto no meio
        const vivo = 0.55 + 0.45 * Math.sin(A.T * 13 + i * 2.1) * Math.sin(A.T * 7.3 + i * 1.3);
        const h = (1.5 + 15 * e * forma * vivo) * k;
        c.moveTo(x, y0 - h / 2); c.lineTo(x, y0 + h / 2);
      }
      c.stroke();
    },
  });
})();
