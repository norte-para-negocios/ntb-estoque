// Pedindo confirmação: ele sobe e encolhe, dois botões "Sim" e "Não" aparecem embaixo.
// Olha para o Sim, para o Não, para você (com cara de pergunta); o Sim é escolhido e afunda,
// fica teal, e ele fica feliz (pulinho, olhos ^ ^, tela teal). Os botões somem e ele volta ao centro.
(() => {
  const DUR = 7.5;
  const BY = 86, BW = 28, BH = 14, SX = 31, NX = 69;              // botões: altura, tamanho, centro do Sim e do Não
  const TSIM = 3.9;                                                // momento em que o Sim é escolhido
  const sobe = (t, A) => A.easeInOut(A.seg01(t, 0.2, 0.9)) * (1 - A.easeInOut(A.seg01(t, 6.2, 7.1)));
  const botoes = (t, A) => A.back(A.seg01(t, 0.7, 1.1)) * (1 - A.easeIn(A.seg01(t, 5.8, 6.2)));
  Pacioli.acao({
    titulo: 'Pedindo confirmação', dur: DUR,
    humor: (t) => (t > TSIM + 0.15 && t < 5.7 ? 2 : 0),
    corpo(b, t, A) {
      const k = sobe(t, A);
      b.escala = A.lerp(b.escala, 0.64, k); b.y = A.lerp(b.y, -14, k);
      if (A.humor === 0 && k > 0) {
        const lx = t < 1.9 ? -1 : t < 2.8 ? 1 : t < TSIM ? 0 : -1;
        b.yaw = A.lerp(b.yaw, 0.22 * lx, k); b.pitch = A.lerp(b.pitch, t < 2.8 || t > TSIM ? 0.36 : 0.2, k);
      }
    },
    olhos(o, t, A) {
      const k = sobe(t, A); if (k <= 0 || A.humor !== 0) return;
      if (k > 0.5) o.piscar = false;
      if (t < 1.0) { o.lx = 0; o.ly = A.lerp(o.ly, 0.6, k); }
      else if (t < 1.9) { o.lx = -0.9; o.ly = 1; }                  // olha o Sim
      else if (t < 2.8) { o.lx = 0.9; o.ly = 1; }                   // olha o Não
      else if (t < TSIM) { o.lx = 0; o.ly = 0; o.dy = -2.6; o.w = 9.4; o.h = 22; }   // olha você: "e aí?"
      else { o.lx = -0.9; o.ly = 1; }                               // vê o Sim afundar
      o.kL = 140; o.cL = 16;
    },
    frente(c, t, A) {
      const s = botoes(t, A); if (s <= 0.01) return;
      const aperta = A.arco(A.seg01(t, TSIM, TSIM + 0.35)), esc = A.easeOut(A.seg01(t, TSIM + 0.05, TSIM + 0.3));
      const outro = 1 - 0.55 * esc;                                  // o Não apaga depois da escolha
      // o botão que ele está olhando cresce um pouco
      const olhado = [A.seg01(t, 1.0, 1.2) * (1 - A.seg01(t, 1.9, 2.1)), A.seg01(t, 1.9, 2.1) * (1 - A.seg01(t, 2.8, 3.0))];
      for (const [x, txt, i] of [[SX, 'Sim', 0], [NX, 'Não', 1]]) {
        const g = 1 + 0.1 * A.smooth(olhado[i]) - (i === 0 ? 0.06 * aperta : 0);
        c.save(); c.translate(x, BY + (i === 0 ? 1.8 * aperta : 0)); c.scale(s * g, s * g);
        const cheio = i === 0 ? esc : 0, a = i === 1 ? outro : 1;
        c.fillStyle = A.rgb(A.mix(A.cor.BG, A.cor.TEAL, cheio)); c.strokeStyle = A.rgb(A.cor.CREAM, a); c.lineWidth = 2;
        c.beginPath(); c.roundRect(-BW / 2, -BH / 2, BW, BH, BH / 2); c.fill(); c.stroke();
        A.texto(c, txt, 0, 0.4, { tam: 6, peso: 600, a });
        c.restore();
      }
    },
  });
})();
