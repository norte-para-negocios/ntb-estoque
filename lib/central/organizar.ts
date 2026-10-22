import type { ItemPronto, ModuloPronto, SecaoPronta } from './visibilidade'

// Como a tela de um módulo arruma o que já passou pelo filtro de visibilidade:
// verbos no topo (acoes), consultas em linhas, cadastros com um botão por ação, relatórios em chips,
// e tudo que ainda não existe numa gaveta só (embreve) — nunca misturado com o que funciona.

export type Consulta = { item: ItemPronto; secao: string }
export type Organizado = {
  acoes: ItemPronto[]
  consultas: Consulta[]
  cadastros: SecaoPronta[]
  relatorios: ItemPronto[]
  embreve: string[]
}

const util = (i: ItemPronto) => !i.emBreve && !!i.href

export function organizar(m: ModuloPronto): Organizado {
  const consultas: Consulta[] = []
  const cadastros: SecaoPronta[] = []
  const relatorios: ItemPronto[] = []
  const embreve: string[] = m.atalhos.filter((i) => i.emBreve).map((i) => i.label)

  for (const s of m.secoes) {
    for (const i of s.itens) if (i.emBreve) embreve.push(s.nome === 'Relatórios' ? `Relatório: ${i.label}` : `${s.nome}: ${i.label}`)
    const itens = s.itens.filter(util)
    if (itens.length === 0) continue
    const tipo = s.tipo ?? 'cadastro'
    if (tipo === 'relatorio') relatorios.push(...itens)
    else if (tipo === 'consulta') consultas.push(...itens.map((item) => ({ item, secao: s.nome })))
    else cadastros.push({ ...s, itens })
  }
  return { acoes: m.atalhos.filter(util), consultas, cadastros, relatorios, embreve }
}

/** Rótulo curto do botão de um cadastro: "Incluir" vira "+ Novo", "Exibir todos" vira "Ver todos". */
export function rotuloBotao(label: string): string {
  if (/^incluir$/i.test(label)) return '+ Novo'
  if (/^incluir /i.test(label)) return '+ ' + label.replace(/^incluir /i, '')
  return label.replace(/^exibir /i, 'Ver ')
}

export type VarianteBotao = 'novo' | 'importar' | 'padrao'
export function varianteBotao(label: string): VarianteBotao {
  if (/^incluir|^lançar|^lancar/i.test(label)) return 'novo'
  if (/^importar/i.test(label)) return 'importar'
  return 'padrao'
}
