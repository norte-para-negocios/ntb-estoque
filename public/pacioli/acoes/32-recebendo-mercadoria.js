// Recebendo mercadoria: o Pacioli sobe para o canto, uma caixa chega deslizando, as duas mãos abrem as abas
// e levam os itens um a um para a prateleira; o contador da prateleira sobe. A caixa vazia sai e as mãos voltam.
(() => {
  const DUR = 9;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const BXF = 46, CH = 98, CW = 28, CA = 18, CT = CH - CA;      // caixa: centro final, chão, largura, altura, topo
  const PY = 56, SL = [78, 90, 102, 114];                        // prateleira: altura e vagas (a primeira já tem item)
  const ABA = CW / 2 - 1;
  // abertura das abas: 0 fechada → 1 aberta; fecham de novo antes da caixa sair
  const abre = (t, A) => A.easeInOut(A.seg01(t, 2.0, 2.5)) * (1 - A.easeInOut(A.seg01(t, 5.9, 6.3)));
  const abaPonta = (lado, k) => {            // lado -1 esquerda, 1 direita
    const a = lado < 0 ? -(Math.PI - 0.5) * k : Math.PI + (Math.PI - 0.5) * k;
    const hx = BXF + lado * (CW / 2);
    return [hx + ABA * Math.cos(a), CT + ABA * Math.sin(a)];
  };
  // itens: quem leva, quando pega dentro da caixa, quando solta na vaga
  const IT = [{ mao: 'e', pega: 2.9, solta: 3.7, vaga: 1 }, { mao: 'd', pega: 3.8, solta: 4.6, vaga: 2 }, { mao: 'd', pega: 4.9, solta: 5.7, vaga: 3 }];
  const p0 = abaPonta(-1, 0), p1 = abaPonta(-1, 1), q0 = abaPonta(1, 0), q1 = abaPonta(1, 1);
  const ME = [[1.1, 34, 62, 0], [1.8, p0[0], p0[1] - 4, 0], [2.0, p0[0], p0[1] - 4, 0], [2.5, p1[0], p1[1] - 4, 0],
    [2.65, BXF - 4, CT - 6, 0], [2.9, BXF - 4, CT + 2, 0], [3.0, BXF - 4, CT + 2, 0], [3.4, SL[1], 36, 0], [3.65, SL[1], PY - 12, 0], [3.8, SL[1], PY - 12, 0],
    [4.6, 26, 70, 0], [5.6, 26, 70, 0], [5.9, p1[0], p1[1] - 4, 0], [6.3, p0[0], p0[1] - 4, 0], [6.8, 34, 62, 0]];
  const MD = [[1.1, 58, 62, 0], [1.8, q0[0], q0[1] - 4, 0], [2.0, q0[0], q0[1] - 4, 0], [2.5, q1[0], q1[1] - 4, 0],
    [3.4, q1[0], q1[1] - 4, 0], [3.65, BXF + 4, CT - 6, 0], [3.8, BXF + 4, CT + 2, 0], [3.9, BXF + 4, CT + 2, 0], [4.3, SL[2], 36, 0], [4.55, SL[2], PY - 12, 0], [4.65, SL[2], PY - 12, 0],
    [4.75, BXF + 4, CT - 6, 0], [4.9, BXF + 4, CT + 2, 0], [5.0, BXF + 4, CT + 2, 0], [5.4, SL[3], 36, 0], [5.65, SL[3], PY - 12, 0], [5.75, SL[3], PY - 12, 0],
    [5.9, q1[0], q1[1] - 4, 0], [6.3, q0[0], q0[1] - 4, 0], [6.8, 58, 62, 0]];
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 1.0) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 6.5) / 0.45)));
  const caixaX = (t, A) => BXF - 80 * (1 - A.easeOut(A.seg01(t, 0.8, 1.7))) - 90 * A.easeIn(A.seg01(t, 6.4, 7.2));
  const conta = (t) => 1 + IT.filter((g) => t >= g.solta).length;
  const OK = 6.0;
  function item(c, A, x, y, a = 1) {
    c.save(); c.globalAlpha = a; c.translate(x, y);
    c.fillStyle = A.rgb(A.cor.AMBER); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.5; c.lineJoin = 'round';
    c.beginPath(); c.rect(-4.2, -4, 8.4, 8); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-4.2, -1.2); c.lineTo(4.2, -1.2); c.strokeStyle = A.rgb(A.cor.BG, 0.7); c.lineWidth = 1; c.stroke();
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Recebendo mercadoria', dur: DUR,
    humor: (t) => t > OK && t < 7.2 ? 2 : t > 0.5 && t < OK ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.5, 8.3)));
      b.escala = A.lerp(1, 0.56, s); b.x = A.lerp(0, -18, s); b.y = A.lerp(b.y, -22, s);
      if (A.humor === 1) { b.pitch = 0.3; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (A.humor !== 1) return;
      let x = caixaX(t, A), y = 90;
      if (t > 1.8) { const p = pos(t > 3.7 ? 'd' : 'e', t); x = p[1]; y = p[2]; }
      o.lx = A.clamp((x - 32) / 40, -1, 1); o.ly = A.clamp((y - 28) / 40, -0.5, 1); o.lid = 0.22; o.kL = 140; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 2.36 + 0.06 * Math.sin(A.T * 5), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] - 2.36 + 0.06 * Math.sin(A.T * 5 + 1), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.5, 8.0)));
      if (ap > 0.01) {
        // prateleira com o contador
        c.save(); c.translate(96, PY); c.scale(ap, ap); c.translate(-96, -PY);
        A.linha(c, [[72, PY], [120, PY]], { lw: 2.2 });
        A.linha(c, [[74, PY], [74, PY + 6]], { lw: 1.6, a: 0.6 }); A.linha(c, [[118, PY], [118, PY + 6]], { lw: 1.6, a: 0.6 });
        item(c, A, SL[0], PY - 5);
        for (const g of IT) if (t >= g.solta) item(c, A, SL[g.vaga], PY - 5);
        const n = conta(t), ult = IT.find((g) => g.solta <= t && t < g.solta + 0.3), pop = ult ? 1 + 0.25 * A.arco(A.seg01(t, ult.solta, ult.solta + 0.3)) : 1;
        const ok = A.seg01(t, OK, OK + 0.3) * (1 - A.seg01(t, 7.2, 7.5)), cor = A.mix(A.cor.CREAM, A.cor.TEAL, ok);
        c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(cor); c.lineWidth = 1.8;
        c.beginPath(); c.roundRect(85, 66, 22, 20, 4); c.fill(); c.stroke();
        c.save(); c.translate(96, 76.6); c.scale(pop, pop); A.texto(c, String(n), 0, 0, { tam: 13, monoNum: true, cor }); c.restore();
        c.restore();
      }
      // itens na mão (saem de dentro da caixa: desenhados antes dela)
      for (const g of IT) {
        if (t < g.pega || t >= g.solta) continue;
        const p = pos(g.mao, t); item(c, A, p[1], p[2] + 7);
      }
      // caixa
      if (t < 0.8 || t > 7.2) return;
      const x = caixaX(t, A);
      const k = abre(t, A);
      c.save(); c.translate(x - BXF, 0);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2; c.lineJoin = 'round';
      c.beginPath(); c.rect(BXF - CW / 2, CT, CW, CA); c.fill(); c.stroke();
      A.linha(c, [[BXF - 4, CT + 7], [BXF + 4, CT + 7]], { lw: 1.4, a: 0.5 });
      for (const lado of [-1, 1]) {
        const p = abaPonta(lado, k);
        A.linha(c, [[BXF + lado * CW / 2, CT], p], { lw: 2.2 });
      }
      if (t < 1.8) for (let j = 0; j < 3; j++) A.linha(c, [[BXF - CW / 2 - 6 - j * 5, CT + 5 + j * 4], [BXF - CW / 2 - 14 - j * 5, CT + 5 + j * 4]], { lw: 1.2, a: 0.4 * (1 - A.seg01(t, 1.4, 1.8)) });   // rastro de movimento
      c.restore();
    },
  });
})();
