// Pedido de compra do estoque próprio (Fase C, I2/I3): regras puras. Espelham as funções pc_* da migration 200.
// Sem imports: node --test lib/compras/pedido-puro.test.ts.

export type EtapaPedido = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'cancelado'
export type AcaoPedido = 'editar' | 'enviar' | 'aprovar' | 'reprovar' | 'reabrir' | 'cancelar'
export type EtapaExibida = EtapaPedido | 'recebido_parcial' | 'recebido' | 'encerrado'
export type Tom = 'ok' | 'aviso' | 'erro' | 'neutro' | 'info'

const ROTULOS: Record<EtapaExibida, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: 'Rascunho', tom: 'neutro' },
  aguardando_aprovacao: { rotulo: 'Aguardando aprovação', tom: 'aviso' },
  aprovado: { rotulo: 'Aprovado', tom: 'info' },
  recebido_parcial: { rotulo: 'Recebido parcial', tom: 'aviso' },
  recebido: { rotulo: 'Recebido', tom: 'ok' },
  cancelado: { rotulo: 'Cancelado', tom: 'erro' },
  encerrado: { rotulo: 'Encerrado (recebido parcial)', tom: 'neutro' },
}
export const ETAPAS_FILTRO: { value: EtapaExibida; label: string }[] =
  (Object.keys(ROTULOS) as EtapaExibida[]).map((k) => ({ value: k, label: ROTULOS[k].rotulo }))

const EPS = 1e-6

/** Ações que a tela oferece (a função pc_acao confere de novo no banco). */
export function acoesDisponiveis(etapa: EtapaPedido, o: { temVinculo: boolean; podeAprovar: boolean; podeEditar: boolean }): AcaoPedido[] {
  const r: AcaoPedido[] = []
  if (etapa === 'rascunho') {
    // aprovar direto do rascunho só para quem também cria pedido (o comprador que pode aprovar)
    if (o.podeEditar) r.push('editar', 'enviar')
    if (o.podeEditar && o.podeAprovar) r.push('aprovar')
  } else if (etapa === 'aguardando_aprovacao') {
    if (o.podeAprovar) r.push('aprovar', 'reprovar')
  } else if (etapa === 'aprovado') {
    if (o.podeEditar && !o.temVinculo) r.push('reabrir')
  }
  if (etapa !== 'cancelado' && o.podeEditar) r.push('cancelar')
  return r
}

/** Etapa mostrada: aprovado com nota lançada vira recebido parcial/total; cancelado com algo recebido = encerrado. */
export function etapaExibida(etapa: EtapaPedido, q: { pedido: number; recebido: number }): { chave: EtapaExibida; rotulo: string; tom: Tom } {
  let chave: EtapaExibida = etapa
  if (etapa === 'aprovado' && q.recebido > EPS) chave = q.recebido + EPS >= q.pedido ? 'recebido' : 'recebido_parcial'
  if (etapa === 'cancelado' && q.recebido > EPS) chave = 'encerrado'
  return { chave, ...ROTULOS[chave] }
}

export type ItemPedidoConf = { id: number; codigoProduto: number; descricao: string; quantidadeBase: number; precoBase: number }
export type ItemNotaConf = {
  id: number; codigoProduto: number | null; descricao: string
  /** quantidade da nota em unidade de estoque (quantidade × fator) */
  quantidadeBase: number
  /** preço líquido da nota por unidade de estoque */
  precoBase: number
  /** quantidade recebida em unidade de estoque (quantidade_recebida ou quantidade × fator) */
  recebido: number
  lancado: boolean
  pedidoItemId: number | null
}
export type SituacaoConf = 'ok' | 'falta' | 'excede' | 'nao_veio' | 'fora_do_pedido'
export type LinhaConf = {
  pedidoItemId: number | null; notaItemId: number | null; descricao: string
  pedidoQtd: number | null; pedidoPreco: number | null; notaQtd: number | null; notaPreco: number | null; recebido: number
  situacao: SituacaoConf; precoDiferente: boolean; difPrecoPct: number | null
}

/** Tolerância de preço: diferença acima de R$ 0,01 e de 0,5% do preço combinado. */
export function precoDiverge(pedido: number, nota: number): boolean {
  const d = Math.abs(nota - pedido)
  return d > 0.01 && d > Math.abs(pedido) * 0.005
}

