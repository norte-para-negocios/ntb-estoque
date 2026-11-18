// F-09: vendas do Norte Vendas que esperam o Omie na loja Omie (Sertão). Enquanto o Omie não confirma, a baixa fica em
// `movimentos` com status Erro/Processando (a tela de Movimentações só lista as concluídas) e a OP fica em
// `vendas_integracao_fila` (não existe em Ordens de Produção). Este módulo só monta a lista; a leitura é do componente.
// Puro: sem import de valor (testável via `node --test`).

export type MovimentoPendente = {
  id: number
  id_prod: number
  quan: number | null
  data: string | null
  obs: string | null
  obs_item: string | null
  status: string | null
  tentativas: number | null
  descricao_status: string | null
}

export type LinhaFilaVenda = {
  id: number
  tipo: 'op' | 'nfce'
  ref: string | null
  payload: unknown
  tentativas: number | null
  ultimo_erro: string | null
  proximo_em: string | null
}

export type SaidaAguardando = { id: number; produto: string; quantidade: number; data: string | null; tentativas: number; motivo: string; venda: string | null }
export type OpAguardando = { id: number; produto: string; quantidade: number; pedido: string | null; tentativas: number; motivo: string; proximaTentativa: string | null }
export type AguardandoOmie = { total: number; saidas: SaidaAguardando[]; ops: OpAguardando[] }

const MARCA = /Venda ntb-vendas #([0-9a-z-]+)/i

/** Marca gravada pela rota de venda (obs; em venda com nota, obs_item). */
export function ehMovimentoDeVenda(m: { obs: string | null; obs_item: string | null }): boolean {
  return MARCA.test(m.obs ?? '') || MARCA.test(m.obs_item ?? '')
}

function vendaDe(m: { obs: string | null; obs_item: string | null }): string | null {
  return (MARCA.exec(m.obs ?? '') ?? MARCA.exec(m.obs_item ?? ''))?.[1] ?? null
}

export function montarAguardandoOmie(d: { movimentos: MovimentoPendente[]; fila: LinhaFilaVenda[]; produtos: Map<number, string> }): AguardandoOmie {
  const nome = (cod: number) => d.produtos.get(cod) ?? `Produto ${cod}`
  const saidas: SaidaAguardando[] = d.movimentos
    .filter((m) => ehMovimentoDeVenda(m) && m.quan != null)
    .map((m) => ({
      id: m.id,
      produto: nome(m.id_prod),
      quantidade: Math.abs(Number(m.quan)),
      data: m.data,
      tentativas: m.tentativas ?? 0,
      motivo: m.descricao_status?.trim() || 'Aguardando a primeira tentativa',
      venda: vendaDe(m),
    }))
  const ops: OpAguardando[] = d.fila
    .filter((l) => l.tipo === 'op')
    .map((l) => {
      const p = (l.payload ?? {}) as { codigo_produto?: number; quantidade?: number; codigo?: string }
      return {
        id: l.id,
        produto: p.codigo_produto != null ? nome(Number(p.codigo_produto)) : (p.codigo ? `Item ${p.codigo}` : 'Item da venda'),
        quantidade: Number(p.quantidade ?? 0),
        pedido: l.ref,
        tentativas: l.tentativas ?? 0,
        motivo: l.ultimo_erro?.trim() || 'Aguardando a primeira tentativa',
        proximaTentativa: l.proximo_em,
      }
    })
  return { total: saidas.length + ops.length, saidas, ops }
}

/** Frase do aviso (vazia quando não há nada esperando). */
export function textoAguardandoOmie(r: AguardandoOmie): string {
  if (r.total === 0) return ''
  const partes: string[] = []
  if (r.saidas.length) partes.push(`${r.saidas.length} ${r.saidas.length === 1 ? 'baixa de venda' : 'baixas de venda'}`)
  if (r.ops.length) partes.push(`${r.ops.length} ${r.ops.length === 1 ? 'ordem de produção' : 'ordens de produção'}`)
  return `${partes.join(' e ')} aguardando o Omie`
}
