// Esperando o Omie: o Pacioli chega para a esquerda; à direita, uma ampulheta "Omie" escorre areia âmbar.
// Ele olha para ela e bate uma mão-triângulo no chão como quem bate o pé; a ampulheta esvazia, ele suspira
// (olhos fecham, corpo afunda, sai um sopro), a ampulheta vira e ele volta a esperar, paciente.
(() => {
  const DUR = 8;
  const MX = 36, MY = 46, HX = 88, HY = 58;          // mascote e ampulheta
  const ida = (t, A) => A.easeInOut(A.seg01(t, 0.1, 0.7)) * (1 - A.easeInOut(A.seg01(t, 7.2, 7.9)));
  const cena = (t, A) => A.back(A.seg01(t, 0.4, 0.9)) * (1 - A.easeIn(A.seg01(t, 7.0, 7.5)));
  const SUSP = [3.4, 4.6];                            // suspiro
  const VIRA = [4.0, 4.6];                            // ampulheta vira
  // batidas: dois blocos de 4 batidas (o segundo mais lento)
  const bate = (t) => {
    if (t > 1.2 && t < 3.2) { const ph = ((t - 1.2) * 2.0) % 1; return Math.max(0, Math.sin(Math.PI * Math.min(1, ph / 0.45))) * (ph < 0.45 ? 1 : 0); }
    if (t > 4.9 && t < 6.9) { const ph = ((t - 4.9) * 1.6) % 1; return Math.max(0, Math.sin(Math.PI * Math.min(1, ph / 0.45))) * (ph < 0.45 ? 1 : 0); }
    return 0;
  };
  Pacioli.acao({
    titulo: 'Esperando o Omie', dur: DUR,
    humor: () => 0,
    corpo(b, t, A) {
      const s = ida(t, A);
      b.escala = A.lerp(1, 0.68, s); b.x = A.lerp(0, MX - 50, s); b.y = A.lerp(0, MY - 50, s);
      // suspiro: enche (sobe e cresce) e solta (afunda)
      const ench = A.arco(A.seg01(t, SUSP[0], SUSP[0] + 0.5)), sol = A.arco(A.seg01(t, SUSP[0] + 0.4, SUSP[1]));
      b.yaw = A.lerp(b.yaw, 0.1, s); b.pitch = A.lerp(b.pitch, 0.06, s); b.escala += 0.035 * ench - 0.03 * sol; b.y += -2.5 * ench + 3.5 * sol; b.pitch += 0.12 * sol;
    },
    olhos(o, t, A) {
      const s = ida(t, A); if (s < 0.3) return;
      // olha a ampulheta (um pouco para o alto quando ela vira); sem pressa
      o.lx = 0.9; o.ly = A.lerp(0.1, -0.5, A.arco(A.seg01(t, VIRA[0] - 0.1, VIRA[1] + 0.1))); o.kL = 40; o.cL = 11; o.lid = 0.12;
      const sol = A.seg01(t, SUSP[0] + 0.45, SUSP[1] - 0.2);
      if (sol > 0 && sol < 1) { o.h = 3; o.w = 10; o.lx = 0; o.ly = 0.5; o.piscar = false; }
    },
    maos(H, t, A) {
      const m = A.seg01(t, 0.7, 1.1) * (1 - A.seg01(t, 6.9, 7.3)); if (m <= 0) return;
      const k = bate(t);
      // a "ponta do pé" fica no chão; o calcanhar sobe e desce
      H[A.TRIS[3]] = { x: 50, y: 86 - 3.2 * k, rot: -0.15 - 0.35 * k, s: 1.05, mix: A.easeOut(m) };
    },
    atras(c, t, A) {
      const ap = cena(t, A); if (ap <= 0.01) return;
      A.linha(c, [[14, 92], [70, 92]], { a: 0.3 * ap });
      // ampulheta
      const vira = A.easeInOut(A.seg01(t, VIRA[0], VIRA[1]));
      let a;                                           // areia que ainda está em cima (0..1)
      if (t < VIRA[0]) a = 0.65 * (1 - A.seg01(t, 0.9, 3.6));
      else if (t < VIRA[1]) a = 0;
      else a = 1 - 0.55 * A.seg01(t, VIRA[1] + 0.1, 7.2);
      const rot = vira < 1 ? Math.PI * vira : 0;
      c.save(); c.translate(HX, HY); c.scale(ap, ap); c.rotate(rot);
      const vidro = () => { c.beginPath(); c.moveTo(-9, -15); c.bezierCurveTo(-9, -6, -1.6, -3, -1.6, 0); c.bezierCurveTo(-1.6, 3, -9, 6, -9, 15);
        c.lineTo(9, 15); c.bezierCurveTo(9, 6, 1.6, 3, 1.6, 0); c.bezierCurveTo(1.6, -3, 9, -6, 9, -15); c.closePath(); };
      c.fillStyle = A.rgb(A.cor.BG); vidro(); c.fill();
      c.save(); vidro(); c.clip(); c.fillStyle = A.rgb(A.cor.AMBER);
      if (a > 0.01) c.fillRect(-10, -14 * a, 20, 14 * a);                          // em cima, desce para o gargalo
      const b = 1 - a; if (b > 0.01) { c.beginPath(); c.moveTo(-10, 15); c.lineTo(10, 15); c.lineTo(10, 15 - 9 * b); c.lineTo(0, 15 - 14 * b); c.lineTo(-10, 15 - 9 * b); c.closePath(); c.fill(); }
      if (a > 0.01 && vira === 0 || (t > VIRA[1] + 0.1 && a > 0.01)) { c.fillRect(-0.6, 0, 1.2, 15 - 12 * b); }   // filete
      c.restore();
      c.strokeStyle = A.rgb(A.cor.CREAM); c.lineWidth = 2; vidro(); c.stroke();
      c.fillStyle = A.rgb(A.cor.BG); c.lineWidth = 2.2;
      for (const y of [-15, 15]) { c.beginPath(); c.roundRect(-12, y - 2, 24, 4, 1.5); c.fill(); c.stroke(); }
      c.restore();
      A.texto(c, 'Omie', HX, HY + 25, { tam: 5, peso: 600, a: 0.85 * ap });
    },
    frente(c, t, A) {
      // sopro do suspiro: dois tracinhos ondulados saem pela esquerda e somem
      const u = A.seg01(t, SUSP[0] + 0.45, SUSP[1] + 0.3); if (u <= 0 || u >= 1) return;
      const o = A.centro;
      for (let k = 0; k < 2; k++) {
        const v = A.clamp(u * 1.2 - k * 0.2, 0, 1); if (v <= 0) continue;
        const x0 = o.x - 25 - v * 10, y0 = o.y + 4 + k * 6 - v * 5, pts = [];
        for (let j = 0; j <= 6; j++) pts.push([x0 - j * 1.4, y0 + 1.2 * Math.sin(j * 1.3 + v * 6)]);
        A.linha(c, pts, { a: (1 - v) * 0.85, lw: 1.5 });
      }
    },
  });
})();
