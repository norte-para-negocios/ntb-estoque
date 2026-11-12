// Pesando: uma balança surge embaixo; as duas mãos trazem um pote e põem no prato; o ponteiro balança e estabiliza,
// o Pacioli lê o visor de olhos estreitos, aparece o peso, ele fica contente, e as mãos levam o pote embora.
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
  const PRATO = 80, DX = 50, DY = 98, DR = 11;     // altura do prato, mostrador
  const POUSA = 2.4, LE = 4.2, TIRA = 5.7, SOLTA = 6.5;
  // pote: [t, x, y] — chega pela esquerda nas duas mãos, desce no prato, sai pela direita
  const PK = [[1.0, -14, 64], [2.0, DX, 62], [POUSA, DX, PRATO - 7], [TIRA, DX, PRATO - 7], [TIRA + 0.3, DX, 64], [SOLTA, 104, 58]];
  const pote = (t) => kf(PK, t);
  const segura = (t) => t < POUSA + 0.05 || (t > TIRA - 0.05 && t < SOLTA);
  // mãos: com o pote, nos lados dele; sem pote, descansam ao lado
  const mao = (lado, t, A) => {
    const p = pote(t), lx = p[1] + lado * 13, ly = p[2] - 1;
    const rx = 50 + lado * 19, ry = 66;
    const u = A.easeInOut(A.seg01(t, POUSA, POUSA + 0.35)) * (1 - A.easeInOut(A.seg01(t, TIRA - 0.35, TIRA)));   // 1 = solto, descansando
    const v = A.easeInOut(A.seg01(t, SOLTA - 0.05, SOLTA + 0.4));                                                 // depois de largar o pote longe
    const sx = segura(t) ? lx : A.lerp(lx, rx, u), sy = segura(t) ? ly : A.lerp(ly, ry, u);
    return [A.lerp(sx, rx, v), A.lerp(sy, ry, v)];
  };
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.75) / 0.3)) * (1 - Math.min(1, Math.max(0, (t - 6.65) / 0.4)));
  const ALVO = 0.95;                                  // ângulo final do ponteiro (rad, a partir do zero)
  const ang = (t, A) => {
    if (t < POUSA) return 0;
    if (t > TIRA) return ALVO * (1 - A.easeOut(A.seg01(t, TIRA, TIRA + 0.5)));
    const s = t - POUSA; return ALVO * (1 - Math.exp(-2.4 * s) * Math.cos(9 * s));
  };
  Pacioli.acao({
    titulo: 'Pesando', dur: DUR,
    humor: (t) => t > LE + 0.15 && t < TIRA - 0.1 ? 2 : t > 0.5 && t < 6.9 ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.85, 7.6)));
      b.escala = A.lerp(1, 0.56, s); b.y = A.lerp(b.y, -24, s);
      if (A.humor === 1) { b.pitch = t > POUSA && t < LE ? 0.42 : 0.3; b.onda = 0.25; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= t > POUSA && t < LE ? 0.2 : 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (A.humor !== 1) return;
      if (t > POUSA && t < LE + 0.15) { o.lx = 0; o.ly = 1; o.lid = 0.55; o.w = 10; o.kL = 200; o.cL = 18; o.piscar = false; return; }   // lendo o visor
      const p = pote(t); o.lx = A.clamp((p[1] - 50) / 45, -1, 1); o.ly = 0.8; o.lid = 0.2; o.kL = 140; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = mao(-1, t, A), d = mao(1, t, A), mexe = segura(t) ? 0 : 0.06 * Math.sin(A.T * 5);
      H[A.TRIS[2]] = { x: e[0], y: e[1], rot: 0.79 + mexe, s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[0], y: d[1], rot: -0.79 - mexe, s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 6.8, 7.3)));
      if (ap <= 0.01) return;
      const peso = t > POUSA && t < TIRA ? A.arco(A.seg01(t, POUSA, POUSA + 0.25)) * 1.2 : 0;   // prato afunda um pouco ao receber
      c.save(); c.translate(50, 112); c.scale(ap, ap); c.translate(-50, -112);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2; c.lineJoin = 'round';
      // corpo
      c.beginPath(); c.moveTo(31, 112); c.lineTo(34, 84); c.lineTo(66, 84); c.lineTo(69, 112); c.closePath(); c.fill(); c.stroke();
      // haste e prato
      A.linha(c, [[50, 84], [50, PRATO + peso]], { lw: 2 });
      A.linha(c, [[29, PRATO + peso], [71, PRATO + peso]], { lw: 2.4 });
      // mostrador
      c.beginPath(); c.arc(DX, DY, DR, Math.PI, 0); c.closePath(); c.fill(); c.stroke();
      for (let k = 0; k <= 4; k++) { const a = Math.PI + k * Math.PI / 4; A.linha(c, [[DX + Math.cos(a) * (DR - 1.5), DY + Math.sin(a) * (DR - 1.5)], [DX + Math.cos(a) * (DR - 3.6), DY + Math.sin(a) * (DR - 3.6)]], { lw: 1, a: 0.6 }); }
      const g = Math.PI + 0.15 + ang(t, A) * 2;
      A.linha(c, [[DX, DY], [DX + Math.cos(g) * (DR - 2), DY + Math.sin(g) * (DR - 2)]], { cor: A.cor.AMBER, lw: 1.8 });
      c.fillStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.arc(DX, DY, 1.3, 0, Math.PI * 2); c.fill();
      c.restore();
      // leitura
      const r = A.seg01(t, LE, LE + 0.25) * (1 - A.seg01(t, TIRA, TIRA + 0.2));
      if (r > 0) {
        c.save(); c.translate(DX, DY + 7.6); c.scale(A.back(r), A.back(r));
        A.texto(c, '1,25 kg', 0, 0, { tam: 5.2, monoNum: true, cor: A.cor.TEAL });
        c.restore();
      }
    },
    frente(c, t, A) {
      const p = pote(t); if (t < 1.0 || t > SOLTA) return;
      const a = 1 - A.easeIn(A.seg01(t, SOLTA - 0.35, SOLTA));   // guardado: encolhe e some
      c.save(); c.translate(p[1], p[2] + (t > POUSA && t < TIRA ? A.arco(A.seg01(t, POUSA, POUSA + 0.25)) * 1.2 : 0)); c.scale(a, a);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.roundRect(-8, -5, 16, 12, 2.5); c.fill(); c.stroke();
      c.fillStyle = A.rgb(A.cor.AMBER); c.beginPath(); c.roundRect(-6.2, 0, 12.4, 5.2, 1.5); c.fill();
      c.fillStyle = A.rgb(A.cor.VIO); c.beginPath(); c.roundRect(-9, -8.5, 18, 3.6, 1.5); c.fill(); c.stroke();
      c.restore();
    },
  });
})();
