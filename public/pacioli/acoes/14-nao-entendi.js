// Não entendi: inclina a cabeça de lado, um olho sobe mais que o outro, aparece um "?" e
// o triângulo de cima à direita sai como mão e coça a lateral da cabeça. Depois desfaz e volta a vigiar.
(() => {
  const DUR = 6;
  const duvida = (t, A) => A.easeInOut(A.seg01(t, 0.6, 1.1)) * (1 - A.easeInOut(A.seg01(t, 4.2, 4.9)));
  const mix = (t, A) => A.seg01(t, 1.0, 1.45) * (1 - A.seg01(t, 3.7, 4.2));
  Pacioli.acao({
    titulo: 'Não entendi', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = duvida(t, A);
      b.roll = 0.24 * k; b.yaw = A.lerp(b.yaw, 0.1, k); b.pitch = A.lerp(b.pitch, 0.22, k);
    },
    olhos(o, t, A) {
      const k = duvida(t, A); if (k <= 0) return;
      o.lx = A.lerp(o.lx, 0.15, k); o.ly = A.lerp(o.ly, -0.2, k); o.dy = -4.5 * k; o.w = 9; o.h = A.lerp(20, 17, k);
      if (k > 0.5) o.piscar = false;
      if ((t > 2.5 && t < 2.62) || (t > 2.75 && t < 2.87)) o.h = 2;   // pisca duas vezes, confuso
    },
    maos(H, t, A) {
      const m = mix(t, A); if (m <= 0) return;
      const coca = A.seg01(t, 1.5, 1.7) * (1 - A.seg01(t, 3.4, 3.6));  // coça só enquanto encostada
      const v = coca * Math.sin(t * 22);
      H[A.TRIS[1]] = { x: 99 + 0.8 * v, y: 41 + 2.4 * v, rot: Math.PI + 0.3 + 0.2 * v, s: 1, mix: A.easeOut(m) };
    },
    frente(c, t, A) {
      const a = A.seg01(t, 1.2, 1.45) * (1 - A.seg01(t, 4.0, 4.4));
      if (a <= 0) return;
      const s = A.back(A.seg01(t, 1.2, 1.6)), bal = 0.12 * Math.sin(t * 3.2);
      c.save(); c.translate(4, 12 - 2 * A.easeOut(A.seg01(t, 1.2, 2.2))); c.rotate(bal - 0.15); c.scale(s, s);
      c.fillStyle = A.rgb(A.cor.BG, a); c.strokeStyle = A.rgb(A.cor.CREAM, a); c.lineWidth = 1.8;
      c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fill(); c.stroke();
      A.texto(c, '?', 0, 0.6, { tam: 11, peso: 700, cor: A.cor.AMBER, a });
      c.restore();
    },
  });
})();
