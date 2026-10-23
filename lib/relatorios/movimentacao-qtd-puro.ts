// Movimentação "Em quantidade": unidade de cada produto e lançamentos errados desfeitos (migration 291).
// Puro, sem imports: node --test lib/relatorios/movimentacao-qtd-puro.test.ts
//
// Achado (produção, loja 5, 2026): LEITE DE COCO 1.559.196 em jan, VINAGRE 239.144, VODKA 103.994 estão certos, em
// ml (batem com as compras); a tela mostrava o número cru sem unidade. Já LINGUIÇA CALABRESA 2.720.020 em mai é uma
// contagem de inventário digitada errada (2.720.000 kg em 30/05) e desfeita no dia seguinte: entra e sai o mesmo
// tanto. Esses pares saem da matriz (os dois lados) e são listados.

export type LinhaQtd = { rotulo: string; mes: string; qtde: number; valor: number }
export type Desfeito = {
  cod_prod: number; descricao: string; unidade: string | null
  data_entrada: string; data_saida: string; quantidade_entrada: number; quantidade_saida: number
}
export type ExtrasQtd = { unidades: { descricao: string; unidade: string | null }[]; desfeitos: Desfeito[] }

/** Unidade de exibição: ml → L e g → kg (÷ 1000); o resto como está no cadastro. */
export function unidadeExibicao(unidade: string | null | undefined): { divisor: number; rotulo: string } {
  const u = (unidade ?? '').trim().toUpperCase()
  if (u === 'ML') return { divisor: 1000, rotulo: 'L' }
  if (u === 'G' || u === 'GR') return { divisor: 1000, rotulo: 'kg' }
  if (!u) return { divisor: 1, rotulo: '' }
  if (u === 'KG') return { divisor: 1, rotulo: 'kg' }
  if (u === 'L' || u === 'LT' || u === 'LTS' || u === 'LITRO') return { divisor: 1, rotulo: 'L' }
  return { divisor: 1, rotulo: u.toLowerCase() }
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Tira da matriz (rótulo × mês, quantidade) os lançamentos desfeitos: na visão de saídas, a saída do par no mês dela;
 * nas entradas, a entrada. Só o lado que cai dentro do período. Devolve a matriz nova e os pares que mexeram nela.
 */
export function tirarDesfeitos(matriz: LinhaQtd[], desfeitos: Desfeito[], sentido: 'saidas' | 'entradas', ini: string, fim: string): { matriz: LinhaQtd[]; tirados: (Desfeito & { quantidade: number; data: string })[] } {
  const chave = (rotulo: string, mes: string) => JSON.stringify([rotulo, mes])
  const m = new Map(matriz.map((l) => [chave(l.rotulo, l.mes), { ...l, qtde: Number(l.qtde) || 0 }]))
  const tirados: (Desfeito & { quantidade: number; data: string })[] = []
  for (const d of desfeitos) {
    const data = sentido === 'saidas' ? d.data_saida : d.data_entrada
    const q = Number(sentido === 'saidas' ? d.quantidade_saida : d.quantidade_entrada) || 0
    if (data < ini || data > fim || q <= 0) continue
    const l = m.get(chave(d.descricao, data.slice(0, 7)))
    if (!l) continue
    l.qtde = r6(l.qtde - q)
    tirados.push({ ...d, quantidade: q, data })
  }
  return { matriz: [...m.values()].filter((l) => Math.abs(l.qtde) > 1e-9), tirados }
}

/** Mapa rótulo → unidade de exibição. */
export function mapaUnidades(extras: ExtrasQtd | null): Map<string, { divisor: number; rotulo: string }> {
  return new Map((extras?.unidades ?? []).map((u) => [u.descricao, unidadeExibicao(u.unidade)]))
}
