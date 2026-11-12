// Estoque baixo: uma prateleira embaixo com uma vaga vazia. O Pacioli passa o olho pelas caixas, para na vazia,
// a tela fica âmbar, um sinal de alerta pulsa em cima da vaga e uma mão sai do corpo e aponta para ela; depois volta.
(() => {
  const DUR = 7.5;
  const BX = [14, 38, 62, 86], VAZIA = 2, BASE = 98, BW = 17, BH = 15;
  const ACHA = 2.0, SOLTA = 5.3;
  const mix = (t) => Math.min(1, Math.max(0, (t - 2.5) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - SOLTA) / 0.4)));
  const alerta = (t, A) => A.back(A.seg01(t, ACHA + 0.25, ACHA + 0.55)) * (1 - A.easeIn(A.seg01(t, SOLTA, SOLTA + 0.3)));
  Pacioli.acao({
    titulo: 'Estoque baixo', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.2, 7.0)));
      b.escala = A.lerp(1, 0.64, s); b.y = A.lerp(b.y, -17, s);
      if (t > 0.6 && t < 6.2) { b.pitch = 0.36; b.yaw *= 0.5; }
      if (A.passou(ACHA)) A.pulo(30);
    },
    tela(cor, t, A) {
      const k = A.seg01(t, ACHA + 0.1, ACHA + 0.4) * (1 - A.seg01(t, SOLTA, SOLTA + 0.5));
      if (k > 0) return A.mix(cor, A.cor.AMBER, k * (0.85 + 0.15 * Math.sin(A.T * 7)));
    },
    olhos(o, t, A) {
      if (t < 0.6 || t > 6.2) { o.lx = 0; o.ly = 0; return; }
      o.ly = 0.9; o.kL = 120; o.cL = 15;
      if (t < ACHA) { o.lx = A.lerp(-0.85, 0.85, A.smooth(A.seg01(t, 0.8, ACHA))); o.lid = 0.25; return; }    // passa o olho na prateleira
      o.lx = (BX[VAZIA] - 50) / 40; o.lid = 0; o.h = 24; o.w = 9.5; o.piscar = false;                           // achou: arregala
      if (t > 4.2 && t < SOLTA) { o.lx = 0; o.ly = 0; o.dy = -3; }                                               // olha para você
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const bat = 1.6 * Math.max(0, Math.sin((t - 2.85) * 9)) * A.seg01(t, 2.85, 3.0) * (1 - A.seg01(t, 4.0, 4.2));   // cutucadas
      H[A.TRIS[1]] = { x: BX[VAZIA] + 11 - bat, y: BASE - BH - 13 + bat, rot: 1.2, s: 1.1, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 6.1, 6.6)));
      if (ap <= 0.01) return;
      c.save(); c.translate(50, BASE); c.scale(ap, ap); c.translate(-50, -BASE);
      A.linha(c, [[-4, BASE], [104, BASE]], { lw: 2.2 });
      A.linha(c, [[-2, BASE], [-2, BASE + 6]], { lw: 1.6, a: 0.6 }); A.linha(c, [[102, BASE], [102, BASE + 6]], { lw: 1.6, a: 0.6 });
      for (let i = 0; i < BX.length; i++) {
        const x = BX[i] - BW / 2, y = BASE - BH;
        if (i === VAZIA) {          // vaga vazia: contorno tracejado
          const al = A.seg01(t, ACHA + 0.1, ACHA + 0.4) * (1 - A.seg01(t, SOLTA, SOLTA + 0.5));
          c.save(); c.setLineDash([2.4, 2.6]); c.lineWidth = 1.6; c.strokeStyle = A.rgb(A.mix(A.cor.CREAM, A.cor.AMBER, al), 0.75);
          c.beginPath(); c.rect(x, y, BW, BH); c.stroke(); c.restore();
          A.texto(c, '0', BX[i], y + BH / 2 + 0.4, { tam: 7, monoNum: true, cor: A.mix(A.cor.CREAM, A.cor.AMBER, al), a: 0.5 + 0.5 * al });
          continue;
        }
        c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.9; c.lineJoin = 'round';
        c.beginPath(); c.rect(x, y, BW, BH); c.fill(); c.stroke();
        A.linha(c, [[x, y + 4.5], [x + BW, y + 4.5]], { lw: 1.1, a: 0.55 });
        A.linha(c, [[BX[i] - 2.5, y + 9], [BX[i] + 2.5, y + 9]], { lw: 1.2, a: 0.45 });
      }
      c.restore();
    },
    frente(c, t, A) {
      const k = alerta(t, A); if (k <= 0.01) return;
      const pul = 1 + 0.12 * Math.max(0, Math.sin(A.T * 6));
      c.save(); c.translate(BX[VAZIA] - 13, BASE - BH - 9); c.scale(k * pul, k * pul);
      c.fillStyle = A.rgb(A.cor.AMBER); c.strokeStyle = A.rgb(A.cor.AMBER); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(0, -5.5); c.lineTo(5.6, 4); c.lineTo(-5.6, 4); c.closePath(); c.fill(); c.stroke();
      A.linha(c, [[0, -2], [0, 0.9]], { cor: A.cor.BG, lw: 1.5 });
      c.fillStyle = A.rgb(A.cor.BG); c.beginPath(); c.arc(0, 2.6, 0.8, 0, Math.PI * 2); c.fill();
      c.restore();
    },
  });
})();
