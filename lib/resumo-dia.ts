import { createServiceClient } from '@/lib/supabase/server'
import { statusInfo } from '@/lib/status-cor'

// "Resumo do dia" — painel gerencial. Consulta ao vivo das tabelas existentes,
// escopado por loja, para um dia (fuso America/Bahia, UTC-3 sem horario de verao).

// Dado 'YYYY-MM-DD' (dia em Bahia), devolve o intervalo UTC [ini, fim).
export function janelaDiaBahia(dataISO: string): { ini: string; fim: string } {
  const ini = `${dataISO}T03:00:00.000Z`
  const [y, m, d] = dataISO.split('-').map(Number)
  const prox = new Date(Date.UTC(y, m - 1, d + 1))
  const fim = `${prox.toISOString().slice(0, 10)}T03:00:00.000Z`
  return { ini, fim }
}

// Data de hoje em Bahia (YYYY-MM-DD).
export function hojeBahia(): string {
  const agora = new Date()
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export type ResumoKpis = {
  transferencias: number
  inventarios: number
  opsCriadas: number
  opsConcluidas: number
  movEntradas: number
  movSaidas: number
  etiquetas: number
  erros: number
}

export type EventoFeed = {
  ts: number // epoch ms, para ordenar
  hora: string // HH:MM (Bahia)
  pessoa: string | null
  acao: string // ex.: "criou transferência"
  alvo: string // ex.: "ADEGA → BAR"
  status: string | null
  lojaNome: string | null // preenchido quando o escopo tem mais de uma loja
}

export type ResumoPorLoja = { lojaId: number; nome: string; total: number }

export type ResumoDia = {
  kpis: ResumoKpis
  feed: EventoFeed[]
  porLoja: ResumoPorLoja[]
}

function horaBahia(iso: string): string {
  const t = new Date(new Date(iso).getTime() - 3 * 3600 * 1000)
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * Carrega o resumo de um dia para as lojas no escopo (lojaIds ja filtrado pela
 * permissao do usuario na page). multiLoja=true exibe a loja em cada evento.
 */
export async function carregarResumoDia(lojaIds: number[], dataISO: string): Promise<ResumoDia> {
  const vazio: ResumoDia = {
    kpis: { transferencias: 0, inventarios: 0, opsCriadas: 0, opsConcluidas: 0, movEntradas: 0, movSaidas: 0, etiquetas: 0, erros: 0 },
    feed: [],
    porLoja: [],
  }
  if (!lojaIds.length) return vazio

  const supabase = createServiceClient()
  const { ini, fim } = janelaDiaBahia(dataISO)
  const multiLoja = lojaIds.length > 1

  const [transf, invent, opsDia, opsConcl, mov, etiq, erros, lojas] = await Promise.all([
    supabase.from('transferencias').select('id, loja_id, codigo_local_origem, codigo_local_destino, status, created_at, user_id')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('inventarios').select('id, loja_id, codigo_local_estoque, status, finalizado, created_at, user_id')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    // OPs vêm do Omie via sync, então created_at = data do sync (não da equipe).
    // "OPs do dia" = previstas para o dia; concluídas = data de conclusão real.
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true })
      .in('loja_id', lojaIds).eq('identificacao_d_dt_previsao', dataISO),
    supabase.from('ordens_producao').select('id', { count: 'exact', head: true })
      .in('loja_id', lojaIds).eq('dt_conclusao_real', dataISO),
    supabase.from('movimentos_historico').select('loja_id, entradas, saidas').in('loja_id', lojaIds).eq('data', dataISO),
    supabase.from('impressao_etiquetas').select('id, loja_id, qtd_etiquetas, user_id, created_at')
      .in('loja_id', lojaIds).gte('created_at', ini).lt('created_at', fim),
    supabase.from('integration_attempts').select('id', { count: 'exact', head: true })
      .in('loja_id', lojaIds).eq('error', true).gte('created_at', ini).lt('created_at', fim),
    supabase.from('lojas').select('id, nome, nome_fantasia').in('id', lojaIds),
  ])

  const transfRows = transf.data ?? []
  const inventRows = invent.data ?? []
  const etiqRows = etiq.data ?? []

  // --- Resolver nomes (usuarios, locais, lojas) em lote ---
  const userIds = [...new Set([
    ...transfRows.map((r) => r.user_id),
    ...inventRows.map((r) => r.user_id),
    ...etiqRows.map((r) => r.user_id),
  ].filter(Boolean) as string[])]
  const codigosLocais = [...new Set([
    ...transfRows.flatMap((r) => [r.codigo_local_origem, r.codigo_local_destino]),
    ...inventRows.map((r) => r.codigo_local_estoque),
  ].filter((v) => v != null) as number[])]

  const [profilesRes, locaisRes] = await Promise.all([
    userIds.length ? supabase.from('profiles').select('id, name').in('id', userIds) : Promise.resolve({ data: [] }),
    codigosLocais.length
      ? supabase.from('local_estoques').select('loja_id, codigo_local_estoque, descricao').in('loja_id', lojaIds).in('codigo_local_estoque', codigosLocais)
      : Promise.resolve({ data: [] }),
  ])

  const nomePorUser = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as { id: string; name: string }[]) nomePorUser.set(p.id, p.name)
  const nomeLocal = new Map<string, string>()
  for (const l of (locaisRes.data ?? []) as { loja_id: number; codigo_local_estoque: number; descricao: string }[]) {
    nomeLocal.set(`${l.loja_id}-${l.codigo_local_estoque}`, l.descricao)
  }
  const nomeLoja = new Map<number, string>()
  for (const l of (lojas.data ?? []) as { id: number; nome: string | null; nome_fantasia: string | null }[]) {
    nomeLoja.set(l.id, l.nome_fantasia || l.nome || `Loja ${l.id}`)
  }
  const local = (loja: number, cod: number | null) => (cod != null ? nomeLocal.get(`${loja}-${cod}`) ?? `Local ${cod}` : '-')
  const lojaTag = (loja: number) => (multiLoja ? nomeLoja.get(loja) ?? null : null)

  // --- KPIs ---
  let movEntradas = 0
  let movSaidas = 0
  for (const m of (mov.data ?? []) as { entradas: number | null; saidas: number | null }[]) {
    movEntradas += Number(m.entradas ?? 0)
    movSaidas += Number(m.saidas ?? 0)
  }
  const etiquetasTotal = etiqRows.reduce((s, e) => s + Number(e.qtd_etiquetas ?? 0), 0)

  const kpis: ResumoKpis = {
    transferencias: transfRows.length,
    inventarios: inventRows.length,
    opsCriadas: opsDia.count ?? 0,
    opsConcluidas: opsConcl.count ?? 0,
    movEntradas,
    movSaidas,
    etiquetas: etiquetasTotal,
    erros: erros.count ?? 0,
  }

  // --- Feed (quem fez o que) ---
  const feed: EventoFeed[] = []
  for (const t of transfRows) {
    feed.push({
      ts: new Date(t.created_at).getTime(),
      hora: horaBahia(t.created_at),
      pessoa: t.user_id ? nomePorUser.get(t.user_id) ?? null : null,
      acao: 'criou transferência',
      alvo: `${local(t.loja_id, t.codigo_local_origem)} → ${local(t.loja_id, t.codigo_local_destino)}`,
      status: statusInfo(t.status).label,
      lojaNome: lojaTag(t.loja_id),
    })
  }
  for (const inv of inventRows) {
    feed.push({
      ts: new Date(inv.created_at).getTime(),
      hora: horaBahia(inv.created_at),
      pessoa: inv.user_id ? nomePorUser.get(inv.user_id) ?? null : null,
      acao: inv.finalizado ? 'finalizou inventário' : 'iniciou inventário',
      alvo: local(inv.loja_id, inv.codigo_local_estoque),
      status: statusInfo(inv.status).label,
      lojaNome: lojaTag(inv.loja_id),
    })
  }
  for (const e of etiqRows) {
    feed.push({
      ts: new Date(e.created_at).getTime(),
      hora: horaBahia(e.created_at),
      pessoa: e.user_id ? nomePorUser.get(e.user_id) ?? null : null,
      acao: 'imprimiu etiquetas',
      alvo: `${Number(e.qtd_etiquetas ?? 0)} etiqueta(s)`,
      status: null,
      lojaNome: lojaTag(e.loja_id),
    })
  }
  feed.sort((a, b) => b.ts - a.ts)

  // --- Por loja (so quando ha mais de uma loja no escopo) ---
  const porLoja: ResumoPorLoja[] = []
  if (multiLoja) {
    const cont = new Map<number, number>()
    const inc = (loja: number) => cont.set(loja, (cont.get(loja) ?? 0) + 1)
    transfRows.forEach((t) => inc(t.loja_id))
    inventRows.forEach((i) => inc(i.loja_id))
    etiqRows.forEach((e) => inc(e.loja_id))
    for (const id of lojaIds) {
      porLoja.push({ lojaId: id, nome: nomeLoja.get(id) ?? `Loja ${id}`, total: cont.get(id) ?? 0 })
    }
    porLoja.sort((a, b) => b.total - a.total)
  }

  return { kpis, feed, porLoja }
}
