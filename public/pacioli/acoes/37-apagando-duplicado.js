// Apagando duplicado: uma lista embaixo tem duas linhas iguais. O Pacioli acha as duas (marca âmbar), uma mão vira
// borracha e esfrega a linha repetida, que se desfaz em pedacinhos; a lista sobe, fecha o espaço e ganha um check teal.
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
  const L = [['Arroz', '5 kg'], ['Queijo', '2 kg'], ['Queijo', '2 kg'], ['Óleo', '900 ml']];
  const DUP = 2, X0 = 16, X1 = 84, Y0 = 60, RH = 12;           // painel e altura de linha
  const ry = (i) => Y0 + 7 + i * RH;
  const ACHA = 1.7, A0 = 2.7, A1 = 3.7, SOBE = [3.8, 4.25], OK = 4.4;
  const ME = [[1.9, 72, 54, 0], [2.5, X0 + 3, ry(DUP) - 2, 0], [A0, X0 + 3, ry(DUP) - 2, 0], [A1, X1 - 2, ry(DUP) - 2, 0], [4.3, 72, 54, 0]];
  const pos = (t) => kf(ME, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 1.9) / 0.3)) * (1 - Math.min(1, Math.max(0, (t - 4.1) / 0.4)));
  const borrX = (t) => pos(t)[1];
  // pedacinhos: aparecem quando a borracha passa e caem
  const PED = Array.from({ length: 26 }, (_, k) => {
    const r = (n) => { const s = Math.sin(k * 127.1 + n * 311.7) * 43758.5; return s - Math.floor(s); };
    return { x: X0 + 3 + k * (X1 - X0 - 6) / 25, dy: (r(1) - 0.5) * 5, vx: (r(2) - 0.5) * 18, vy: -6 - r(3) * 10, giro: (r(4) - 0.5) * 12, tam: 1.4 + r(5) * 1.4 };
  });
  Pacioli.acao({
    titulo: 'Apagando duplicado', dur: DUR,
    humor: (t) => t > OK && t < 5.8 ? 2 : t > 0.5 && t < OK ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.4, 7.2)));
      b.escala = A.lerp(1, 0.54, s); b.y = A.lerp(b.y, -28, s);
      if (A.humor === 1) { b.pitch = 0.36; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (A.humor !== 1) return;
      o.kL = 140; o.cL = 16; o.ly = 0.95;
      if (t < ACHA) { o.lx = 0.5 * Math.sin(t * 5); o.lid = 0.35; return; }
      if (t < 2.5) { o.lx = 0; o.lid = 0; o.h = 22; o.piscar = false; return; }      // achou o repetido
      o.lx = A.clamp((borrX(t) - 50) / 40, -1, 1); o.lid = 0.35;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const p = pos(t), esfrega = t > A0 && t < A1 ? 1 : 0;
      H[A.TRIS[3]] = { x: p[1] + esfrega * 1.5 * Math.sin(t * 40), y: p[2] + esfrega * 2.2 * Math.sin(t * 40 + 1.2), rot: -2.36 + esfrega * 0.25 * Math.sin(t * 40), s: 1.1, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = A.back(A.seg01(t, 0.35, 0.85)) * (1 - A.easeIn(A.seg01(t, 6.0, 6.5)));
      if (ap <= 0.01) return;
      const fecha = A.easeInOut(A.seg01(t, SOBE[0], SOBE[1])), H = L.length * RH + 2 - fecha * RH;
      c.save(); c.translate(50, Y0); c.scale(ap, ap); c.translate(-50, -Y0);
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.roundRect(X0 - 4, Y0, X1 - X0 + 8, H, 3); c.fill(); c.stroke();
      const marca = A.seg01(t, ACHA, ACHA + 0.2) * (1 - A.seg01(t, A1 - 0.2, A1));
      for (let i = 0; i < L.length; i++) {
        let y = ry(i), a = 1, corte = -1;
        if (i > DUP) y -= fecha * RH;
        if (i === DUP) { if (t > A1) continue; if (t > A0) corte = borrX(t); }
        if (i > 0 && i < L.length && !(i > DUP && fecha > 0.5)) A.linha(c, [[X0, y - RH / 2], [X1, y - RH / 2]], { a: 0.18, lw: 1 });
        if ((i === 1 || i === DUP) && marca > 0) {           // as duas iguais ficam marcadas
          c.save(); c.strokeStyle = A.rgb(A.cor.AMBER, marca); c.lineWidth = 1.6; c.beginPath(); c.roundRect(X0 - 1.5, y - RH / 2 + 1.2, X1 - X0 + 3, RH - 2.4, 2); c.stroke(); c.restore();
        }
        c.save();
        if (corte > -1) { c.beginPath(); c.rect(corte, y - RH, 200, RH * 2); c.clip(); }
        A.texto(c, L[i][0], X0 + 2, y + 0.3, { tam: 5.4, peso: 500, alinhar: 'left', a });
        A.texto(c, L[i][1], X1 - 2, y + 0.3, { tam: 5.4, peso: 500, alinhar: 'right', monoNum: true, a: 0.75 * a });
        c.restore();
      }
      c.restore();
      // check do lado
      const ok = A.seg01(t, OK, OK + 0.3) * (1 - A.seg01(t, 5.8, 6.1));
      if (ok > 0) {
        c.save(); c.translate(X1 + 13, Y0 + 8); c.scale(A.back(ok), A.back(ok));
        c.fillStyle = A.rgb(A.cor.TEAL); c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
        A.linha(c, [[-2.8, 0.2], [-0.7, 2.3], [3, -2.1]], { lw: 1.7 });
        c.restore();
      }
    },
    frente(c, t, A) {
      if (t < A0 || t > A1 + 1) return;
      const y0 = ry(DUP);
      for (const p of PED) {
        const t0 = A0 + (A1 - A0) * ((p.x - (X0 + 3)) / (X1 - 2 - (X0 + 3)));
        const s = t - t0; if (s < 0 || s > 0.7) continue;
        const a = 1 - s / 0.7;
        c.save(); c.translate(p.x + p.vx * s, y0 + p.dy + p.vy * s + 40 * s * s); c.rotate(p.giro * s);
        c.fillStyle = A.rgb(A.cor.CREAM, a); c.fillRect(-p.tam / 2, -p.tam / 2, p.tam, p.tam);
        c.restore();
      }
    },
  });
})();
