// Comemorando: tudo verde. A tela fica teal, ele dá três pulos e em cada um as pétalas abrem e fecham de estalo,
// soltando uma rajada de confete (triângulos e quadradinhos na paleta). Olhos ^ ^ o tempo todo; depois sossega.
(() => {
  const DUR = 6;
  const PULOS = [1.0, 1.9, 2.8];
  const COR = ['AMBER', 'TEAL', 'VIO', 'MAG', 'CREAM', 'AMBER', 'GREEN', 'CREAM'];
  // confete determinístico: cada rajada tem N peças com direção, força, giro e forma fixas
  const N = 22, rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const PECAS = [];
  PULOS.forEach((t0, r) => { for (let i = 0; i < N; i++) {
    const k = r * N + i, ang = -Math.PI / 2 + (rnd(k) - 0.5) * 3.2;
    PECAS.push({ t0: t0 + 0.08, dx: Math.cos(ang), dy: Math.sin(ang), vx: Math.cos(ang) * (34 + 30 * rnd(k + 9)), vy: Math.sin(ang) * (48 + 34 * rnd(k + 19)), w: (rnd(k + 5) - 0.5) * 14,
      cor: COR[k % COR.length], tri: rnd(k + 3) > 0.5, tam: 3 + 1.6 * rnd(k + 7) });
  } });
  const festa = (t, A) => A.seg01(t, 0.3, 0.6) * (1 - A.seg01(t, 4.8, 5.4));
  Pacioli.acao({
    titulo: 'Comemorando', dur: DUR,
    humor: (t) => (t > 0.4 && t < 5.0 ? 2 : 0),
    passo(dt, t, A) { for (const p of PULOS) if (A.passou(p)) { A.pulo(70); A.estalo(); } },
    corpo(b, t, A) {
      const k = festa(t, A);
      b.roll = 0.1 * Math.sin(t * 7) * k * (t < 3.6 ? 1 : 0.4); b.escala += 0.04 * k;
    },
    petalas(PT, t, A) {
      let s = 0; for (const p of PULOS) s = Math.max(s, A.arco(A.seg01(t, p, p + 0.4)));
      for (let i = 0; i < PT.length; i++) { PT[i].t = 0.7 * s; PT[i].k = 420; PT[i].c = 13; }
    },
    olhos(o, t, A) { if (A.humor === 2) { o.hap = 1; o.h = 14; o.w = 7; o.ly = -0.3; } },
    tela(cor, t, A) { return A.mix(cor, A.cor.TEAL, festa(t, A)); },
    atras(c, t, A) {                                               // atrás do corpo: sai pelas frestas das pétalas
      const fim = 1 - A.seg01(t, 4.6, 5.2);
      for (const p of PECAS) {
        const a = t - p.t0; if (a < 0 || a > 2.6) continue;
        const x = A.centro.x + p.dx * 24 + p.vx * a, y = A.centro.y + p.dy * 24 + p.vy * a + 42 * a * a;          // sobe e cai com gravidade
        const al = Math.min(1, (2.6 - a) * 2) * fim; if (al <= 0) continue;
        c.save(); c.translate(x, y); c.rotate(p.w * a); c.fillStyle = A.rgb(A.cor[p.cor], al);
        c.beginPath();
        if (p.tri) { c.moveTo(0, -p.tam); c.lineTo(p.tam * 0.9, p.tam * 0.6); c.lineTo(-p.tam * 0.9, p.tam * 0.6); c.closePath(); }
        else c.rect(-p.tam * 0.7, -p.tam * 0.7, p.tam * 1.4, p.tam * 1.4);
        c.fill(); c.restore();
      }
    },
  });
})();
