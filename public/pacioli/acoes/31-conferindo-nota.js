// Conferindo nota: o Pacioli vai para a esquerda e uma nota fiscal desce ao lado. Uma mão percorre linha por linha
// e marca um check teal em cada; a quarta não bate, ganha marca âmbar e ele para e olha para você. Depois termina e a nota sobe.
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
  const NX = 58, NW = 52, NY0 = 12, NH = 88;                       // nota (papel)
  const LY = [34, 45, 56, 67, 78, 89];                              // linhas
  const LW = [26, 20, 30, 24, 18, 27];                              // tamanho do texto de cada linha
  const X0 = NX + 6, X1 = NX + 38, XM = NX + 45;                    // começo/fim da leitura, coluna das marcas
  const RUIM = 3;                                                   // linha que não bate
  const INI = [1.4, 2.0, 2.6, 3.2, 4.95, 5.55], LEN = 0.5;          // quando cada linha é lida
  const OLHA = [3.8, 4.75];                                         // olha para você
  const FIM = 6.15;
  // mão: entra na frente de cada linha, corre até o fim, desce para a próxima
  const K = [[0.9, 44, 66, 0]];
  LY.forEach((y, i) => { K.push([INI[i], X0, y - 4, 0]); K.push([INI[i] + LEN, X1, y - 4, 0]); if (i === RUIM) { K.push([OLHA[0] + 0.2, X1 - 5, y - 8, -0.3]); K.push([OLHA[1], X1 - 5, y - 8, -0.3]); } });
  K.push([6.6, 44, 66, 0]);
  const mix = (t) => Math.min(1, Math.max(0, (t - 0.7) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 6.4) / 0.45)));
  const desce = (t, A) => A.easeOut(A.seg01(t, 0.55, 1.2)) * (1 - A.easeIn(A.seg01(t, 7.5, 8.1)));
  Pacioli.acao({
    titulo: 'Conferindo nota', dur: DUR,
    humor: (t) => t > 0.5 && t < 6.9 ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.7, 8.5)));
      b.escala = A.lerp(1, 0.62, s); b.x = A.lerp(0, -26, s); b.y = A.lerp(b.y, -6, s);
      if (A.humor === 1) { b.pitch = 0.22; b.onda = 0.3; b.giro = 0; }
      if (t > OLHA[0] && t < OLHA[1]) { b.pitch = 0.08; b.yaw = 0; }
    },
    petalas(PT, t, A) {
      const olha = t > OLHA[0] && t < OLHA[1] ? 0.15 : 0.35;      // ao olhar para você, a flor se fecha e o rosto aparece
      if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= olha;
    },
    olhos(o, t, A) {
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (t > OLHA[0] && t < OLHA[1]) { o.lx = 0; o.ly = 0; o.lid = 0; o.dy = -4.5; o.h = 22; o.kL = 160; o.cL = 16; return; }   // e isso aqui?
      const p = kf(K, t);
      o.lx = A.clamp((p[1] - 24) / 40, -1, 1); o.ly = A.clamp((p[2] - 50) / 35, -0.6, 1); o.lid = 0.3; o.kL = 160; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const p = kf(K, t);
      H[A.TRIS[3]] = { x: p[1], y: p[2], rot: p[3] + 0.45 + 0.05 * Math.sin(A.T * 7), s: 0.95, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const d = desce(t, A); if (d <= 0.01) return;
      const dy = (1 - d) * -120;
      c.save(); c.translate(0, dy);
      // papel com borda serrilhada embaixo
      c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(NX, NY0); c.lineTo(NX + NW, NY0); c.lineTo(NX + NW, NY0 + NH);
      for (let k = 0; k < 8; k++) { const x = NX + NW - (k + 0.5) * NW / 8; c.lineTo(x, NY0 + NH - 2.4); c.lineTo(x - NW / 16, NY0 + NH); }
      c.closePath(); c.fill(); c.stroke();
      A.texto(c, 'NF-e', NX + 6, NY0 + 9, { tam: 5.5, peso: 700, alinhar: 'left' });
      A.linha(c, [[NX + 30, NY0 + 9], [NX + NW - 6, NY0 + 9]], { a: 0.4, lw: 1.4 });
      A.linha(c, [[NX + 4, NY0 + 15], [NX + NW - 4, NY0 + 15]], { a: 0.3, lw: 1 });
      LY.forEach((y, i) => {
        const lida = A.seg01(t, INI[i], INI[i] + LEN);
        A.linha(c, [[X0, y], [X0 + LW[i], y]], { a: 0.55, lw: 2.2 });
        if (lida > 0 && t < 7.4) A.linha(c, [[X0, y], [X0 + LW[i] * lida, y]], { cor: i === RUIM ? A.cor.AMBER : A.cor.CREAM, lw: 2.2 });
      });
      c.restore();
    },
    frente(c, t, A) {
      const d = desce(t, A); if (d <= 0.01) return;
      c.save(); c.translate(0, (1 - d) * -120);
      LY.forEach((y, i) => {
        const m = A.seg01(t, INI[i] + LEN, INI[i] + LEN + 0.2); if (m <= 0) return;
        c.save(); c.translate(XM, y); c.scale(A.back(m), A.back(m));
        if (i === RUIM) {        // marca âmbar: círculo com "!"
          const pul = 1 + 0.12 * Math.sin(A.T * 9) * (t < OLHA[1] ? 1 : 0.3);
          c.scale(pul, pul); c.fillStyle = A.rgb(A.cor.AMBER); c.beginPath(); c.arc(0, 0, 4.2, 0, Math.PI * 2); c.fill();
          A.linha(c, [[0, -2.2], [0, 0.6]], { cor: A.cor.BG, lw: 1.6 }); c.fillStyle = A.rgb(A.cor.BG); c.beginPath(); c.arc(0, 2.3, 0.85, 0, Math.PI * 2); c.fill();
        } else {
          c.fillStyle = A.rgb(A.cor.TEAL); c.beginPath(); c.arc(0, 0, 4.2, 0, Math.PI * 2); c.fill();
          A.linha(c, [[-2, 0.1], [-0.5, 1.7], [2.2, -1.5]], { lw: 1.4 });
        }
        c.restore();
      });
      c.restore();
    },
  });
})();
