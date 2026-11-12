// Ficha técnica: o Pacioli vai para a esquerda e encolhe; um cartão de receita aparece à direita.
// As mãos pegam cada ingrediente na prateleira de baixo e o levam ao cartão, onde ele vira uma linha com
// quantidade (tomate 3 un, queijo 200 g, folha 10 g). Cartão completo: selo teal, olhos ^ ^, volta ao centro.
(() => {
  const DUR = 8;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  // quadros-chave [tempo, x, y, giro]
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const MX = 26, MY = 34;                              // onde o mascote fica durante a ação
  const CX0 = 60, CX1 = 110, CY0 = 12, CY1 = 92;       // cartão
  const LIN = [36, 54, 72];                            // linhas do cartão
  // prateleira: [x, tipo]
  const PRAT = [[6, 'tomate'], [24, 'queijo'], [42, 'folha']];
  // mão esquerda: tomate e folha; mão direita: queijo
  const ME = [[0.9, 16, 62, 0], [1.4, 6, 86, -0.2], [1.65, 6, 86, -0.2], [2.35, 66, LIN[0] - 4, 0.3], [2.6, 66, LIN[0] - 4, 0.3],
    [3.3, 42, 86, 0], [3.55, 42, 86, 0], [4.25, 66, LIN[2] - 4, 0.3], [4.5, 66, LIN[2] - 4, 0.3], [5.1, 16, 62, 0]];
  const MD = [[0.9, 36, 62, 0], [2.0, 36, 62, 0], [2.45, 24, 86, 0.2], [2.7, 24, 86, 0.2], [3.35, 66, LIN[1] - 4, 0.3], [3.6, 66, LIN[1] - 4, 0.3], [4.3, 36, 62, 0]];
  // ingredientes: quem leva, pega, solta, linha, quantidade
  const ING = [
    { mao: 'e', tipo: 'tomate', pega: 1.65, solta: 2.6, lin: 0, qtd: '3 un' },
    { mao: 'd', tipo: 'queijo', pega: 2.7, solta: 3.6, lin: 1, qtd: '200 g' },
    { mao: 'e', tipo: 'folha', pega: 3.55, solta: 4.5, lin: 2, qtd: '10 g' },
  ];
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.6) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 5.0) / 0.5)));
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.0, 7.8)));
  const cartao = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 6.6, 7.2)));
  function icone(c, A, tipo, x, y, s = 1) {
    c.save(); c.translate(x, y); c.scale(s, s); c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round'; c.strokeStyle = A.rgb(A.cor.CREAM);
    if (tipo === 'tomate') {
      c.fillStyle = A.rgb(A.cor.RED); c.beginPath(); c.ellipse(0, 0.5, 5, 4.4, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = A.rgb(A.cor.GREEN); c.beginPath(); c.moveTo(-2.2, -3.4); c.lineTo(0, -5.6); c.lineTo(2.2, -3.4); c.closePath(); c.fill(); c.stroke();
    }
    if (tipo === 'queijo') {
      c.fillStyle = A.rgb(A.cor.AMBER); c.beginPath(); c.moveTo(-5.5, 3.5); c.lineTo(5.5, 3.5); c.lineTo(5.5, -1); c.lineTo(-5.5, -3.8); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = A.rgb(A.cor.BG); for (const [a, b] of [[-1.5, 0.6], [2.6, 1.4]]) { c.beginPath(); c.arc(a, b, 0.9, 0, Math.PI * 2); c.fill(); }
    }
    if (tipo === 'folha') {
      c.fillStyle = A.rgb(A.cor.GREEN); c.beginPath(); c.moveTo(-5.5, 1); c.quadraticCurveTo(0, -5.5, 5.5, 0); c.quadraticCurveTo(0, 4.5, -5.5, 1); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-4.5, 0.8); c.lineTo(4.5, 0); c.strokeStyle = A.rgb(A.cor.BG, 0.6); c.lineWidth = 0.8; c.stroke();
    }
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Ficha técnica', dur: DUR,
    humor: (t) => t > 5.0 && t < 6.6 ? 2 : t > 0.6 && t < 5.0 ? 1 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.56, s); b.x = A.lerp(0, MX - 50, s); b.y = A.lerp(b.y, MY - 50, s);
      if (A.humor === 1) { b.pitch = 0.22; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.3; },
    olhos(o, t, A) {
      if (A.humor !== 1) return;
      const quem = t < 2.6 ? 'e' : t < 3.55 ? 'd' : 'e';
      const p = pos(quem, t);
      o.lx = A.clamp((p[1] - MX) / 30, -1, 1); o.ly = A.clamp((p[2] - MY) / 40, -0.6, 1); o.lid = 0.25; o.kL = 120; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 0.08 * Math.sin(A.T * 6), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] + 0.08 * Math.sin(A.T * 6 + 1), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = cartao(t, A); if (ap <= 0.01) return;
      // prateleira com os ingredientes esperando
      A.linha(c, [[-4, 98], [50, 98]], { a: 0.35 * ap });
      for (const [i, [x, tipo]] of PRAT.entries()) if (t < ING[i].pega) icone(c, A, tipo, x, 92, ap);
      // cartão de receita
      c.save(); c.translate((CX0 + CX1) / 2, (CY0 + CY1) / 2); c.scale(ap, ap); c.translate(-(CX0 + CX1) / 2, -(CY0 + CY1) / 2);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
      c.beginPath(); c.roundRect(CX0, CY0, CX1 - CX0, CY1 - CY0, 4); c.fill(); c.stroke();
      A.texto(c, 'Ficha técnica', (CX0 + CX1) / 2, CY0 + 8, { tam: 4.6, peso: 600 });
      A.linha(c, [[CX0 + 5, CY0 + 14], [CX1 - 5, CY0 + 14]], { lw: 1.2, a: 0.5 });
      for (const [k, y] of LIN.entries()) {
        const g = ING[k], u = A.seg01(t, g.solta - 0.05, g.solta + 0.25);
        A.linha(c, [[CX0 + 5, y + 7.5], [CX1 - 5, y + 7.5]], { lw: 0.9, a: 0.22 });
        if (u > 0) {
          icone(c, A, g.tipo, CX0 + 9, y, 0.7 + 0.15 * A.back(u));
          // quantidade digita da esquerda para a direita
          const n = Math.ceil(g.qtd.length * A.seg01(t, g.solta + 0.1, g.solta + 0.45));
          if (n > 0) A.texto(c, g.qtd.slice(0, n), CX1 - 6, y, { tam: 6, peso: 600, alinhar: 'right', monoNum: true });
        }
      }
      // selo de cartão completo (encolhe junto com o cartão)
      const ok = A.seg01(t, 5.0, 5.3);
      if (ok > 0) {
        const s = A.back(ok);
        c.save(); c.translate(CX1 - 6, CY1 - 6); c.scale(s, s);
        c.fillStyle = A.rgb(A.cor.TEAL); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, 0, 7.5, 0, Math.PI * 2); c.fill(); c.stroke();
        A.linha(c, [[-3.4, 0.2], [-0.9, 2.8], [3.6, -2.6]], { lw: 2 });
        c.restore();
      }
      c.restore();
    },
    frente(c, t, A) {
      // ingrediente na mão, logo abaixo da ponta
      for (const g of ING) {
        if (t < g.pega || t > g.solta) continue;
        const p = pos(g.mao, t); icone(c, A, g.tipo, p[1], p[2] + 7);
      }
    },
  });
})();
