// Revertendo OP: o inverso do 20. O prato pronto aparece tampado; a mão direita levanta a cloche, as duas mãos
// devolvem molho, folha e proteína para as prateleiras das laterais, o prato some e uma seta de desfazer
// se desenha no lugar ("OP revertida"). As mãos voltam e tudo some antes do fim do laço.
(() => {
  const DUR = 8;
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const kf = (K, t) => {
    if (t <= K[0][0]) return K[0];
    for (let i = 1; i < K.length; i++) if (t <= K[i][0]) {
      const a = K[i - 1], b = K[i], u = ease((t - a[0]) / (b[0] - a[0]));
      return a.map((x, j) => x + (b[j] - x) * u);
    }
    return K[K.length - 1];
  };
  const PX = 50, PY = 92;
  // esquerda: molho → prateleira esq. de baixo, proteína → prateleira esq.
  const ME = [[0.9, 30, 70, 0], [2.0, 30, 70, 0], [2.5, 50, 81, 0.15], [2.75, 50, 81, 0.15], [3.4, 14, 88, -0.3], [3.6, 14, 88, -0.3],
    [4.1, 42, 83, 0.2], [4.3, 42, 83, 0.2], [4.9, -3, 86, -0.3], [5.1, -3, 86, -0.3], [5.7, 30, 70, 0]];
  // direita: levanta a cloche, depois folha → prateleira dir.
  const MD = [[0.9, 70, 70, 0], [1.3, 50, 71, 0], [1.45, 50, 71, 0], [2.0, 74, 54, 0.4], [2.6, 72, 66, 0], [3.1, 57, 83, -0.2], [3.3, 57, 83, -0.2],
    [3.9, 98, 86, 0.3], [4.1, 98, 86, 0.3], [4.6, 76, 74, 0.6], [5.7, 70, 70, 0]];
  // ingredientes: no prato até "pega", na mão até "solta", depois na prateleira (x, y)
  const ING = [
    { mao: 'e', tipo: 'proteina', px: PX - 8, py: PY - 3, pega: 4.3, solta: 5.1, sx: -3, sy: 92 },
    { mao: 'd', tipo: 'folha', px: PX + 7, py: PY - 3, pega: 3.3, solta: 4.1, sx: 98, sy: 92 },
    { mao: 'e', tipo: 'molho', px: PX, py: PY - 5, pega: 2.75, solta: 3.6, sx: 14, sy: 94 },
  ];
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.55) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 5.6) / 0.5)));
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.2, 7.9)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.0, 7.5)));
  function ingrediente(c, A, tipo, x, y, s = 1) {
    if (s <= 0.01) return;
    c.save(); c.translate(x, y); c.scale(s, s); c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round';
    if (tipo === 'proteina') { c.fillStyle = A.rgb(A.cor.AMBER); c.strokeStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.ellipse(0, 0, 7, 3.6, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-3, -1.5); c.lineTo(-1, 1.5); c.moveTo(1, -1.5); c.lineTo(3, 1.5); c.strokeStyle = A.rgb(A.cor.BG); c.stroke(); }
    if (tipo === 'folha') { c.fillStyle = A.rgb(A.cor.GREEN); c.strokeStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.moveTo(-6, 1); c.quadraticCurveTo(0, -6, 6, 0); c.quadraticCurveTo(0, 5, -6, 1); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-5, 0.8); c.lineTo(5, 0); c.strokeStyle = A.rgb(A.cor.BG, 0.6); c.lineWidth = 0.8; c.stroke(); }
    if (tipo === 'molho') { c.fillStyle = A.rgb(A.cor.RED); c.strokeStyle = A.rgb(A.cor.CREAM); for (const [a, b] of [[-3, 0], [0, -1.6], [3, 0.4]]) { c.beginPath(); c.arc(a, b, 1.9, 0, Math.PI * 2); c.fill(); c.stroke(); } }
    c.restore();
  }
  Pacioli.acao({
    titulo: 'Revertendo OP', dur: DUR,
    humor: (t) => t > 5.5 && t < 6.9 ? 2 : t > 0.5 && t <= 5.5 ? 1 : 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.6, s); b.y = A.lerp(b.y, -18, s);
      if (A.humor === 1) { b.pitch = 0.32; b.onda = 0.35; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor !== 1) return;
      const quem = t < 2.2 ? 'd' : t < 3.6 ? 'e' : t < 4.2 ? 'd' : 'e';
      const p = pos(quem, t);
      o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = t < 2.0 ? 0.5 : 0.9; o.lid = 0.25; o.kL = 120; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 0.08 * Math.sin(A.T * 6), s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] + 0.08 * Math.sin(A.T * 6 + 1), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      A.linha(c, [[-8, 98], [18, 98]], { a: 0.35 * ap }); A.linha(c, [[86, 98], [110, 98]], { a: 0.35 * ap });
      // ingredientes já devolvidos às prateleiras
      for (const g of ING) if (t >= g.solta) ingrediente(c, A, g.tipo, g.sx, g.sy, ap);
      // prato: some depois de vazio
      const pr = ap * (1 - A.easeIn(A.seg01(t, 5.0, 5.4)));
      if (pr > 0.01) {
        c.save(); c.translate(PX, PY); c.scale(pr, pr);
        c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
        c.beginPath(); c.ellipse(0, 0, 22, 6.5, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        c.lineWidth = 1; c.strokeStyle = A.rgb(A.cor.CREAM, 0.35); c.beginPath(); c.ellipse(0, -0.6, 15, 4, 0, 0, Math.PI * 2); c.stroke();
        c.restore();
        // ingredientes ainda no prato (por baixo da cloche)
        for (const g of ING) if (t < g.pega) ingrediente(c, A, g.tipo, g.px, g.py, ap);
      }
      // cloche: começa tampando, a mão direita levanta e ela some no alto
      const lev = A.smooth(A.seg01(t, 1.3, 1.5)), some = A.easeIn(A.seg01(t, 1.7, 2.1));
      if (some < 1) {
        // presa pelo pegador logo abaixo da ponta da mão; gira em torno dele
        const p = pos('d', t), x = A.lerp(PX, p[1], lev), y = A.lerp(PY - 14.4, p[2] + 5, lev);
        c.save(); c.translate(PX, PY); c.scale(ap, ap); c.translate(-PX, -PY); c.translate(x, y); c.rotate(0.35 * A.seg01(t, 1.5, 2.0)); c.globalAlpha = 1 - some;
        c.fillStyle = A.rgb(A.cor.BG, 0.92); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(-18, 13.4); c.bezierCurveTo(-18, -3.6, 18, -3.6, 18, 13.4); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.arc(0, 0, 2, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }
    },
    frente(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      // ingredientes na mão (sobem do prato para a mão em 0,2 s)
      for (const g of ING) {
        if (t >= g.pega && t < g.solta) { const p = pos(g.mao, t), u = A.easeOut(A.seg01(t, g.pega, g.pega + 0.2)); ingrediente(c, A, g.tipo, A.lerp(g.px, p[1], u), A.lerp(g.py, p[2] + 6, u)); }
      }
      // seta de desfazer: o arco se desenha da direita para a esquerda, ponta para baixo
      const u = A.easeOut(A.seg01(t, 5.2, 5.8)), sa = 1 - A.easeIn(A.seg01(t, 6.8, 7.2));
      if (u > 0 && sa > 0) {
        const cx = PX, cy = 88, r = 9, a1 = -Math.PI * 1.05 * u;
        c.save(); c.globalAlpha = sa; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 2.6; c.strokeStyle = A.rgb(A.cor.TEAL);
        c.beginPath(); c.arc(cx, cy, r, 0.25, a1, true); c.stroke();
        if (u > 0.5) {
          const tx = cx + r * Math.cos(a1), ty = cy + r * Math.sin(a1), dx = Math.sin(a1), dy = -Math.cos(a1), k = A.back(A.seg01(t, 5.5, 5.8)) * 4.2;
          c.beginPath(); c.moveTo(tx + (-dx * 0.9 - dy * 0.75) * k, ty + (-dy * 0.9 + dx * 0.75) * k); c.lineTo(tx, ty);
          c.lineTo(tx + (-dx * 0.9 + dy * 0.75) * k, ty + (-dy * 0.9 - dx * 0.75) * k); c.stroke();
        }
        c.restore();
        A.texto(c, 'OP revertida', PX, 103, { tam: 3.8, peso: 500, a: 0.85 * A.seg01(t, 5.6, 5.9) * sa });
      }
    },
  });
})();
