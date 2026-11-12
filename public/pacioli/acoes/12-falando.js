// Falando: uma boca de luz abre e fecha na tela no ritmo das sílabas (com pausas entre as palavras),
// o corpo acompanha de leve e o triângulo de baixo à direita sai como mão e gesticula, como quem explica.
// Ao terminar a frase a mão volta para o corpo e a boca some.
(() => {
  const DUR = 7;
  const SIL = [[1.1, 0.2], [1.34, 0.24], [1.62, 0.32], [2.2, 0.2], [2.44, 0.18], [2.66, 0.3],
    [3.3, 0.22], [3.56, 0.2], [3.8, 0.34], [4.45, 0.2], [4.7, 0.22], [4.96, 0.42]];
  const fala = (t) => { let e = 0; for (const [a, d] of SIL) e = Math.max(e, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - a) / d)))); return e; };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  // mão: [tempo, x, y, giro] — sobe para enfatizar, desce, abre para fora, volta
  const MAO = [[0.9, 89, 70, 0.2], [1.5, 95, 56, -0.3], [2.1, 91, 67, 0.2], [2.7, 95, 58, -0.2], [3.3, 100, 63, 0.6], [4.0, 100, 63, 0.6], [4.5, 94, 54, -0.4], [5.2, 91, 67, 0.2]];
  const mix = (t, A) => A.seg01(t, 0.6, 1.0) * (1 - A.seg01(t, 5.6, 6.1));
  const ativo = (t, A) => A.easeInOut(A.seg01(t, 0.6, 1.0)) * (1 - A.easeInOut(A.seg01(t, 5.5, 6.1)));
  Pacioli.acao({
    titulo: 'Falando', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = ativo(t, A), e = fala(t);
      b.yaw = A.lerp(b.yaw, -0.05, k); b.pitch = A.lerp(b.pitch, 0.2 - 0.06 * e, k); b.escala += 0.02 * e * k;
      b.roll = 0.04 * Math.sin(t * 3.1) * k;
    },
    olhos(o, t, A) {
      const k = ativo(t, A); if (k <= 0) return;
      const e = fala(t);
      o.lx = 0; o.ly = A.lerp(o.ly, -1.1, k); o.h = A.lerp(20, 12 + 2 * e, k); o.w = 8; o.kL = 120; o.cL = 16;
      if (k > 0.5) o.piscar = false;
      if (t > 3.0 && t < 3.12) o.h = 2;                               // pisca na pausa
    },
    tela(cor, t, A) { return A.mix(cor, A.cor.CREAM, 0.1 * fala(t) * ativo(t, A)); },
    naTela(c, t, A) {
      const k = ativo(t, A); if (k <= 0.01) return;
      const e = fala(t), w = (14 - 2 * e) * k, h = 2.4 + 6.5 * e;    // boca: risco fechado → abre em cada sílaba
      c.fillStyle = A.rgb(A.cor.CREAM, k);
      c.beginPath(); c.roundRect(-w / 2, 12 - h / 2, w, h, Math.min(w, h) / 2); c.fill();
    },
    maos(H, t, A) {
      const m = mix(t, A); if (m <= 0) return;
      const p = kf(MAO, t), e = fala(t);
      H[A.TRIS[3]] = { x: p[1], y: p[2] - 2 * e, rot: p[3] + 0.12 * e, s: 1, mix: A.easeOut(m) };
    },
  });
})();
