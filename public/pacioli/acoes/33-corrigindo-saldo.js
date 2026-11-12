// Corrigindo saldo: um saldo negativo vermelho aparece embaixo; o Pacioli franze os olhos, solta as mãos,
// arranca o sinal de menos e gira os dígitos até virar o saldo certo, creme; check teal e a tela pisca teal.
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
  const NY = 84, CWD = 9.4, TAM = 16;
  const ANTES = ['-', '3', ',', '2', ' ', 'k', 'g'], DEPOIS = ['', '4', ',', '8', ' ', 'k', 'g'];
  const OFF = [-3, -2, -1, 0, 0, 1.0, 1.62].map((k) => k * CWD);
  const cx0 = (i) => 57 + OFF[i];                                   // posição de cada caractere (kg menor e mais junto)
  const ARR = [2.45, 3.0], GIRA = [[1, 3.25, 3.75], [3, 3.95, 4.45]];  // arranca o menos; gira dígito i entre a e b
  const FIX = 4.45, OK = 4.65;
  const anda = (t, A) => -CWD / 2 * A.easeInOut(A.seg01(t, 2.85, 3.2));  // depois do menos sair, o número se recentra
  const cx = (i, t, A) => cx0(i) + anda(t, A);
  // esquerda: arranca o menos e gira o 3; direita: gira o 2
  const ME = [[1.8, 34, 64, 0], [2.3, cx0(0), NY - 15, 0], [2.45, cx0(0), NY - 12, 0], [2.95, 2, 62, -0.8],
    [3.15, cx0(1) - CWD / 2, NY - 16, 0], [3.25, cx0(1) - CWD / 2, NY - 13, 0], [3.75, cx0(1) - CWD / 2, NY - 13, Math.PI * 2 / 3], [4.1, 24, 66, Math.PI * 2 / 3], [4.9, 34, 64, Math.PI * 2 / 3]];
  const MD = [[1.8, 66, 64, 0], [3.6, 70, 64, 0], [3.85, cx0(3) - CWD / 2, NY - 16, 0], [3.95, cx0(3) - CWD / 2, NY - 13, 0], [4.45, cx0(3) - CWD / 2, NY - 13, -Math.PI * 2 / 3],
    [4.9, 66, 64, -Math.PI * 2 / 3]];
  const pos = (m, t) => kf(m === 'e' ? ME : MD, t);
  const mix = (t) => Math.min(1, Math.max(0, (t - 1.8) / 0.35)) * (1 - Math.min(1, Math.max(0, (t - 4.6) / 0.4)));
  Pacioli.acao({
    titulo: 'Corrigindo saldo', dur: DUR,
    humor: (t) => t > OK && t < 6.9 ? 2 : t > 1.8 && t < OK ? 1 : 0,
    corpo(b, t, A) {
      const s = A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 6.8, 7.6)));
      b.escala = A.lerp(1, 0.6, s); b.y = A.lerp(b.y, -20, s);
      if (t > 1.0 && t < 1.8) { b.pitch = 0.42; b.yaw = 0; b.roll = 0.04 * Math.sin(t * 22) * A.arco(A.seg01(t, 1.1, 1.5)); }  // olha feio pro número
      if (A.humor === 1) { b.pitch = 0.32; b.onda = 0.3; b.giro = 0; }
    },
    petalas(PT, t, A) { if (A.humor === 1) for (let i = 0; i < PT.length; i++) PT[i].t *= 0.35; },
    tela(cor, t, A) { if (t > 1.0 && t < 1.8) return A.mix(cor, A.cor.RED, 0.18); },
    olhos(o, t, A) {
      if (t > 1.0 && t < 1.8) { o.lx = 0; o.ly = 0.9; o.lid = 0.55; o.w = 10; o.piscar = false; return; }   // franze
      if (A.humor === 0) { o.lx = 0; o.ly = 0; return; }
      if (A.humor !== 1) return;
      const p = pos(t < 3.8 ? 'e' : 'd', t);
      o.lx = A.clamp((p[1] - 50) / 40, -1, 1); o.ly = 0.95; o.lid = 0.35; o.kL = 140; o.cL = 16;
    },
    maos(H, t, A) {
      const m = mix(t); if (m <= 0) return;
      const e = pos('e', t), d = pos('d', t);
      H[A.TRIS[2]] = { x: e[1], y: e[2], rot: e[3] + 2.36, s: 0.95, mix: A.easeOut(m) };
      H[A.TRIS[3]] = { x: d[1], y: d[2], rot: d[3] - 2.36, s: 0.95, mix: A.easeOut(m) };
    },
    frente(c, t, A) {
      const ap = A.back(A.seg01(t, 0.6, 1.0)) * (1 - A.easeIn(A.seg01(t, 6.5, 6.9)));
      if (ap <= 0.01) return;
      const fixo = A.seg01(t, FIX - 0.1, FIX + 0.15);
      c.save(); c.translate(50, NY); c.scale(ap, ap); c.translate(-50, -NY);
      for (let i = 0; i < ANTES.length; i++) {
        let ch = ANTES[i], sx = 1, x = cx(i, t, A), y = NY, rot = 0, a = 1, cor = A.mix(A.cor.RED, A.cor.CREAM, fixo);
        if (i === 0) {                       // o menos é arrancado e sai voando
          if (t > ARR[0]) { const p = pos('e', Math.min(t, ARR[1])), u = A.seg01(t, ARR[0], ARR[1]); x = p[1]; y = p[2] + 7; rot = -u * 5; a = 1 - A.seg01(t, ARR[1] - 0.2, ARR[1]); }
          if (a <= 0) continue;
        }
        const g = GIRA.find((q) => q[0] === i);
        if (g) {                             // gira em torno do eixo vertical e troca o dígito no meio da volta
          const u = A.seg01(t, g[1], g[2]), ang = u * Math.PI * 3;
          sx = Math.cos(ang); if (u > 0.5) ch = DEPOIS[i];
          if (u >= 1) { cor = A.cor.CREAM; sx = 1; }
          else if (u > 0) cor = u > 0.5 ? A.cor.CREAM : A.cor.RED;
        }
        if (ch === ' ') continue;
        c.save(); c.translate(x, y); c.rotate(rot); c.scale(Math.abs(sx) < 0.08 ? 0.08 : sx, 1);
        A.texto(c, ch, 0, 0.6, { tam: i > 3 ? TAM * 0.62 : TAM, peso: 600, monoNum: true, cor, a });
        c.restore();
      }
      c.restore();
      // sublinhado do saldo
      A.linha(c, [[cx0(0) - 4, NY + 11], [cx0(6) + 4, NY + 11]], { a: 0.3 * ap, lw: 1.2 });
      const ok = A.seg01(t, OK, OK + 0.3) * (1 - A.seg01(t, 6.4, 6.7));
      if (ok > 0) {
        c.save(); c.translate(cx0(6) + 14, NY); c.scale(A.back(ok), A.back(ok));
        c.fillStyle = A.rgb(A.cor.TEAL); c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
        A.linha(c, [[-2.8, 0.2], [-0.7, 2.3], [3, -2.1]], { lw: 1.7 });
        c.restore();
      }
    },
  });
})();
