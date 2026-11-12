// Sincronizando: o Pacioli vai para a esquerda; à direita surge a nuvem "Omie". Duas setas em arco ligam os dois:
// por cima vão pacotes âmbar (o que ele manda), por baixo voltam pacotes teal (a confirmação do Omie).
// A tela dele pulsa âmbar enquanto sincroniza; no fim, check teal entre os dois, olhos ^ ^, volta ao centro.
(() => {
  const DUR = 7;
  const MX = 28, MY = 52;
  const OX = 62, OY = 52, R = 31;                   // círculo das setas
  const CX = 94, CY = 52;                           // nuvem
  const SYNC = [1.0, 5.0], OK = 5.2;
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.3, 6.95)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 6.0, 6.45)));
  const IDA = [-Math.PI * 0.86, -Math.PI * 0.14];   // arco de cima: esquerda → direita
  const VOLTA = [Math.PI * 0.14, Math.PI * 0.86];   // arco de baixo: direita → esquerda
  const pt = (a) => [OX + R * Math.cos(a), OY + R * Math.sin(a) * 0.8];
  // pacotes: [arco, saída]; cada um leva 1 s
  const PAC = [];
  for (let k = 0; k < 8; k++) PAC.push({ cima: true, t0: SYNC[0] + k * 0.45 });
  for (let k = 0; k < 7; k++) PAC.push({ cima: false, t0: SYNC[0] + 0.7 + k * 0.45 });
  Pacioli.acao({
    titulo: 'Sincronizando', dur: DUR,
    humor: (t) => t > OK && t < 6.2 ? 2 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.6, s); b.x = A.lerp(0, MX - 50, s); b.y = A.lerp(0, MY - 50, s);
      if (A.humor === 0) { b.yaw = A.lerp(b.yaw, 0.12, s); b.pitch = A.lerp(b.pitch, 0.1, s); }
    },
    olhos(o, t, A) {
      const s = ida(t, A); if (s < 0.3 || A.humor !== 0) return;
      // vai e volta com o olhar, acompanhando os pacotes (para cima quando manda, para baixo quando recebe)
      const f = Math.sin((t - SYNC[0]) * Math.PI / 0.9);
      o.lx = 0.75; o.ly = t > SYNC[0] && t < SYNC[1] + 0.6 ? 0.55 * f : 0; o.lid = 0.3; o.kL = 70; o.cL = 13;
    },
    tela(cor, t, A) {
      const k = A.seg01(t, 0.8, 1.1) * (1 - A.seg01(t, SYNC[1] - 0.1, OK));
      if (k <= 0) return;
      return A.mix(cor, A.mix(A.cor.AMBER, A.cor.BG, 0.14 * (1 + Math.sin(A.T * 6))), k);   // âmbar que pulsa no brilho
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      const ok = A.seg01(t, OK, OK + 0.3);
      // setas em arco, tracejadas, andando no sentido do fluxo
      c.save(); c.globalAlpha = ap; c.lineCap = 'round'; c.lineWidth = 1.6; c.setLineDash([3, 3.5]);
      for (const [a0, a1] of [IDA, VOLTA]) {
        c.strokeStyle = A.rgb(A.mix(A.cor.CREAM, A.cor.TEAL, ok), 0.55); c.lineDashOffset = -A.T * 10;
        c.beginPath(); for (let j = 0; j <= 30; j++) { const [x, y] = pt(A.lerp(a0, a1, j / 30)); j ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
      }
      c.setLineDash([]);
      for (const [a0, a1] of [IDA, VOLTA]) {           // ponta de seta no meio de cada arco
        const [x, y] = pt(A.lerp(a0, a1, 0.56)), [xp, yp] = pt(A.lerp(a0, a1, 0.5)), dx = x - xp, dy = y - yp, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        A.linha(c, [[x - ux * 4 - uy * 3, y - uy * 4 + ux * 3], [x, y], [x - ux * 4 + uy * 3, y - uy * 4 - ux * 3]], { lw: 1.8, a: 0.8, cor: A.mix(A.cor.CREAM, A.cor.TEAL, ok) });
      }
      c.restore();
      // pacotes viajando nos arcos (saem de trás dele e entram atrás da nuvem)
      for (const p of PAC) {
        const u = (t - p.t0) / 1.0; if (u <= 0 || u >= 1) continue;
        const [a0, a1] = p.cima ? IDA : VOLTA, [x, y] = pt(A.lerp(a0, a1, A.easeInOut(u))), s = Math.min(1, Math.sin(Math.PI * u) * 2.5) * ap;
        c.save(); c.translate(x, y); c.scale(s, s); c.rotate(0.3 * Math.sin(u * 6));
        c.fillStyle = A.rgb(p.cima ? A.cor.AMBER : A.cor.TEAL); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.3;
        c.beginPath(); c.roundRect(-3, -3, 6, 6, 1.2); c.fill(); c.stroke(); c.restore();
      }
      // nuvem do Omie (contorno da união de círculos: traço grosso por baixo, preenchimento por cima)
      const B = [[-9, 3, 7], [0, -3, 9.5], [10, 2, 7.5]];
      c.save(); c.translate(CX, CY); c.scale(ap, ap);
      c.strokeStyle = A.rgb(A.mix(A.cor.CREAM, A.cor.TEAL, ok)); c.lineWidth = 4.4; c.fillStyle = A.rgb(A.cor.BG);
      for (const [x, y, r] of B) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); }
      c.beginPath(); c.roundRect(-16, 2, 33, 8.2, 4); c.stroke();
      for (const [x, y, r] of B) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.roundRect(-16, 2, 33, 8.2, 4); c.fill();
      A.texto(c, 'Omie', 0.5, 2.5, { tam: 5.5, peso: 700 });
      c.restore();
    },
    frente(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      // check de sincronizado, no alto entre os dois
      const ok = A.seg01(t, OK, OK + 0.3);
      if (ok > 0) {
        const s = A.back(ok) * ap; const [x, y] = pt(-Math.PI / 2);
        c.save(); c.translate(x, y); c.scale(s, s);
        c.fillStyle = A.rgb(A.cor.TEAL); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill(); c.stroke();
        A.linha(c, [[-3.2, 0.2], [-0.8, 2.6], [3.4, -2.4]], { lw: 1.9 });
        c.restore();
      }
    },
  });
})();
