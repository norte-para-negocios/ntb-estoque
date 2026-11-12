// Entendi: acena que sim duas vezes (cabeça desce e sobe), os olhos viram ^ ^ na hora,
// a tela esquenta um pouco de teal e aparece um "ok" pequeno ao lado. Depois volta a vigiar.
(() => {
  const DUR = 5;
  const aceno = (t, A) => A.arco(A.seg01(t, 0.8, 1.3)) + A.arco(A.seg01(t, 1.35, 1.85));
  const feliz = (t) => t > 0.85 && t < 3.0;
  Pacioli.acao({
    titulo: 'Entendi', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const n = aceno(t, A), k = A.seg01(t, 0.6, 0.8) * (1 - A.seg01(t, 3.0, 3.4));
      if (k > 0) { b.yaw = A.lerp(b.yaw, 0, k); b.pitch = A.lerp(b.pitch, 0.16, k) + 0.42 * n; b.k = 140; }
      b.y += 2.5 * n;
    },
    olhos(o, t, A) {
      if (t > 0.6 && t < 3.0) { o.lx = 0; o.ly = 0; o.piscar = false; }
      if (feliz(t)) { o.hap = 1; o.h = 14; o.w = 7; o.ly = -0.2; }
    },
    tela(cor, t, A) { return A.mix(cor, A.cor.TEAL, 0.6 * A.arco(A.seg01(t, 0.9, 2.8))); },
    frente(c, t, A) {
      const a = A.seg01(t, 1.0, 1.25) * (1 - A.seg01(t, 2.7, 3.0));
      if (a <= 0) return;
      const s = A.back(A.seg01(t, 1.0, 1.35)), x = 90, y = 18 - 3 * A.easeOut(A.seg01(t, 1.0, 2.0));
      c.save(); c.translate(x, y); c.scale(s, s);
      c.fillStyle = A.rgb(A.cor.TEAL, a); c.strokeStyle = A.rgb(A.cor.CREAM, a); c.lineWidth = 1.6;
      c.beginPath(); c.roundRect(-9, -5.5, 18, 11, 5.5); c.fill(); c.stroke();
      c.restore();
      A.texto(c, 'ok', x, y + 0.3, { tam: 6.5, peso: 700, a });
    },
  });
})();
