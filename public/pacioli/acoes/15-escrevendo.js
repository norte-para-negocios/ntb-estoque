// Escrevendo resposta: ele encolhe e vai para a esquerda, um balão abre ao lado e vai se enchendo de linhas
// (como texto chegando, com um cursor na ponta). Os olhos acompanham o cursor linha a linha.
// Quando o balão fica completo ele olha para você, contente; o balão some e ele volta ao centro.
(() => {
  const DUR = 8;
  const BX = 60, BY = 26, BW = 56, BH = 44;                       // balão (canto sup. esq., largura, altura)
  // linhas do texto: cada uma é uma lista de palavras (comprimentos), digitadas em sequência
  const LIN = [[9, 6, 12, 8], [11, 15, 7], [6, 12, 8, 9], [13, 7]];
  const T0 = 1.2, T1 = 5.2;                                       // começa e termina de digitar
  const tot = LIN.reduce((s, l) => s + l.reduce((a, b) => a + b, 0) + (l.length - 1) * 2.4, 0);
  // posição do cursor: [linha, x] para um avanço u (0..1) no texto inteiro
  function cursor(u) {
    let resto = u * tot;
    for (let i = 0; i < LIN.length; i++) {
      const L = LIN[i].reduce((a, b) => a + b, 0) + (LIN[i].length - 1) * 2.4;
      if (resto <= L || i === LIN.length - 1) return [i, Math.min(resto, L)];
      resto -= L;
    }
  }
  // avanço com pequenas paradas (texto chegando em rajadas)
  const prog = (t, A) => { const u = A.seg01(t, T0, T1); return A.clamp(u + 0.035 * Math.sin(u * 40), 0, 1) * (u > 0 ? 1 : 0); };
  const lado = (t, A) => A.easeInOut(A.seg01(t, 0.2, 1.0)) * (1 - A.easeInOut(A.seg01(t, 6.9, 7.8)));
  const balao = (t, A) => A.back(A.seg01(t, 0.7, 1.1)) * (1 - A.easeIn(A.seg01(t, 6.6, 7.0)));
  Pacioli.acao({
    titulo: 'Escrevendo resposta', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const k = lado(t, A);
      b.escala = A.lerp(b.escala, 0.62, k); b.x = -27 * k; b.y = A.lerp(b.y, -2, k);
      const olha = A.seg01(t, 5.4, 5.8);
      b.yaw = A.lerp(b.yaw, A.lerp(0.28, 0, olha), k); b.pitch = A.lerp(b.pitch, 0.16, k);
    },
    olhos(o, t, A) {
      const k = lado(t, A); if (k <= 0) return;
      if (k > 0.5) o.piscar = false;
      if (t < 5.4) {
        const [ln, x] = cursor(prog(t, A));
        o.lx = A.lerp(o.lx, 1, k) * (t < T0 ? 1 : A.clamp(0.6 + x / 70, 0, 1)); o.ly = A.lerp(o.ly, -0.5 + ln * 0.35, k); o.lid = 0.2 * k; o.kL = 160; o.cL = 18;
      } else if (t < 6.6) { o.lx = 0; o.ly = 0; o.hap = 1; o.h = 14; o.w = 7; }       // pronto: olha para você
      else { o.lx = 0; o.ly = 0; }
    },
    frente(c, t, A) {
      const s = balao(t, A); if (s <= 0.01) return;
      c.save(); c.translate(BX + BW / 2, BY + BH / 2); c.scale(s, s); c.translate(-(BX + BW / 2), -(BY + BH / 2));
      c.lineJoin = c.lineCap = 'round';
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2;
      c.beginPath(); c.roundRect(BX, BY, BW, BH, 7); c.fill(); c.stroke();
      // rabicho apontando para o mascote
      c.beginPath(); c.moveTo(BX + 1.2, BY + 26); c.lineTo(BX - 7, BY + 33); c.lineTo(BX + 1.2, BY + 32); c.fill();
      c.beginPath(); c.moveTo(BX, BY + 26); c.lineTo(BX - 7, BY + 33); c.lineTo(BX, BY + 32); c.stroke();
      // texto chegando
      const u = prog(t, A), [cl, cx] = cursor(u);
      for (let i = 0; i <= cl; i++) {
        let x = BX + 7, lim = i < cl ? 1e9 : cx, feito = 0;
        const y = BY + 9 + i * 8.6;
        for (const w of LIN[i]) {
          const vis = Math.min(w, lim - feito); if (vis <= 0) break;
          A.linha(c, [[x, y], [x + vis, y]], { lw: 3, a: 0.85 });
          x += w + 2.4; feito += w + 2.4;
        }
      }
      // cursor piscando na ponta (some quando termina)
      if (u > 0 && t < 5.4 && Math.floor(A.T * 4) % 2 === 0 || (u <= 0 && t > 1.0 && Math.floor(A.T * 3) % 2 === 0)) {
        const y = BY + 9 + cl * 8.6, x = BX + 7 + cx + 1.6;
        c.fillStyle = A.rgb(A.cor.AMBER); c.fillRect(x, y - 2.6, 2, 5.2);
      }
      // concluído: marquinha teal no canto
      const ok = A.seg01(t, 5.3, 5.6);
      if (ok > 0) {
        c.save(); c.translate(BX + BW - 3, BY + BH - 3); c.scale(A.back(ok), A.back(ok));
        c.fillStyle = A.rgb(A.cor.TEAL); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.fill(); c.stroke();
        A.linha(c, [[-2.3, 0.1], [-0.6, 1.8], [2.4, -1.7]], { lw: 1.5 });
        c.restore();
      }
      c.restore();
    },
  });
})();
