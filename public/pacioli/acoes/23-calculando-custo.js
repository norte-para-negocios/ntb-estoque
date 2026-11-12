// Calculando custo: o Pacioli vai para a esquerda; as pétalas abrem um pouco e giram como engrenagem
// enquanto moedas saem da tela dele e empilham em três colunas; o valor em R$ vai subindo no visor.
// A conta fecha em R$ 12,48: visor fica teal, selo de check, olhos ^ ^, volta ao centro.
(() => {
  const DUR = 8;
  const MX = 30, MY = 54;                                  // mascote durante a conta
  const COLS = [70, 88, 106], BASE = 95, HC = 3.4;          // colunas de moedas
  const ALT = [5, 7, 4];                                    // moedas por coluna
  const TOTAL = 12.48;
  // ordem das moedas: alterna colunas; cada uma sai da tela em t0 e pousa em t0 + 0.4
  const MOEDAS = [];
  { const h = [0, 0, 0]; let k = 0;
    while (MOEDAS.length < ALT[0] + ALT[1] + ALT[2]) { const col = k % 3; k++; if (h[col] >= ALT[col]) continue;
      MOEDAS.push({ col, nivel: h[col]++, t0: 1.0 + MOEDAS.length * 0.22 }); } }
  const FIM = MOEDAS[MOEDAS.length - 1].t0 + 0.4;            // ~4.5 s
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.0, 7.8)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 6.6, 7.2)));
  function moeda(c, A, x, y, s = 1) {
    c.save(); c.translate(x, y); c.scale(s, s); c.lineWidth = 1.3; c.strokeStyle = A.rgb(A.cor.CREAM); c.fillStyle = A.rgb(A.cor.AMBER);
    c.beginPath(); c.ellipse(0, 0, 6.5, 2.1, 0, 0, Math.PI); c.lineTo(-6.5, -HC + 0.6); c.ellipse(0, -HC + 0.6, 6.5, 2.1, 0, Math.PI, 0, false); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(0, -HC + 0.6, 6.5, 2.1, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.restore();
  }
  const pousou = (t) => MOEDAS.reduce((s, m) => s + (t >= m.t0 + 0.4 ? 1 : 0), 0);
  Pacioli.acao({
    titulo: 'Calculando custo', dur: DUR,
    humor: (t) => t > FIM + 0.3 && t < 6.6 ? 2 : t > 0.6 && t <= FIM + 0.3 ? 1 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.6, s); b.x = A.lerp(0, MX - 50, s); b.y = A.lerp(b.y, MY - 50, s);
      if (A.humor === 1) { b.pitch = 0.12; b.yaw = 0.18; b.onda = 0; b.giro = 1.8 * A.seg01(t, 0.7, 1.1) * (1 - A.seg01(t, FIM - 0.2, FIM + 0.3)); }
    },
    // engrenagem: todas as pétalas no mesmo meio-aberto, girando juntas (o giro vem de b.giro)
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t = 0.3; },
    olhos(o, t, A) {
      if (A.humor !== 1) return;
      // acompanha a moeda em voo; entre uma e outra olha o visor
      const m = MOEDAS.find(q => t >= q.t0 && t < q.t0 + 0.4);
      if (m) { o.lx = 0.8; o.ly = 0.3 - 0.5 * Math.sin(Math.PI * (t - m.t0) / 0.4); } else { o.lx = 0.9; o.ly = -0.6; }
      o.lid = 0.3; o.kL = 160; o.cL = 18;
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      A.linha(c, [[60, BASE + 2], [116, BASE + 2]], { a: 0.35 * ap });
      // visor do valor
      const ok = A.seg01(t, FIM + 0.3, FIM + 0.6);
      c.save(); c.translate(88, 18); c.scale(ap, ap);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.mix(A.cor.CREAM, A.cor.TEAL, ok)); c.lineWidth = 2.2;
      c.beginPath(); c.roundRect(-27, -9, 54, 18, 4); c.fill(); c.stroke();
      const n = pousou(t), v = TOTAL * n / MOEDAS.length;
      A.texto(c, 'R$ ' + v.toFixed(2).replace('.', ','), 0, 0.4, { tam: 8, peso: 700, monoNum: true, cor: A.mix(A.cor.CREAM, A.cor.TEAL, ok) });
      c.restore();
      if (ok > 0) {                                             // selo de conta fechada
        const s = A.back(ok) * ap;
        c.save(); c.translate(113, 6); c.scale(s, s);
        c.fillStyle = A.rgb(A.cor.TEAL); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, 0, 6.5, 0, Math.PI * 2); c.fill(); c.stroke();
        A.linha(c, [[-3, 0.2], [-0.8, 2.4], [3.2, -2.3]], { lw: 1.9 });
        c.restore();
      }
    },
    frente(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      const o = A.centro;
      // moedas pousadas primeiro (de baixo para cima), depois as que estão voando
      for (const m of MOEDAS) if (t >= m.t0 + 0.4) moeda(c, A, COLS[m.col], BASE - m.nivel * HC, ap);
      for (const m of MOEDAS) {
        if (t < m.t0 || t >= m.t0 + 0.4) continue;
        const u = (t - m.t0) / 0.4, x0 = o.x + 5, y0 = o.y - 2, x1 = COLS[m.col], y1 = BASE - m.nivel * HC;
        const x = A.lerp(x0, x1, u), y = A.lerp(y0, y1, u * u) - 16 * Math.sin(Math.PI * u) * (1 - u * 0.5);
        moeda(c, A, x, y, 0.55 + 0.45 * Math.min(1, u * 2.5));
      }
    },
  });
})();
