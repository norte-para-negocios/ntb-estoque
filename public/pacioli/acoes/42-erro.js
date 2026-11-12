// Deu erro: vigiando, de repente um tranco: as pétalas estouram para fora, os quatro triângulos da frente
// se soltam e se espalham um pouco, a tela fica magenta e os olhos arregalam. Ele se recompõe (pétalas e
// triângulos voltam ao lugar), respira fundo duas vezes, a tela volta ao violeta e ele segue vigiando.
(() => {
  const DUR = 6;
  const ERRO = 0.9;
  // espalhar: sobe rápido no tranco, volta devagar (recompondo)
  const espalha = (t, A) => A.easeOut(A.seg01(t, ERRO, ERRO + 0.18)) * (1 - A.easeInOut(A.seg01(t, 1.4, 2.4)));
  const susto = (t, A) => A.seg01(t, ERRO, ERRO + 0.1) * (1 - A.seg01(t, 2.0, 2.6));
  const resp = (t, A) => (t > 2.6 && t < 4.8) ? Math.sin(Math.PI * 2 * (t - 2.6) / 1.1) : 0;   // duas respirações
  // para onde cada triângulo voa: [dx, dy, giro]
  const VOO = [[-9, -7, -0.7], [9, -8, 0.6], [-10, 8, 0.5], [8, 10, -0.8]];
  Pacioli.acao({
    titulo: 'Deu erro', dur: DUR,
    humor: () => 0,
    passo(dt, t, A) { if (A.passou(ERRO)) { A.tranco(1.5); A.pulo(28); } },
    corpo(b, t, A) {
      const s = susto(t, A);
      b.escala += 0.06 * s + 0.035 * Math.max(0, resp(t, A));
      b.pitch = A.lerp(b.pitch, -0.05, s); b.yaw = A.lerp(b.yaw, 0, s);
      if (t > 2.6 && t < 4.8) { b.yaw = 0; b.pitch = 0.2 - 0.06 * resp(t, A); b.k = 30; }
    },
    petalas(PT, t, A) {
      const e = espalha(t, A); if (e <= 0) return;
      for (let i = 0; i < PT.length; i++) {
        PT[i].t = Math.max(PT[i].t, e * (0.26 + 0.12 * Math.sin(i * 2.7)));   // cada peça abre um tanto diferente
        if (t < ERRO + 0.3) { PT[i].k = 420; PT[i].c = 9; } else { PT[i].k = 70; PT[i].c = 11; }
      }
    },
    tela(cor, t, A) {
      const k = A.seg01(t, ERRO, ERRO + 0.05) * (1 - A.seg01(t, 2.6, 3.6));
      return k > 0 ? A.mix(cor, A.cor.MAG, k) : null;
    },
    olhos(o, t, A) {
      const s = susto(t, A);
      if (s > 0) {                                     // arregalados, tremendo de leve
        o.w = A.lerp(o.w, 11, s); o.h = A.lerp(o.h, 27, s); o.lx = 0.12 * Math.sin(A.T * 31) * s; o.ly = -0.15 * s;
        o.piscar = false; o.kL = 400; o.cL = 20;
      }
      if (t > 2.6 && t < 4.8) {                        // respirando: olhos fecham um pouco ao soltar o ar
        const r = resp(t, A); o.lx = 0; o.ly = 0.1; o.piscar = false;
        if (r < 0) { o.h = A.lerp(20, 5, -r); o.w = A.lerp(8.5, 10, -r); }
      }
    },
    maos(H, t, A) {
      const e = espalha(t, A); if (e <= 0.001) return;
      const o = A.centro;
      A.TRIS.forEach((fi, k) => {
        const f = A.faceXY(fi), [dx, dy, r] = VOO[k];
        H[fi] = { x: f.x + dx * e, y: f.y + dy * e, rot: r * e, s: 1, mix: Math.min(1, e * 6) };
      });
    },
    frente(c, t, A) {
      // estalo do erro: três risquinhos magenta saindo do corpo
      const u = A.seg01(t, ERRO, ERRO + 0.5); if (u <= 0 || u >= 1) return;
      const o = A.centro, R = 44 * A.escala;
      for (const a of [-2.4, -1.57, -0.74]) {
        const r0 = R + 2 + 8 * u, r1 = r0 + 6;
        A.linha(c, [[o.x + Math.cos(a) * r0, o.y + Math.sin(a) * r0], [o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1]], { cor: A.cor.MAG, lw: 2.6, a: 1 - u * u });
      }
    },
  });
})();
