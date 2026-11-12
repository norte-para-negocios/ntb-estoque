// Ordem de produção: o Pacioli sobe, solta os dois triângulos de baixo da tela como mãos e monta um prato
// (base, proteína, folha, molho), tampa com a cloche, a tela pisca teal e as mãos voltam para o corpo.
(() => {
  const DUR = 8;
  // quadros-chave [tempo, x, y, giro]; entre eles, vai e volta suave
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = Pacioli._ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  Pacioli._ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const PX = 50, PY = 92;                       // prato
  // mão esquerda pega na prateleira da esquerda, a direita na da direita; cada ingrediente desce até o prato
  const ME = [[0.9, 30, 70, 0], [1.4, 0, 84, -0.3], [1.8, 0, 84, -0.3], [2.5, 42, 82, 0.2], [2.8, 42, 82, 0.2], [3.4, 12, 86, -0.3], [3.8, 12, 86, -0.3], [4.5, 46, 80, 0.15], [4.8, 46, 80, 0.15], [5.3, 24, 74, -0.6], [6.0, 24, 74, -0.6], [6.5, 30, 70, 0]];
  const MD = [[0.9, 70, 70, 0], [1.6, 70, 70, 0], [2.3, 98, 84, 0.3], [2.7, 98, 84, 0.3], [3.4, 58, 81, -0.2], [3.7, 58, 81, -0.2], [4.2, 76, 74, 0.6], [5.3, 76, 74, 0.6], [6.0, 76, 74, 0.6], [6.5, 70, 70, 0]];
  // ingredientes: [quem leva, pega em, solta em, alvo no prato x, y, desenho]
  const ING = [
    { mao: 'e', pega: 1.8, solta: 2.8, dx: -8, dy: -3, tipo: 'proteina' },
    { mao: 'd', pega: 2.7, solta: 3.7, dx: 7, dy: -3, tipo: 'folha' },
    { mao: 'e', pega: 3.8, solta: 4.8, dx: 0, dy: -5, tipo: 'molho' },
  ];
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.55) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 6.4) / 0.5)));
  let A_;
  function ingrediente(c, tipo, x, y, s = 1) {
    const A = A_; c.save(); c.translate(x, y); c.scale(s, s); c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round';
    if (tipo === 'proteina') { c.fillStyle = A.rgb(A.cor.AMBER); c.strokeStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.ellipse(0, 0, 7, 3.6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-3, -1.5); c.lineTo(-1, 1.5); c.moveTo(1, -1.5); c.lineTo(3, 1.5); c.strokeStyle = A.rgb(A.cor.BG); c.stroke(); }
    if (tipo === 'folha') { c.fillStyle = A.rgb(A.cor.GREEN); c.strokeStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.moveTo(-6, 1); c.quadraticCurveTo(0, -6, 6, 0); c.quadraticCurveTo(0, 5, -6, 1); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-5, 0.8); c.lineTo(5, 0); c.strokeStyle = A.rgb(A.cor.BG, 0.6); c.lineWidth = 0.8; c.stroke(); }
    if (tipo === 'molho') { c.fillStyle = A.rgb(A.cor.RED); c.strokeStyle = A.rgb(A.cor.CREAM); for (const [a, b] of [[-3, 0], [0, -1.6], [3, 0.4]]) { c.beginPath(); c.arc(a, b, 1.9, 0, Math.PI * 2); c.fill(); c.stroke(); } }
    c.restore();
  }
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  Pacioli.acao({
    titulo: 'Fazendo prato (ordem de produção)', dur: DUR,
    humor: (t) => t > 5.95 && t < 7.2 ? 2 : t > 0.5 && t < 5.95 ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.2, 7.9)));
      b.escala = A.lerp(1, 0.6, s); b.y = A.lerp(b.y, -18, s);
      if (A.humor === 1) { b.pitch = 0.32; b.onda = 0.35; b.giro = 0; }       // trabalhando, mas olhando pra baixo, flor só entreaberta
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor !== 1) return;
      const quem = t < 2.6 ? 'e' : t < 3.7 ? 'd' : t < 4.9 ? 'e' : 'e';
      const p = pos(quem, t);
      o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = 0.9; o.lid = 0.25; o.kL = 120; o.cL = 16;
    },
    maos(H, t, A) {
      A_ = A; const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 0.08 * Math.sin(A.T * 6), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] + 0.08 * Math.sin(A.T * 6 + 1), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      A_ = A;
      const ap = A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.3, 7.8)));
      if (ap <= 0.01) return;
      // prateleiras laterais com os ingredientes esperando
      for (const [x, tipo, pega] of [[0, 'proteina', 1.8], [98, 'folha', 2.7], [12, 'molho', 3.8]]) {
        if (t > pega && t < 7.3) continue;
        ingrediente(c, tipo, x, tipo === 'molho' ? 94 : 92, ap);
      }
      A.linha(c, [[-8, 98], [18, 98]], { a: 0.35 * ap }); A.linha(c, [[86, 98], [110, 98]], { a: 0.35 * ap });
      // prato
      c.save(); c.translate(PX, PY); c.scale(ap, ap);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
      c.beginPath(); c.ellipse(0, 0, 22, 6.5, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.lineWidth = 1; c.strokeStyle = A.rgb(A.cor.CREAM, 0.35); c.beginPath(); c.ellipse(0, -0.6, 15, 4, 0, 0, Math.PI * 2); c.stroke();
      c.restore();
    },
    frente(c, t, A) {
      A_ = A;
      const sai = A.easeIn(A.seg01(t, 7.3, 7.8));
      for (const g of ING) {
        if (t < g.pega) continue;
        let x, y;
        if (t < g.solta) { const p = pos(g.mao, t); x = p[1]; y = p[2] + 6; }                // na mão, embaixo da ponta
        else { const u = A.easeOut(A.seg01(t, g.solta, g.solta + 0.25)); const p = pos(g.mao, g.solta); x = A.lerp(p[1], PX + g.dx, u); y = A.lerp(p[2] + 6, PY + g.dy, u); }
        if (sai < 1) ingrediente(c, g.tipo, x, y, 1 - sai);
      }
      // cloche: a mão esquerda traz de cima (5.0–5.8), tampa; teal pisca; a direita levanta (6.6–7.2) e sai vapor
      const desce = A.easeInOut(A.seg01(t, 4.9, 5.8)), sobe = A.easeInOut(A.seg01(t, 6.6, 7.2));
      if (desce > 0 && sai < 1) {
        const y = A.lerp(60, PY - 1, desce) - sobe * 14, a = 1 - sai;
        c.save(); c.translate(PX, y); c.globalAlpha = a;
        c.fillStyle = A.rgb(A.cor.BG, 0.92); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(-18, 0); c.bezierCurveTo(-18, -17, 18, -17, 18, 0); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.arc(0, -13.4, 2, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }
      if (sobe > 0 && sai < 1) for (let k = 0; k < 3; k++) {   // vapor
        const ph = (A.T * 0.9 + k * 0.33) % 1, x = PX - 7 + k * 7;
        A.linha(c, [[x, PY - 6 - ph * 16], [x + 2 * Math.sin(ph * 9 + k), PY - 10 - ph * 16]], { a: (1 - ph) * sobe * 0.7 * (1 - sai), lw: 1.4 });
      }
      // selo da OP concluída
      const ok = A.seg01(t, 6.0, 6.3) * (1 - A.seg01(t, 7.3, 7.6));
      if (ok > 0) {
        c.save(); c.translate(88, 26); c.scale(A.back(ok), A.back(ok));
        c.fillStyle = A.rgb(A.cor.TEAL); c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill();
        A.linha(c, [[-3.2, 0.2], [-0.8, 2.6], [3.4, -2.4]], { lw: 1.8 });
        c.restore();
        A.texto(c, 'OP concluída', 88, 37, { tam: 3.6, peso: 500, a: ok * 0.8 });
      }
    },
  });
})();
