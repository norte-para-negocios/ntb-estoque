// Fase 8: engenharia de cardápio (matriz popularidade × margem, método Kasavana-Smith).
// Popularidade alta = vendeu pelo menos 70% da média de unidades por prato.
// Margem alta = lucro por unidade acima da média ponderada (lucro total ÷ unidades totais).

export type LinhaVendida = {
  rotulo: string; quantidade: number; faturamento: number; cmv: number
  itens_sem_baixa: number; itens_sem_custo: number
}

export type ClasseCardapio = 'estrela' | 'carro_chefe' | 'oportunidade' | 'rever'

export const CLASSES: { classe: ClasseCardapio; titulo: string; acao: string }[] = [
  { classe: 'estrela', titulo: 'Estrelas', acao: 'Vendem muito e dão bom lucro. Mantenha a receita e o destaque.' },
  { classe: 'carro_chefe', titulo: 'Vendem muito, lucram pouco', acao: 'Revise o preço ou a ficha técnica: pequenas mudanças rendem muito.' },
  { classe: 'oportunidade', titulo: 'Lucram bem, vendem pouco', acao: 'Dê mais destaque: cardápio, sugestão do garçom ou foto.' },
  { classe: 'rever', titulo: 'Vendem pouco e lucram pouco', acao: 'Pense em reformular ou tirar do cardápio.' },
]

export type ItemCardapio = LinhaVendida & {
  lucro: number; margemUnit: number; margemPct: number | null
  participacao: number; classe: ClasseCardapio; custoIncompleto: boolean
}

export type ResultadoCardapio = {
  itens: ItemCardapio[]
  semCusto: LinhaVendida[]
  corteQuantidade: number
  corteMargemUnit: number
  totalQuantidade: number
  totalLucro: number
}

const FORA = /^(taxa de servi|produto não identificado$)/i

export function engenhariaCardapio(linhas: LinhaVendida[]): ResultadoCardapio {
  const vendidos = linhas.filter((x) => !FORA.test(x.rotulo.trim()) && x.quantidade > 0 && x.faturamento > 0)
  const semCusto = vendidos.filter((x) => !(x.cmv > 0))
  const comCusto = vendidos.filter((x) => x.cmv > 0)
  const totalQuantidade = comCusto.reduce((s, x) => s + x.quantidade, 0)
  const totalLucro = comCusto.reduce((s, x) => s + (x.faturamento - x.cmv), 0)
  const corteQuantidade = comCusto.length ? (0.7 * totalQuantidade) / comCusto.length : 0
  const corteMargemUnit = totalQuantidade > 0 ? totalLucro / totalQuantidade : 0
  const ordem: Record<ClasseCardapio, number> = { estrela: 0, carro_chefe: 1, oportunidade: 2, rever: 3 }
  const itens = comCusto.map((x): ItemCardapio => {
    const lucro = x.faturamento - x.cmv
    const margemUnit = lucro / x.quantidade
    const popular = x.quantidade >= corteQuantidade
    const lucrativo = margemUnit >= corteMargemUnit
    return {
      ...x, lucro, margemUnit,
      margemPct: x.faturamento > 0 ? (lucro / x.faturamento) * 100 : null,
      participacao: totalQuantidade > 0 ? (x.quantidade / totalQuantidade) * 100 : 0,
      classe: popular ? (lucrativo ? 'estrela' : 'carro_chefe') : lucrativo ? 'oportunidade' : 'rever',
      custoIncompleto: x.itens_sem_custo + x.itens_sem_baixa > 0,
    }
  }).sort((a, b) => ordem[a.classe] - ordem[b.classe] || b.lucro - a.lucro || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return { itens, semCusto: semCusto.sort((a, b) => b.faturamento - a.faturamento), corteQuantidade, corteMargemUnit, totalQuantidade, totalLucro }
}
