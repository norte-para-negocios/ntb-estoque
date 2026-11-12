// Indo dormir: boceja (olhos apertam, tela escurece devagar), cabeça pende, apaga.
Pacioli.acao({ titulo: 'Indo dormir', dur: 6,
  humor: (t) => t > 3.2 && t < 5.6 ? 4 : 0,
  corpo(b, t, A) { const y = A.arco(A.seg01(t, 0.8, 2.2)); b.escala += 0.05 * y; b.pitch += 0.2 * A.seg01(t, 2.2, 3.2); },
  olhos(o, t, A) { if (t > 0.8 && t < 2.2) { o.h = 3; o.w = 11; o.piscar = false; } if (t > 2.2 && t < 3.2) { o.h = A.lerp(14, 3, A.seg01(t, 2.2, 3.2)); o.lid = 0.5; o.ly = 0.4; } },
  tela(c, t, A) { const k = A.seg01(t, 1.5, 3.2) * (1 - A.seg01(t, 5.6, 5.9)); return A.mix(c, A.cor.DEEP, k); },
});
