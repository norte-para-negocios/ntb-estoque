// Acordando: dormindo → espreguiça (pétalas abrem e fecham uma vez, corpo estica) → pisca duas vezes → vigiando.
Pacioli.acao({ titulo: 'Acordando', dur: 6,
  humor: (t) => t < 1.6 ? 4 : 0,
  corpo(b, t, A) { const e = A.arco(A.seg01(t, 1.6, 2.6)); b.escala += 0.08 * e; b.pitch -= 0.25 * e; b.roll = 0.12 * Math.sin(t * 9) * e; },
  petalas(PT, t, A) { const e = A.arco(A.seg01(t, 1.6, 2.6)); for (let i = 0; i < PT.length; i++) PT[i].t = Math.max(PT[i].t, 0.55 * e); },
  olhos(o, t, A) { if (t > 1.6 && t < 2.6) { o.h = 4; o.w = 10; o.piscar = false; } if ((t > 2.9 && t < 3.0) || (t > 3.2 && t < 3.3)) o.h = 2; if (t > 2.6 && t < 3.6) { o.lx = 0; o.ly = 0; } },
});