/** Conferência das 3 vias (pedido × nota × recebido), por item do pedido; linhas da nota sem par aparecem no fim. */
export function conferirPedidoNota(pedido: ItemPedidoConf[], nota: ItemNotaConf[]): LinhaConf[] {
  const r: LinhaConf[] = []
  for (const p of pedido) {
    const ns = nota.filter((n) => n.pedidoItemId === p.id)
    if (!ns.length) {
      r.push({ pedidoItemId: p.id, notaItemId: null, descricao: p.descricao, pedidoQtd: p.quantidadeBase, pedidoPreco: p.precoBase,
        notaQtd: null, notaPreco: null, recebido: 0, situacao: 'nao_veio', precoDiferente: false, difPrecoPct: null })
      continue
    }
    const qtd = ns.reduce((a, n) => a + n.quantidadeBase, 0)
    const valor = ns.reduce((a, n) => a + n.quantidadeBase * n.precoBase, 0)
    const preco = qtd > 0 ? valor / qtd : 0
    const recebido = ns.reduce((a, n) => a + (n.lancado ? n.recebido : 0), 0)
    const situacao: SituacaoConf = Math.abs(qtd - p.quantidadeBase) <= EPS ? 'ok' : qtd < p.quantidadeBase ? 'falta' : 'excede'
    r.push({ pedidoItemId: p.id, notaItemId: ns[0].id, descricao: p.descricao, pedidoQtd: p.quantidadeBase, pedidoPreco: p.precoBase,
      notaQtd: Math.round(qtd * 1e6) / 1e6, notaPreco: Math.round(preco * 1e6) / 1e6, recebido: Math.round(recebido * 1e6) / 1e6, situacao,
      precoDiferente: precoDiverge(p.precoBase, preco), difPrecoPct: p.precoBase > 0 ? ((preco - p.precoBase) / p.precoBase) * 100 : null })
  }
  const ids = new Set(pedido.map((p) => p.id))
  for (const n of nota) {
    if (n.pedidoItemId != null && ids.has(n.pedidoItemId)) continue
    r.push({ pedidoItemId: null, notaItemId: n.id, descricao: n.descricao, pedidoQtd: null, pedidoPreco: null, notaQtd: n.quantidadeBase,
      notaPreco: n.precoBase, recebido: n.lancado ? n.recebido : 0, situacao: 'fora_do_pedido', precoDiferente: false, difPrecoPct: null })
  }
  return r
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Pedidos aprovados que podem receber a nota: mesmo CNPJ (ou pedido sem CNPJ com produto em comum), mais produtos em comum e entrega mais cedo primeiro. */
export function ordenarPedidosParaNota<T extends { id: number; numero: number; fornecedorCnpj: string | null; produtos: number[]; previsao: string | null }>(
  pedidos: T[], nota: { cnpj: string | null; produtos: number[] },
): T[] {
  const cnpj = digitos(nota.cnpj)
  const prods = new Set(nota.produtos)
  return pedidos
    .map((p) => ({ p, comuns: p.produtos.filter((x) => prods.has(x)).length, mesmo: !!cnpj && digitos(p.fornecedorCnpj) === cnpj }))
    .filter((x) => (x.mesmo || !x.p.fornecedorCnpj) && (x.mesmo || x.comuns > 0) && !(x.p.fornecedorCnpj && cnpj && !x.mesmo))
    .sort((a, b) => Number(b.mesmo) - Number(a.mesmo) || b.comuns - a.comuns || (a.p.previsao ?? '9999').localeCompare(b.p.previsao ?? '9999') || a.p.numero - b.p.numero)
    .map((x) => x.p)
}

export type LinhaParaPedido = { codigoProduto: number; quantidade: number; preco: number; fornecedorId: number | null; fornecedorNome: string | null; fornecedorCnpj: string | null }

/** "Criar pedido" da sugestão: um pedido por fornecedor (o último fornecedor de cada produto); sem fornecedor = um pedido à parte. */
export function agruparPorFornecedor(linhas: LinhaParaPedido[]): { fornecedorId: number | null; fornecedorNome: string | null; fornecedorCnpj: string | null; itens: LinhaParaPedido[] }[] {
  const m = new Map<string, { fornecedorId: number | null; fornecedorNome: string | null; fornecedorCnpj: string | null; itens: LinhaParaPedido[] }>()
  for (const l of linhas) {
    const k = JSON.stringify([l.fornecedorId, l.fornecedorId == null ? l.fornecedorNome : null])
    const g = m.get(k) ?? { fornecedorId: l.fornecedorId, fornecedorNome: l.fornecedorNome, fornecedorCnpj: l.fornecedorCnpj, itens: [] }
    g.itens.push(l)
    m.set(k, g)
  }
  return [...m.values()].sort((a, b) => Number(a.fornecedorNome == null) - Number(b.fornecedorNome == null))
}

export function totaisPedido(itens: { quantidade: number; precoUnitario: number }[], frete: number, outras: number): { mercadorias: number; total: number } {
  const merc = Math.round(itens.reduce((a, i) => a + i.quantidade * i.precoUnitario, 0) * 100) / 100
  return { mercadorias: merc, total: Math.round((merc + (frete || 0) + (outras || 0)) * 100) / 100 }
}

export type Parcela = { dias: number; percentual: number }

/** null = ok. Mesma regra da pc_salvar: dias >= 0, percentual > 0, soma = 100%. */
export function validarParcelas(p: Parcela[]): string | null {
  if (!p.length) return null
  if (p.some((x) => !Number.isInteger(x.dias) || x.dias < 0 || !(x.percentual > 0))) return 'Cada parcela precisa de dias (0 ou mais) e percentual maior que zero.'
  const soma = p.reduce((a, x) => a + x.percentual, 0)
  return Math.abs(soma - 100) > 0.01 ? `Os percentuais somam ${soma.toLocaleString('pt-BR')}%, precisam somar 100%.` : null
}

/** Vencimento = previsão de entrega + dias (como o nDias do Omie); a última parcela leva o arredondamento. */
export function parcelasDoPedido(p: Parcela[], total: number, previsao: string | null): { numero: number; dias: number; vencimento: string | null; valor: number; percentual: number }[] {
  let acum = 0
  return p.map((x, i) => {
    const valor = i === p.length - 1 ? Math.round((total - acum) * 100) / 100 : Math.round(total * x.percentual) / 100
    acum += valor
    const venc = previsao ? new Date(Date.parse(`${previsao}T12:00:00Z`) + x.dias * 86_400_000).toISOString().slice(0, 10) : null
    return { numero: i + 1, dias: x.dias, vencimento: venc, valor, percentual: x.percentual }
  })
}
