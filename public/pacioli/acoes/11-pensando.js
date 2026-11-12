// Pensando: as pétalas se entreabrem e giram devagar, as facetas acendem em âmbar uma depois da outra,
// os olhos sobem e vão para um lado, depois para o outro, e três pontinhos acendem em sequência na tela.
// No fim as pétalas fecham e ele volta a olhar para você.
(() => {
  const DUR = 7;
  const pensa = (t, A) => A.easeInOut(A.seg01(t, 0.5, 1.3)) * (1 - A.easeInOut(A.seg01(t, 5.6, 6.5)));
  Pacioli.acao({
    titulo: 'Pensando', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = pensa(t, A);
      b.giro = 0.45 * k; b.onda = 0.7 * k;                           // giro lento + facetas acendendo em roda
      b.pitch = A.lerp(b.pitch, 0.1, k); b.yaw = A.lerp(b.yaw, (t < 3.6 ? 0.12 : -0.12), k);
      b.roll = (t < 3.6 ? -0.05 : 0.05) * k; b.escala -= 0.04 * k;
    },
    petalas(PT, t, A) {
      const k = pensa(t, A);
      for (let i = 0; i < PT.length; i++) { PT[i].t = Math.max(PT[i].t, k * (0.26 + 0.05 * Math.sin(A.T * 1.6 - A.ANG[i]))); PT[i].k = 70; }
    },
    olhos(o, t, A) {
      const k = pensa(t, A); if (k <= 0) return;
      const lado = t < 3.6 ? 1 : -1;                            // olha para cima e para um lado, depois para o outro
      o.lx = A.lerp(o.lx, lado, k); o.ly = A.lerp(o.ly, -1.7, k); o.h = A.lerp(20, 12, k); o.w = 8;
      o.dy = -1.6 * k * (t < 3.6 ? 1 : -1); o.kL = 70; o.cL = 13;
      if (k > 0.5) o.piscar = false;
      if (t > 3.55 && t < 3.68) o.h = 2;                              // pisca ao trocar de lado
    },
    naTela(c, t, A) {
      const k = pensa(t, A); if (k <= 0.01) return;
      for (let j = 0; j < 3; j++) {                                   // três pontinhos acendendo em sequência
        const ph = ((A.T * 1.4 - j * 0.28) % 1 + 1) % 1, on = Math.max(0, Math.sin(ph * Math.PI)) ** 2;
        c.fillStyle = A.rgb(A.mix(A.cor.VIO, A.cor.CREAM, k * (0.25 + 0.75 * on)));
        c.beginPath(); c.arc((j - 1) * 5.6, 9.5 - 1.2 * on, 2.2, 0, Math.PI * 2); c.fill();
      }
    },
  });
})();
