// Vacuus: o mascote vira o desenho de Leonardo para o livro de Pacioli (1509): poliedro de arame girando devagar, sem olhos e sem tela.
Pacioli.acao({ titulo: 'Vacuus', dur: 24, humor: () => 0,
  olhos(o) { o.a = 0; o.piscar = false; },
  corpo(b, t) { b.yaw = t / 24 * Math.PI * 2; b.pitch = 0.35 + 0.12 * Math.sin(t / 24 * Math.PI * 4); b.roll = 0.1; b.k = 400; b.escala = 0.92; b.arame = true; },
  petalas(PT) { for (const p of PT) p.t = 0; },
});
