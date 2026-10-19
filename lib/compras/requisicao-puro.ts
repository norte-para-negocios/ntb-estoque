// Requisição de compra do estoque próprio (Fase C2, I1): regras puras. Espelham as funções rc_* da migration 240.
// Sem imports: node --test lib/compras/requisicao-puro.test.ts.

export type EtapaRequisicao = 'aberta' | 'aprovada' | 'pedido' | 'recusada'
export type AcaoRequisicao = 'editar' | 'aprovar' | 'recusar' | 'reabrir'
export type TomRequisicao = 'ok' | 'aviso' | 'erro' | 'neutro' | 'info'

const ROTULOS: Record<EtapaRequisicao, { rotulo: string; tom: TomRequisicao }> = {
  aberta: { rotulo: 'Aberta', tom: 'aviso' },
  aprovada: { rotulo: 'Aprovada', tom: 'info' },
  pedido: { rotulo: 'Virou pedido', tom: 'ok' },
  recusada: { rotulo: 'Recusada', tom: 'erro' },
}
export const ETAPAS_REQUISICAO: { value: EtapaRequisicao; label: string }[] =
  (Object.keys(ROTULOS) as EtapaRequisicao[]).map((k) => ({ value: k, label: ROTULOS[k].rotulo }))

export function rotuloEtapaRequisicao(e: EtapaRequisicao): { rotulo: string; tom: TomRequisicao } {
  return ROTULOS[e] ?? { rotulo: e, tom: 'neutro' }
}

/** Ações que a tela oferece (rc_acao confere de novo). Gerar pedido é ação da lista, não daqui. */
export function acoesRequisicao(etapa: EtapaRequisicao, o: { podeEditar: boolean; podeAprovar: boolean }): AcaoRequisicao[] {
  const r: AcaoRequisicao[] = []
  if (etapa === 'aberta') {
    if (o.podeEditar) r.push('editar')
    if (o.podeAprovar) r.push('aprovar', 'recusar')
  } else if (etapa === 'aprovada') {
    if (o.podeAprovar) r.push('recusar')
    if (o.podeEditar || o.podeAprovar) r.push('reabrir')
  } else if (etapa === 'recusada') {
    if (o.podeEditar) r.push('reabrir')
  }
  return r
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Mesma regra de _rc_chave_fornecedor (240): cadastro > CNPJ > nome sem acento e sem caixa > '' (a definir). */
export function chaveFornecedor(f: { fornecedorId: number | null; fornecedorCnpj: string | null; fornecedorNome: string | null }): string {
  if (f.fornecedorId != null) return `id:${f.fornecedorId}`
  const cnpj = (f.fornecedorCnpj ?? '').replace(/\D/g, '')
  if (cnpj) return `cnpj:${cnpj}`
  const nome = (f.fornecedorNome ?? '').trim().replace(/\s+/g, ' ')
  return nome ? `nome:${semAcento(nome).toLowerCase()}` : ''
}

export type ItemReqPrevia = {
  requisicaoNumero: number; codigoProduto: number; descricao: string; unidade: string | null; fator: number; quantidade: number; precoSugerido: number
  fornecedorId: number | null; fornecedorCnpj: string | null; fornecedorNome: string | null
}
export type PedidoPrevia = {
  chave: string; fornecedorNome: string; requisicoes: number[]
  itens: { codigoProduto: number; descricao: string; unidade: string | null; fator: number; quantidade: number; preco: number }[]
  total: number
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** O que rc_gerar_pedidos vai criar: um pedido por fornecedor (na ordem em que aparecem), mesmo produto+unidade+fator somado
 *  com preço médio ponderado. Grupo sem fornecedor = "Fornecedor a definir". */
export function previaGerarPedidos(itens: ItemReqPrevia[]): PedidoPrevia[] {
  const grupos = new Map<string, { nome: string | null; reqs: Set<number>; itens: Map<string, { codigoProduto: number; descricao: string; unidade: string | null; fator: number; q: number; v: number }> }>()
  for (const i of itens) {
    const k = chaveFornecedor(i)
    const g = grupos.get(k) ?? { nome: null, reqs: new Set<number>(), itens: new Map() }
    if (!g.nome && i.fornecedorNome) g.nome = i.fornecedorNome
    g.reqs.add(i.requisicaoNumero)
    const ki = JSON.stringify([i.codigoProduto, i.unidade, i.fator])
    const it = g.itens.get(ki) ?? { codigoProduto: i.codigoProduto, descricao: i.descricao, unidade: i.unidade, fator: i.fator, q: 0, v: 0 }
    it.q += i.quantidade
    it.v += i.quantidade * i.precoSugerido
    g.itens.set(ki, it)
    grupos.set(k, g)
  }
  return [...grupos.entries()].map(([chave, g]) => {
    const its = [...g.itens.values()].map((x) => ({ codigoProduto: x.codigoProduto, descricao: x.descricao, unidade: x.unidade, fator: x.fator, quantidade: r6(x.q), preco: x.q > 0 ? r6(x.v / x.q) : 0 }))
    return {
      chave, fornecedorNome: g.nome ?? 'Fornecedor a definir', requisicoes: [...g.reqs].sort((a, b) => a - b), itens: its,
      total: Math.round(its.reduce((a, x) => a + x.quantidade * x.preco, 0) * 100) / 100,
    }
  })
}
