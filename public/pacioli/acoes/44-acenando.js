// Oi!: o triângulo de cima à direita sobe ao lado da cabeça e acena (vai e vem como um pêndulo),
// olhos ^ ^, a cabeça inclina de leve para o lado da mão e aparece um "Oi!" pequeno. A mão volta e ele vigia.
(() => {
  const DUR = 5.5;
  const mix = (t, A) => A.seg01(t, 0.5, 1.0) * (1 - A.seg01(t, 3.6, 4.1));
  const aceno = (t, A) => A.seg01(t, 1.0, 1.2) * (1 - A.seg01(t, 3.3, 3.6));
  const oi = (t, A) => A.easeInOut(A.seg01(t, 0.4, 0.9)) * (1 - A.easeInOut(A.seg01(t, 3.7, 4.3)));
  Pacioli.acao({
    titulo: 'Oi!', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = oi(t, A);
      b.roll = -0.1 * k; b.yaw = A.lerp(b.yaw, -0.08, k); b.pitch = A.lerp(b.pitch, 0.2, k);
    },
    olhos(o, t, A) {
      const k = oi(t, A); if (k <= 0) return;
      o.lx = A.lerp(o.lx, 0, k); o.ly = A.lerp(o.ly, 0, k);
      if (t > 0.8 && t < 3.8) { o.hap = 1; o.h = 14; o.w = 7; o.ly = -0.3; }
    },
    maos(H, t, A) {
      const m = mix(t, A); if (m <= 0) return;
      const v = aceno(t, A) * Math.sin((t - 1.0) * Math.PI * 2 * 1.6);   // vai e vem
      // pêndulo: a mão gira e desliza junto, como se o pulso ficasse embaixo
      H[A.TRIS[1]] = { x: 98 + 4 * v, y: 22 + 1.2 * Math.abs(v), rot: 0.45 + 0.45 * v, s: 1.05, mix: A.easeOut(m) };
    },
    frente(c, t, A) {
      const a = A.seg01(t, 1.0, 1.25) * (1 - A.seg01(t, 3.4, 3.8)); if (a <= 0) return;
      const s = A.back(A.seg01(t, 1.0, 1.4));
      c.save(); c.translate(10, 16); c.rotate(-0.12); c.scale(s, s);
      A.texto(c, 'Oi!', 0, 0, { tam: 9, peso: 700, a });
      c.restore();
    },
  });
})();
