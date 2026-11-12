// Relatório pronto: o Pacioli sobe um pouco e um papel sai por baixo da tela dele, com um gráfico de barras
// que se desenha. As duas mãos seguram o papel pelas laterais e o estendem na sua direção (o papel cresce
// para a frente), olhos ^ ^. Segura um instante, recolhe, e tudo volta ao lugar.
(() => {
  const DUR = 7;
  const W = 30, HH = 36;                                  // papel
  const BAR = [[0.45, A => A.cor.VIO], [0.7, A => A.cor.VIO], [0.55, A => A.cor.VIO], [0.95, A => A.cor.TEAL]];
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.3, 0.8)) * (1 - A.easeInOut(A.seg01(t, 5.6, 6.4)));
  const sai = (t, A) => A.easeOut(A.seg01(t, 0.7, 1.4));            // papel desce de trás da tela
  const vem = (t, A) => A.easeInOut(A.seg01(t, 1.9, 2.6)) * (1 - A.easeInOut(A.seg01(t, 4.6, 5.3)));   // estende para a frente
  const some = (t, A) => A.easeIn(A.seg01(t, 5.2, 5.6));
  const papelXY = (t, A) => {
    const o = A.centro, y0 = o.y + 4, y1 = 82, v = vem(t, A);
    return { x: 50, y: A.lerp(A.lerp(y0, y1, sai(t, A)), 76, v), s: A.lerp(0.7, 1.4, v) * (1 - 0.6 * some(t, A)) };
  };
  function papel(c, A, t, x, y, s) {
    c.save(); c.translate(x, y); c.scale(s, s); c.rotate(-0.04 * vem(t, A));
    c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2;
    c.beginPath(); c.moveTo(-W / 2, -HH / 2); c.lineTo(W / 2 - 6, -HH / 2); c.lineTo(W / 2, -HH / 2 + 6); c.lineTo(W / 2, HH / 2); c.lineTo(-W / 2, HH / 2); c.closePath(); c.fill(); c.stroke();
    A.linha(c, [[W / 2 - 6, -HH / 2], [W / 2 - 6, -HH / 2 + 6], [W / 2, -HH / 2 + 6]], { lw: 1.4 });           // dobra
    A.linha(c, [[-W / 2 + 4, -HH / 2 + 5], [W / 2 - 10, -HH / 2 + 5]], { lw: 1.6, a: 0.8 });               // título
    A.linha(c, [[-W / 2 + 4, -HH / 2 + 9], [2, -HH / 2 + 9]], { lw: 1.2, a: 0.4 });
    // gráfico de barras: cada barra cresce na sua vez
    const base = HH / 2 - 4, alt = 20;
    A.linha(c, [[-W / 2 + 3, base], [W / 2 - 3, base]], { lw: 1.4 });
    BAR.forEach(([h, cor], i) => {
      const u = A.back(A.seg01(t, 1.2 + i * 0.16, 1.5 + i * 0.16)); if (u <= 0) return;
      const bx = -W / 2 + 5 + i * 5.6, bh = alt * h * u;
      c.fillStyle = A.rgb(cor(A)); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1;
      c.beginPath(); c.rect(bx, base - bh, 4, bh); c.fill(); c.stroke();
    });
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Relatório pronto', dur: DUR,
    humor: (t) => t > 2.35 && t < 4.9 ? 2 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.74, s); b.y = A.lerp(b.y, -14, s);
      b.pitch = A.lerp(b.pitch, 0.08, s); b.yaw = A.lerp(b.yaw, 0, s);
      b.escala += 0.02 * vem(t, A) * Math.sin(t * 3);              // balança de leve enquanto oferece
    },
    olhos(o, t, A) {
      if (A.humor === 2) { o.lx = 0; o.ly = 0; return; }           // ^ ^ para você
      if (t > 0.7 && t < 2.35) { o.lx = 0; o.ly = 0.9; o.kL = 120; o.cL = 16; }   // olha o papel sair
    },
    maos(H, t, A) {
      const m = A.seg01(t, 1.4, 1.85) * (1 - A.seg01(t, 4.9, 5.4)); if (m <= 0) return;
      const p = papelXY(t, A), dx = (W / 2 + 2.5) * p.s;
      H[A.TRIS[2]] = { x: p.x - dx, y: p.y + 2 * p.s, rot: 2.5, s: 0.85 + 0.25 * vem(t, A), mix: A.easeOut(m) };   // aponta para dentro
      H[A.TRIS[3]] = { x: p.x + dx, y: p.y + 2 * p.s, rot: 1.0, s: 0.85 + 0.25 * vem(t, A), mix: A.easeOut(m) };
    },
    atras(c, t, A) {                                     // enquanto sai de trás da tela
      if (t < 0.7 || t >= 1.4) return;
      const p = papelXY(t, A); papel(c, A, t, p.x, p.y, p.s);
    },
    frente(c, t, A) {                                    // depois de sair, fica na frente do corpo
      if (t < 1.4 || some(t, A) >= 1) return;
      const p = papelXY(t, A); c.save(); c.globalAlpha = 1 - some(t, A); papel(c, A, t, p.x, p.y, p.s); c.restore();
    },
  });
})();
