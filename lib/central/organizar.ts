import type { ItemPronto, ModuloPronto, SecaoPronta } from './visibilidade'

// Como a tela de um módulo arruma o que já passou pelo filtro de visibilidade:
// faixa "Novo" (criar documentos), telas (a principal em destaque), cadastros com um botão por ação,
// relatórios em chips e tudo que ainda não existe numa gaveta só (embreve), nunca misturado com o que funciona.

export type Organizado = {
  novos: ItemPronto[]
  principal: ItemPronto | null
  telas: ItemPronto[]
  cadastros: SecaoPronta[]
  relatorios: ItemPronto[]
  embreve: string[]
}

const util = (i: ItemPronto) => !i.emBreve && !!i.href

export function organizar(m: ModuloPronto): Organizado {
  const cadastros: SecaoPronta[] = []
  const relatorios: ItemPronto[] = []
  const embreve: string[] = [...m.novos, ...m.telas].filter((i) => i.emBreve).map((i) => i.label)

  for (const s of m.secoes) {
    for (const i of s.itens) if (i.emBreve) embreve.push(s.nome === 'Relatórios' ? `Relatório: ${i.label}` : `${s.nome}: ${i.label}`)
    const itens = s.itens.filter(util)
    if (itens.length === 0) continue
    if (s.tipo === 'relatorio') relatorios.push(...itens)
    else cadastros.push({ ...s, itens })
  }
  const telasUteis = m.telas.filter(util)
  // Sem a principal visível (ex.: tela só de estoque próprio numa loja Omie), nada fica em destaque.
  const principal = telasUteis.find((i) => i.principal) ?? null
  return {
    novos: m.novos.filter(util),
    principal,
    telas: telasUteis.filter((i) => i !== principal),
    cadastros,
    relatorios,
    embreve,
  }
}

/** Telas do módulo no menu lateral: as telas e, de cada cadastro, a lista ("Exibir todos") com o nome do cadastro. */
export function destinosDoMenu(m: ModuloPronto): { href: string; label: string }[] {
  // A tela que o próprio nome do módulo abre (Dashboard -> /home) não se repete embaixo dele.
  const out = m.telas.filter((i) => util(i) && i.href !== m.href).map((i) => ({ href: i.href!, label: i.label }))
  for (const s of m.secoes) {
    if (s.tipo === 'relatorio') continue
    const lista = s.itens.find((i) => util(i) && /^exibir /i.test(i.label))
    if (lista) out.push({ href: lista.href!, label: s.nome })
  }
  return out
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
