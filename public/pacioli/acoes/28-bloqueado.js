// Omie bloqueou: o Pacioli vai para a esquerda; à direita um cadeado âmbar aparece e fecha (tranco), e embaixo
// um relógio de 30 minutos começa a correr. Ele fica sério e cruza os braços (as duas mãos em X na frente
// do corpo), olhando de vez em quando para o relógio: não precisa de você, só aguarda. Tempo cumprido: o cadeado abre.
(() => {
  const DUR = 8;
  const MX = 34, MY = 48, LX = 88, LY = 30, RX = 88, RY = 74;   // mascote, cadeado, relógio
  const FECHA = [0.9, 1.2], CORRE = [1.7, 6.3], ABRE = [6.35, 6.65];
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.6)) * (1 - A.easeInOut(A.seg01(t, 7.2, 7.9)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.8)) * (1 - A.easeIn(A.seg01(t, 7.0, 7.4)));
  // braços cruzados: [x, y, giro] de cada mão relativo ao centro do mascote
  const CRUZ = { e: [-6, 19, 2.6], d: [6, 21, 0.9] };   // esquerda aponta para a direita e vice-versa: um X raso
  const braco = (t, A) => A.easeInOut(A.seg01(t, 1.25, 1.8)) * (1 - A.easeInOut(A.seg01(t, 6.5, 7.0)));
  Pacioli.acao({
    titulo: 'Omie bloqueou', dur: DUR,
    humor: () => 0,
    passo(dt, t, A) { if (A.passou(FECHA[1])) A.tranco(0.45); },
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.66, s); b.x = A.lerp(0, MX - 50, s); b.y = A.lerp(0, MY - 50, s);
      // postura firme: de frente, levemente para trás, respirando devagar
      const br = braco(t, A);
      b.yaw = A.lerp(b.yaw, 0.04, s); b.pitch = A.lerp(b.pitch, 0.02 - 0.06 * br, s); b.escala += 0.008 * Math.sin(t * 2.2) * br;
    },
    olhos(o, t, A) {
      const s = ida(t, A); if (s < 0.3) return;
      o.piscar = true; o.kL = 70; o.cL = 13;
      // sério: pálpebra baixa e olhos um pouco mais estreitos
      const se = A.seg01(t, 1.0, 1.4) * (1 - A.seg01(t, ABRE[0], ABRE[1] + 0.2));
      o.lid = 0.1 * se; o.w = 9.6; o.h = A.lerp(20, 12, se);
      // para onde olha: cadeado quando fecha e quando abre; relógio de tempos em tempos; senão, para frente
      o.lx = 0; o.ly = 0;
      if (t > 0.6 && t < 1.5) { o.lx = 0.9; o.ly = -0.5; }
      else if ((t > 2.4 && t < 3.1) || (t > 4.4 && t < 5.1) || (t > 5.9 && t < ABRE[0])) { o.lx = 0.9; o.ly = 0.55; }
      else if (t >= ABRE[0] && t < 7.0) { o.lx = 0.9; o.ly = -0.5; }
    },
    maos(H, t, A) {
      const m = braco(t, A); if (m <= 0) return;
      const o = A.centro, k = A.escala / 0.66;
      for (const [q, i] of [['e', 2], ['d', 3]]) {
        const [dx, dy, r] = CRUZ[q];
        H[A.TRIS[i]] = { x: o.x + dx * k, y: o.y + dy * k, rot: r, s: 1.3, mix: m, cor: A.cor.BG };   // escuras, para destacar sobre a tela
      }
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      // relógio de 30 min: a fatia âmbar cresce, o ponteiro corre; embaixo, os minutos que faltam
      const rs = A.back(A.seg01(t, 1.3, 1.7)) * (1 - A.easeIn(A.seg01(t, 7.0, 7.4)));
      if (rs > 0.01) {
        const f = A.seg01(t, CORRE[0], CORRE[1]), a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * f, ok = A.seg01(t, ABRE[0], ABRE[1]);
        c.save(); c.translate(RX, RY); c.scale(rs, rs);
        c.fillStyle = A.rgb(A.cor.BG); c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.2;
        c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.fill();
        if (f > 0) { c.fillStyle = A.rgb(A.mix(A.cor.AMBER, A.cor.TEAL, ok)); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 13, a0, a1); c.closePath(); c.fill(); }
        c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.stroke();
        for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2; A.linha(c, [[Math.cos(a) * 10, Math.sin(a) * 10], [Math.cos(a) * 12, Math.sin(a) * 12]], { lw: 1.2, a: 0.7 }); }
        A.linha(c, [[0, 0], [Math.cos(a1) * 11, Math.sin(a1) * 11]], { lw: 2 });
        c.fillStyle = A.rgb(A.cor.CREAM); c.beginPath(); c.arc(0, 0, 1.6, 0, Math.PI * 2); c.fill();
        c.restore();
        const min = Math.max(0, Math.ceil(30 * (1 - f)));
        A.texto(c, min > 0 ? min + ' min' : 'liberado', RX, RY + 20, { tam: 5, peso: 600, monoNum: min > 0, a: rs, cor: min > 0 ? A.cor.CREAM : A.cor.TEAL });
      }
      // cadeado: surge aberto, fecha com estalo; no fim a alça sobe e ele fica teal
      const fecha = A.easeIn(A.seg01(t, FECHA[0], FECHA[1])), abre = A.easeOut(A.seg01(t, ABRE[0], ABRE[1]));
      const alca = 1 - fecha + abre;                                   // 0 fechado … 1 aberto
      c.save(); c.translate(LX, LY); c.scale(ap, ap);
      const cor = A.mix(A.cor.AMBER, A.cor.TEAL, abre);
      c.lineCap = 'round'; c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2.4;
      c.save(); c.translate(5.5, -5 - 5 * alca); c.rotate(-0.5 * alca); c.translate(-5.5, 0);   // alça gira pela perna direita
      c.beginPath(); c.moveTo(-5.5, 0); c.lineTo(-5.5, -5); c.arc(0, -5, 5.5, Math.PI, 0); c.lineTo(5.5, 0); c.stroke();
      c.restore();
      c.fillStyle = A.rgb(cor); c.lineWidth = 2.2; c.beginPath(); c.roundRect(-10, -6, 20, 16, 3); c.fill(); c.stroke();
      c.fillStyle = A.rgb(A.cor.BG); c.beginPath(); c.arc(0, 0.5, 2, 0, Math.PI * 2); c.fill(); c.fillRect(-0.9, 1.5, 1.8, 4);   // fechadura
      c.restore();
    },
  });
})();
