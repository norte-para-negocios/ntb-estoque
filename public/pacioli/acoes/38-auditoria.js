// Auditoria: uma lista longa rola embaixo; uma mão segura uma lupa que varre as linhas. Ao achar a linha com problema,
// a lista para, a linha acende âmbar, a lupa dá um zoom e os olhos do Pacioli arregalam. Depois tudo se recolhe.
(() => {
  const DUR = 8.5;
  const X0 = 14, X1 = 86, Y0 = 58, Y1 = 108, RH = 9;          // painel e altura de linha
  const ACHADA = 8, LY = 84;                                    // linha com problema e altura da lupa
  const OFF = Y0 + 4.5 + ACHADA * RH - LY;                      // rolagem final para a linha achada parar sob a lupa
  const R0 = 1.0, ACHA = 4.4, VOLTA = 6.1;
  const off = (t, A) => OFF * A.smooth(A.seg01(t, R0, ACHA));
  const rnd = (k, n) => { const s = Math.sin(k * 91.7 + n * 47.3) * 43758.5; return s - Math.floor(s); };
  // lupa: varre de um lado a outro enquanto rola; ao achar, vai para cima da linha
  const lupa = (t, A) => {
    const varre = 50 + 22 * Math.sin((t - R0) * 3.2);
    const fim = A.easeInOut(A.seg01(t, ACHA - 0.25, ACHA + 0.1));
    return { x: A.lerp(varre, 46, fim), y: LY };
  };
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.8) / 0.3)) * (1 - Math.min(1, Math.max(0, (t - VOLTA) / 0.45)));
  const LR = 8.5, HD = 0.75;                                    // raio da lente, direção do cabo (rad)
  const cabo = (L, z) => [L.x + Math.cos(HD) * (LR * z + 8), L.y + Math.sin(HD) * (LR * z + 8)];
  const zoom = (t, A) => 1 + 0.25 * A.back(A.seg01(t, ACHA, ACHA + 0.3)) * (1 - A.seg01(t, VOLTA - 0.3, VOLTA));
  Pacioli.acao({
    titulo: 'Auditoria', dur: DUR,
    humor: (t) => t > 0.5 && t < 6.8 ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.9, 7.7)));
      b.escala = A.lerp(1, 0.54, s); b.y = A.lerp(b.y, -28, s);
      if (A.humor === 1) { b.pitch = t > ACHA && t < VOLTA ? 0.12 : 0.34; b.onda = 0.3; b.giro = 0; }
      if (A.passou(ACHA + 0.05)) A.pulo(34);
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= t > ACHA && t < VOLTA ? 0.12 : 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      const L = lupa(t, A);
      o.lx = A.clamp((L.x - 50) / 35, -1, 1); o.ly = 0.95; o.lid = 0.3; o.kL = 160; o.cL = 16;
      if (t > ACHA && t < VOLTA) { o.lid = 0; o.h = 27; o.w = 10.5; o.ly = 0.6; o.piscar = false; }    // arregala
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const c = cabo(lupa(t, A), zoom(t, A));
      H[A.TRIS[3]] = { x: c[0] + 2, y: c[1] + 3, rot: -2.36 + 0.6, s: 1, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 6.6, 7.1)));
      if (ap <= 0.01) return;
      const o = off(t, A), acende = A.seg01(t, ACHA, ACHA + 0.15);
      c.save(); c.translate(50, Y0); c.scale(ap, ap); c.translate(-50, -Y0);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.roundRect(X0 - 3, Y0, X1 - X0 + 6, Y1 - Y0, 3); c.fill(); c.stroke();
      c.save(); c.beginPath(); c.rect(X0 - 2, Y0 + 1, X1 - X0 + 4, Y1 - Y0 - 2); c.clip();
      const i0 = Math.floor(o / RH);
      for (let i = i0; i < i0 + 7; i++) {
        const y = Y0 + 4.5 + i * RH - o;
        const achou = i === ACHADA && acende > 0;
        if (achou) { c.fillStyle = A.rgb(A.cor.AMBER, acende); c.beginPath(); c.roundRect(X0 - 1, y - RH / 2 + 0.8, X1 - X0 + 2, RH - 1.6, 2); c.fill(); }
        const w = 18 + rnd(i, 1) * 26, n = 5 + rnd(i, 2) * 7, cor = achou ? A.cor.BG : A.cor.CREAM;
        A.linha(c, [[X0 + 3, y], [X0 + 3 + w, y]], { lw: 2.2, cor, a: achou ? 1 : 0.6 });
        A.linha(c, [[X1 - 3 - n, y], [X1 - 3, y]], { lw: 2.2, cor, a: achou ? 1 : 0.45 });
      }
      c.restore();
      // barra de rolagem
      const sb = A.lerp(Y0 + 4, Y1 - 14, o / OFF);
      A.linha(c, [[X1 + 6, sb], [X1 + 6, sb + 10]], { lw: 1.8, a: 0.5 });
      c.restore();
    },
    frente(c, t, A) {
      const m = mix(t); if (m <= 0.01) return;
      const L = lupa(t, A), z = zoom(t, A) * A.easeOut(m), ach = A.seg01(t, ACHA, ACHA + 0.15) * (1 - A.seg01(t, VOLTA - 0.3, VOLTA));
      c.save(); c.translate(L.x, L.y); c.scale(z, z);
      c.lineCap = 'round'; c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(Math.cos(HD) * LR, Math.sin(HD) * LR); c.lineTo(Math.cos(HD) * (LR + 7), Math.sin(HD) * (LR + 7)); c.lineWidth = 3; c.stroke();
      c.strokeStyle = A.rgb(A.cor.BG); c.lineWidth = 4.4; c.beginPath(); c.arc(0, 0, LR, 0, Math.PI * 2); c.stroke();   // contorno escuro: a lente aparece até sobre o âmbar
      c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2 + 0.4 * ach;
      c.beginPath(); c.arc(0, 0, LR, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = A.rgb(A.cor.CREAM, 0.5); c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, LR - 3, -2.5, -1.7); c.stroke();
      c.restore();
    },
  });
})();
