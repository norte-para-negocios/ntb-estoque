import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { StatCard } from '@/components/ui-kit/StatCard'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { Wrench, CheckCircle2, XCircle, PauseCircle, HelpCircle, AlertTriangle } from 'lucide-react'
import {
  MODULOS, MODULO_LABEL, STATUS, STATUS_LABEL, STATUS_ORIENTACAO, STATUS_PRECISA_DECISAO, dataBR,
  type Modulo, type StatusCorrecao,
} from '@/lib/correcoes/robo'
import {
  AntesDepois, CorrecaoCard, ProdutoELinks, Quantidade, StatusCorrecaoPill, fmtHora, type CorrecaoRow,
} from '@/components/correcoes/CorrecaoItem'

// Correções automáticas (08/10/2026): o que o robô ("faxina") corrigiu no Omie da loja e o que precisa de decisão humana.
// SOMENTE LEITURA: esta tela nunca escreve no Omie nem no banco (a escrita é a API /api/correcoes/ingest).
const LIMITE_LINHAS = 300
const LIMITE_FILA = 100
const COLUNAS = 'id, loja_id, lote, modulo, acao, produto_cod, produto_desc, data_ref, quantidade, de_valor, para_valor, status, motivo, omie_ref, origem_ts, dados'
const ISO = /^\d{4}-\d{2}-\d{2}$/

type SP = { data_inicio?: string; data_final?: string; loja_id?: string; modulo?: string; status?: string }

