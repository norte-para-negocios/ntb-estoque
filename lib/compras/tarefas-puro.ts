// Painel de tarefas de compras (Fase C2, I7; estoque próprio): o que espera ação de alguém. Puro, sem imports:
// node --test lib/compras/tarefas-puro.test.ts. O Omie tem um painel de tarefas genérico (tarefas digitadas); aqui as
// tarefas saem sozinhas do estado das requisições, dos pedidos e das notas.

export type TipoTarefa = 'pedido_atrasado' | 'aprovar_pedido' | 'conferir_nota' | 'aprovar_requisicao' | 'gerar_pedido' | 'rascunho_parado'

export const ROTULO_TAREFA: Record<TipoTarefa, string> = {
  pedido_atrasado: 'Pedidos atrasados',
  aprovar_pedido: 'Pedidos para aprovar',
  conferir_nota: 'Notas para conferir com o pedido',
  aprovar_requisicao: 'Requisições para aprovar',
  gerar_pedido: 'Requisições aprovadas sem pedido',
  rascunho_parado: 'Rascunhos parados',
}
const ORDEM: TipoTarefa[] = ['pedido_atrasado', 'aprovar_pedido', 'conferir_nota', 'aprovar_requisicao', 'gerar_pedido', 'rascunho_parado']

/** Rascunho sem mexer há mais de tantos dias vira tarefa. */
export const DIAS_RASCUNHO_PARADO = 3

export type EntradaTarefas = {
  hoje: string
  pode: { aprovar: boolean; pedidos: boolean; requisicoes: boolean; notas: boolean }
  requisicoes: { id: number; numero: number; etapa: string; criadaEm: string; compradorId: number | null; itens: number; valor: number }[]
  pedidos: {
    id: number; numero: number; etapa: string; fornecedorNome: string; fornecedorCnpj: string | null; previsao: string | null
    atualizadoEm: string; compradorId: number | null; qtdBase: number; recebido: number; total: number
  }[]
  notas: { compraId: number; notaId: number | null; numero: string | null; fornecedorNome: string | null; fornecedorCnpj: string | null; emissao: string | null; temVinculo: boolean }[]
}

export type Tarefa = {
  tipo: TipoTarefa; ref: number; titulo: string; detalhe: string; href: string; data: string | null
  atrasoDias: number | null; valor: number | null; compradorId: number | null
}

const dia = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)
const diasEntre = (de: string, ate: string) => Math.round((dia(ate) - dia(de)) / 86_400_000)
const dig = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const EPS = 1e-6

export function montarTarefas(e: EntradaTarefas, filtro?: { compradorId?: number | null }): Tarefa[] {
  const t: Tarefa[] = []
  const faltaReceber = (p: EntradaTarefas['pedidos'][number]) => p.qtdBase > 0 && p.recebido + EPS < p.qtdBase

  for (const p of e.pedidos) {
    if (p.etapa === 'aprovado' && p.previsao && p.previsao < e.hoje && faltaReceber(p) && e.pode.pedidos) {
      const atraso = diasEntre(p.previsao, e.hoje)
      t.push({ tipo: 'pedido_atrasado', ref: p.id, titulo: `Pedido nº ${p.numero} · ${p.fornecedorNome}`,
        detalhe: `Entrega prevista para ${dataBR(p.previsao)}, ${atraso} dia(s) de atraso${p.recebido > EPS ? ', recebido em parte' : ''}.`,
        href: `/pedido-compra/${p.id}`, data: p.previsao, atrasoDias: atraso, valor: p.total, compradorId: p.compradorId })
    }
    if (p.etapa === 'aguardando_aprovacao' && e.pode.aprovar) {
      t.push({ tipo: 'aprovar_pedido', ref: p.id, titulo: `Pedido nº ${p.numero} · ${p.fornecedorNome}`, detalhe: 'Aguardando aprovação.',
        href: `/pedido-compra/${p.id}`, data: p.atualizadoEm, atrasoDias: null, valor: p.total, compradorId: p.compradorId })
    }
    if (p.etapa === 'rascunho' && e.pode.pedidos) {
      const parado = diasEntre(p.atualizadoEm, e.hoje)
      if (parado > DIAS_RASCUNHO_PARADO) {
        t.push({ tipo: 'rascunho_parado', ref: p.id, titulo: `Pedido nº ${p.numero} · ${p.fornecedorNome}`, detalhe: `Rascunho há ${parado} dias sem enviar para aprovação.`,
          href: `/pedido-compra/${p.id}`, data: p.atualizadoEm, atrasoDias: null, valor: p.total, compradorId: p.compradorId })
      }
    }
  }

  if (e.pode.notas && e.pode.pedidos) {
    const abertos = e.pedidos.filter((p) => p.etapa === 'aprovado' && faltaReceber(p) && dig(p.fornecedorCnpj))
    for (const n of e.notas) {
      if (n.temVinculo || !dig(n.fornecedorCnpj)) continue
      const ps = abertos.filter((p) => dig(p.fornecedorCnpj) === dig(n.fornecedorCnpj))
      if (!ps.length) continue
      const comp = new Set(ps.map((p) => p.compradorId))
      t.push({ tipo: 'conferir_nota', ref: n.compraId, titulo: `NF ${n.numero ?? '—'} · ${n.fornecedorNome ?? ''}`.trim(),
        detalhe: `Há pedido aprovado deste fornecedor: nº ${ps.map((p) => p.numero).join(', ')}. Confira a nota com o pedido.`,
        href: n.notaId ? `/nota-fiscal/${n.notaId}` : '/nota-fiscal', data: n.emissao, atrasoDias: null, valor: null,
        compradorId: comp.size === 1 ? [...comp][0] : null })
    }
  }

  for (const r of e.requisicoes) {
    if (r.etapa === 'aberta' && e.pode.aprovar) {
      t.push({ tipo: 'aprovar_requisicao', ref: r.id, titulo: `Requisição nº ${r.numero}`, detalhe: `${r.itens} item(ns) esperando aprovação.`,
        href: `/requisicao-compra/${r.id}`, data: r.criadaEm, atrasoDias: null, valor: r.valor, compradorId: r.compradorId })
    }
    if (r.etapa === 'aprovada' && e.pode.pedidos) {
      t.push({ tipo: 'gerar_pedido', ref: r.id, titulo: `Requisição nº ${r.numero}`, detalhe: 'Aprovada: falta gerar o pedido de compra.',
        href: '/requisicao-compra?etapa=aprovada', data: r.criadaEm, atrasoDias: null, valor: r.valor, compradorId: r.compradorId })
    }
  }

  const so = filtro?.compradorId
  return t
    .filter((x) => so == null || x.compradorId === so)
    .sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo) || (b.atrasoDias ?? 0) - (a.atrasoDias ?? 0) || (a.data ?? '').localeCompare(b.data ?? '') || a.ref - b.ref)
}

export function resumoTarefas(t: Tarefa[]): { total: number; porTipo: Record<TipoTarefa, number> } {
  const porTipo = Object.fromEntries(ORDEM.map((k) => [k, 0])) as Record<TipoTarefa, number>
  for (const x of t) porTipo[x.tipo]++
  return { total: t.length, porTipo }
}
