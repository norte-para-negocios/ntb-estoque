// Sugerindo: ele vai para a esquerda, um cartão de sugestão entra pela direita (ícone âmbar + linhas),
// o triângulo de cima à direita sai como mão e aponta para o cartão com dois toquinhos.
// Os olhos vão do cartão para você ("que tal?"), voltam ao cartão e de novo a você; depois tudo se recolhe.
(() => {
  const DUR = 7;
  const CX = 68, CY = 30, CW = 48, CH = 36;                       // cartão
  const lado = (t, A) => A.easeInOut(A.seg01(t, 0.2, 1.0)) * (1 - A.easeInOut(A.seg01(t, 5.8, 6.7)));
  const cartao = (t, A) => A.easeOut(A.seg01(t, 0.9, 1.4)) * (1 - A.easeIn(A.seg01(t, 5.4, 5.9)));
  const mix = (t, A) => A.seg01(t, 1.3, 1.75) * (1 - A.seg01(t, 4.9, 5.4));
  // para onde os olhos olham: 1 = cartão, 0 = você
  const alvo = (t) => (t < 3.4 ? 1 : t < 4.2 ? 0 : t < 4.7 ? 1 : 0);
  Pacioli.acao({
    titulo: 'Sugerindo', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = lado(t, A);
      b.escala = A.lerp(b.escala, 0.66, k); b.x = -30 * k; b.y = A.lerp(b.y, 0, k);
      b.yaw = A.lerp(b.yaw, 0.26 * alvo(t), k); b.pitch = A.lerp(b.pitch, 0.18, k);
    },
    olhos(o, t, A) {
      const k = lado(t, A); if (k <= 0) return;
      if (k > 0.5) o.piscar = false;
      const a = alvo(t);
      o.lx = A.lerp(o.lx, a, k); o.ly = A.lerp(o.ly, a ? -0.2 : 0, k); o.kL = 150; o.cL = 16;
      if (!a && t > 3.4 && t < 4.2) { o.dy = -2; o.w = 9; }         // "que tal?" — sobrancelha de pergunta
      if (t > 4.7 && t < 5.6) { o.hap = 1; o.h = 14; o.w = 7; }
    },
    maos(H, t, A) {
      const m = mix(t, A); if (m <= 0) return;
      const toque = A.arco(A.seg01(t, 1.9, 2.15)) + A.arco(A.seg01(t, 2.25, 2.5)) + A.arco(A.seg01(t, 4.75, 5.0));
      H[A.TRIS[1]] = { x: 56 + 3 * toque, y: 47, rot: -0.5, s: 1, mix: A.easeOut(m) };
    },
    frente(c, t, A) {
      const s = cartao(t, A); if (s <= 0.01) return;
      c.save(); c.translate((1 - s) * 40, 0); c.globalAlpha = s;
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.roundRect(CX, CY, CW, CH, 6); c.fill(); c.stroke();
      // ícone: faísca âmbar num quadradinho
      const ix = CX + 10, iy = CY + 11, pul = 1 + 0.08 * A.arco(A.seg01(t, 1.9, 2.5));
      c.save(); c.translate(ix, iy); c.scale(pul, pul);
      c.fillStyle = A.rgb(A.cor.AMBER); c.beginPath(); c.roundRect(-6, -6, 12, 12, 3); c.fill();
      c.fillStyle = A.rgb(A.cor.BG); c.beginPath();
      c.moveTo(0, -4); c.quadraticCurveTo(0.6, -0.6, 4, 0); c.quadraticCurveTo(0.6, 0.6, 0, 4); c.quadraticCurveTo(-0.6, 0.6, -4, 0); c.quadraticCurveTo(-0.6, -0.6, 0, -4); c.fill();
      c.restore();
      // título e duas linhas
      A.linha(c, [[CX + 20, CY + 8.5], [CX + 40, CY + 8.5]], { lw: 3.2 });
      A.linha(c, [[CX + 20, CY + 14], [CX + 33, CY + 14]], { lw: 2.2, a: 0.55 });
      A.linha(c, [[CX + 6, CY + 24], [CX + 42, CY + 24]], { lw: 2.4, a: 0.8 });
      A.linha(c, [[CX + 6, CY + 30], [CX + 30, CY + 30]], { lw: 2.4, a: 0.8 });
      c.restore();
    },
  });
})();