export default async function CorrecoesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()
  const lojaAtual = await getCurrentLojaId()
  const sp = await searchParams
  const supabase = await createClient() // RLS por loja (migration 171): nunca o service role numa tela

  const hoje = dataBR(new Date().toISOString())
  const ini = sp.data_inicio && ISO.test(sp.data_inicio) ? sp.data_inicio : hoje
  const fim = sp.data_final && ISO.test(sp.data_final) ? sp.data_final : ini > hoje ? ini : hoje

  const permitidas = ator.lojaIds.length ? ator.lojaIds : [lojaAtual]
  const ehTodas = sp.loja_id === 'todas'
  const lojaSel = Number(sp.loja_id)
  const lojaIds = ehTodas ? permitidas : permitidas.includes(lojaSel) ? [lojaSel] : permitidas.includes(lojaAtual) ? [lojaAtual] : permitidas.slice(0, 1)
  const modulo = (MODULOS as readonly string[]).includes(sp.modulo ?? '') ? (sp.modulo as Modulo) : null
  const status = (STATUS as readonly string[]).includes(sp.status ?? '') ? (sp.status as StatusCorrecao) : null

  const { data: lojasRows } = permitidas.length > 1
    ? await supabase.from('lojas').select('id, nome, nome_fantasia').in('id', permitidas).order('nome_fantasia')
    : { data: null }

  const base = () => {
    let q = supabase.from('correcoes_automaticas').select(COLUNAS, { count: 'exact' }).in('loja_id', lojaIds)
    if (modulo) q = q.eq('modulo', modulo)
    return q
  }
  const contar = (s: StatusCorrecao[]) =>
    supabase.from('correcoes_automaticas').select('id', { count: 'exact', head: true })
      .in('loja_id', lojaIds).gte('data_ref', ini).lte('data_ref', fim).in('status', s)
      .match(modulo ? { modulo } : {})

  let listaQ = base().gte('data_ref', ini).lte('data_ref', fim)
  if (status) listaQ = listaQ.eq('status', status)
  const filaQ = base().in('status', STATUS_PRECISA_DECISAO)

  const [lista, fila, cOk, cFalhou, cParado, cDecisao] = await Promise.all([
    listaQ.order('origem_ts', { ascending: false }).limit(LIMITE_LINHAS).returns<CorrecaoRow[]>(),
    filaQ.order('origem_ts', { ascending: false }).limit(LIMITE_FILA).returns<CorrecaoRow[]>(),
    contar(['ok']), contar(['falhou']), contar(['parado']), contar(['pendente_decisao']),
  ])

  const erro = [lista, fila, cOk, cFalhou, cParado, cDecisao].find((r) => r.error)?.error
  if (erro) {
    console.error('correcoes: consulta falhou', erro.code, erro.message)
    const semTabela = erro.code === '42P01' || /correcoes_automaticas/.test(erro.message ?? '')
    return (
      <div className="space-y-4">
        <PageHeader title="Feito pelo robô" icon={Wrench} />
        <EmptyState
          icon={AlertTriangle}
          title={semTabela ? 'Tela ainda não ativada' : 'Não foi possível carregar as correções'}
          hint={semTabela ? 'A tabela de correções automáticas ainda não foi criada neste ambiente (migration 171).' : 'Tente de novo em instantes. Se persistir, avise o suporte.'}
        />
      </div>
    )
  }

  const linhas = lista.data ?? []
  const pendentes = fila.data ?? []
  const nomeLoja = new Map((lojasRows ?? []).map((l) => [l.id as number, (l.nome_fantasia || l.nome) as string]))
  const multiLoja = lojaIds.length > 1

  // Agrupa por lote mantendo a ordem (mais recente primeiro).
  const lotes = new Map<string, CorrecaoRow[]>()
  for (const r of linhas) {
    const k = `${r.loja_id}|${r.lote}`
    const arr = lotes.get(k)
    if (arr) arr.push(r)
    else lotes.set(k, [r])
  }

  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data início' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    ...(permitidas.length > 1
      ? ([{
          tipo: 'select', nome: 'loja_id', label: 'Loja',
          opcoes: [{ value: 'todas', label: 'Todas as lojas' }, ...(lojasRows ?? []).map((l) => ({ value: String(l.id), label: (l.nome_fantasia || l.nome) as string }))],
        }] as CampoFiltro[])
      : []),
    { tipo: 'select', nome: 'modulo', label: 'Módulo', opcoes: MODULOS.map((m) => ({ value: m, label: MODULO_LABEL[m] })) },
    { tipo: 'select', nome: 'status', label: 'Status', opcoes: STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
  ]
  const defaults: Record<string, string> = {
    data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', loja_id: sp.loja_id ?? '',
    modulo: sp.modulo ?? '', status: sp.status ?? '',
  }
  const periodoTxt = ini === fim ? (ini === hoje ? 'hoje' : ini.split('-').reverse().join('/')) : `${ini.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}`

  return (
    <div className="space-y-5">
      <ListaHeader>
        <PageHeader
          title="Feito pelo robô"
          icon={Wrench}
          description="O que o robô (faxina) corrigiu no Omie e o que precisa da sua decisão. Esta tela só mostra, não altera nada. Os problemas abertos ficam na Central de correções."
          actions={<FiltrosGaveta basePath="/correcoes" campos={campos} defaults={defaults} persistirEm="/correcoes" />}
        />
        <ChipsFiltrosAtivos basePath="/correcoes" campos={campos} persistirEm="/correcoes" />
      </ListaHeader>

      <section aria-label={`Totais de ${periodoTxt}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Corrigidas" value={cOk.count ?? 0} hint={periodoTxt} icon={CheckCircle2} />
          <StatCard label="Falharam" value={cFalhou.count ?? 0} hint={periodoTxt} icon={XCircle} />
          <StatCard label="Paradas" value={cParado.count ?? 0} hint={periodoTxt} icon={PauseCircle} />
          <StatCard label="Aguardando decisão" value={cDecisao.count ?? 0} hint={periodoTxt} icon={HelpCircle} />
        </div>
      </section>

      <section aria-label="Precisa de decisão" className="space-y-2">
        <h2 className="text-[17px] font-semibold text-text">Precisa de decisão</h2>
        {pendentes.length === 0 ? (
          <p className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[14px] text-text-muted shadow-[var(--shadow-sm)]">
            Nada esperando decisão. O robô não deixou pendências abertas.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-text-muted">
              {pendentes.length >= LIMITE_FILA ? `Mostrando as ${LIMITE_FILA} mais recentes. ` : ''}
              Itens abertos de qualquer data. Resolva no Omie ou com quem opera a faxina; esta tela não executa a correção.
            </p>
            <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
              {pendentes.map((r) => (
                <div key={r.id} className="space-y-1.5 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <ProdutoELinks r={r} />
                    <StatusCorrecaoPill status={r.status} />
                  </div>
                  <div className="text-[13px] font-medium text-text">
                    {r.acao} <span className="font-normal text-text-muted">· {MODULO_LABEL[r.modulo]}{multiLoja ? ` · ${nomeLoja.get(r.loja_id) ?? `Loja ${r.loja_id}`}` : ''} · {fmtHora(r.origem_ts)}</span>
                  </div>
                  {r.motivo && <p className="text-[13px] text-text">{r.motivo}</p>}
                  <p className="text-[13px] text-text-muted">
                    <span className="font-medium text-text">O que fazer: </span>{STATUS_ORIENTACAO[r.status]}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section aria-label="Correções por lote" className="space-y-3">
        <h2 className="text-[17px] font-semibold text-text">Lotes de {periodoTxt}</h2>
        {lotes.size === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Nenhuma correção neste filtro"
            hint="Quando o robô rodar e enviar o resultado, as correções aparecem aqui. Experimente ampliar o período."
          />
        ) : (
          <>
            {[...lotes.entries()].map(([k, rs]) => {
              const resumo = STATUS.map((s) => [s, rs.filter((r) => r.status === s).length] as const).filter(([, n]) => n > 0)
              return (
                <div key={k} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h3 className="text-[15px] font-semibold text-text">Lote {rs[0].lote}</h3>
                    <span className="text-[13px] text-text-muted">
                      {multiLoja ? `${nomeLoja.get(rs[0].loja_id) ?? `Loja ${rs[0].loja_id}`} · ` : ''}
                      {fmtHora(rs[0].origem_ts)} · {resumo.map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}
                    </span>
                  </div>
                  <div className="hidden lg:block">
                    <DataTable>
                      <thead>
                        <tr>
                          <th className="w-[12%]">Módulo / ação</th>
                          <th className="w-[24%]">Produto</th>
                          <th className="w-[8%] text-right">Qtd</th>
                          <th className="w-[14%]">Antes → depois</th>
                          <th className="w-[14%]">Status</th>
                          <th>Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rs.map((r) => (
                          <tr key={r.id} className="align-top">
                            <td>
                              <div className="text-[14px] font-medium text-text">{r.acao}</div>
                              <div className="text-[12px] text-text-muted">{MODULO_LABEL[r.modulo]}</div>
                            </td>
                            <td><ProdutoELinks r={r} /></td>
                            <td className="text-right"><Quantidade v={r.quantidade} /></td>
                            <td><AntesDepois r={r} /></td>
                            <td><StatusCorrecaoPill status={r.status} /></td>
                            <td className="text-[13px] text-text-muted">{r.motivo ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                  <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)] lg:hidden">
                    {rs.map((r) => <CorrecaoCard key={r.id} r={r} mostrarModulo />)}
                  </div>
                </div>
              )
            })}
            {(lista.count ?? 0) > linhas.length && (
              <p className="text-[13px] text-text-muted">Mostrando as {linhas.length} mais recentes de {lista.count}. Use os filtros para refinar.</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
