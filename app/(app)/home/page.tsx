import { getProfile, getPermissoesNomes, getAtorGestao } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { NAO_CANCELADA_OR } from '@/lib/nf-status'
import Link from 'next/link'
import {
  Package,
  ClipboardList,
  ArrowLeftRight,
  FileText,
  ArrowRight,
  TrendingUp,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SyncButton } from '@/components/SyncButton'
import { CountUp } from '@/components/ui-kit/CountUp'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'
import { limiteJanelaQuente, contarOrdensProducaoAntigas, complementarOrdensProducao } from '@/lib/historico-contabo'
import { PainelGerencial } from '@/components/home/PainelGerencial'

export default async function HomePage() {
  const profile = await getProfile()

  if (!profile.current_loja_id) {
    return (
      <EmptyState
        icon={Package}
        title="Selecione uma loja"
        hint="Escolha uma loja no menu lateral para ver o painel."
      />
    )
  }

  const lojaId = profile.current_loja_id
  const supabase = await createClient()
  const ator = await getAtorGestao()

  const isAdmin = profile.perfil === 'Admin'
  const perms = await getPermissoesNomes(lojaId)
  const pode = (nome: string) => perms.has('*') || perms.has(nome)

  if (!isAdmin) {
    const { data: vinculo } = await supabase
      .from('loja_user')
      .select('id')
      .eq('loja_id', lojaId)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!vinculo) {
      return (
        <EmptyState
          icon={Package}
          title="Selecione uma loja válida"
          hint="Você não tem acesso à loja atual. Escolha uma loja no menu lateral."
        />
      )
    }
  }

  // Datas ancoradas em HOJE (America/Bahia) + offset, com aritmética UTC.
  function localISO(offsetDias: number): string {
    const d = new Date(`${hojeBahiaISO()}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + offsetDias)
    return d.toISOString().slice(0, 10)
  }
  const trintaDias = localISO(-30)
  const hojeLocal = localISO(0)
  const ontemLocal = localISO(-1)
  const seteDias = localISO(7)
  const primeiroDiaMesISO = `${hojeLocal.slice(0, 7)}-01`
  const desde24h = new Date(Date.now() - 24 * 3600000).toISOString()
  const head = { count: 'exact' as const, head: true }

  // Phase 1: todas as contagens + data mais recente de posicao (para valor do estoque)
  const [produtos, nfs, ops, invAbertos, vencendo, errosSync, loja, nfPendentes, reporRes, transfAbertas, maxPosRes, opsPendentesRetry] =
    await Promise.all([
      supabase.from('produtos').select('id', head).eq('loja_id', lojaId),
      supabase.from('notas_fiscais').select('id', head).eq('loja_id', lojaId).gte('d_emissao_nfe', trintaDias).is('deleted_at', null),
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId),
      supabase.from('inventarios').select('id', head).eq('loja_id', lojaId).neq('status', 'Finalizado'),
      // SALDO_OR (não só `quantidade.gt.0`): `quantidade` é a etiqueta setada
      // manualmente e fica NULL na maioria das OPs -- o saldo real cai em
      // `identificacao_n_qtde` (planejado no Omie) quando não há etiqueta.
      // Achado real (auditoria de relatórios, 2026-07-26): mesmo bug já
      // corrigido em /validade e lib/resumo-dia.ts, deixado pra trás aqui --
      // loja 4 mostrava 0 produtos vencendo quando o real era 6.
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId).not('validade', 'is', null).gte('validade', hojeLocal).lte('validade', seteDias).or('quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'),
      supabase.from('integration_attempts').select('id', head).eq('loja_id', lojaId).eq('error', true).gte('created_at', desde24h),
      supabase.from('lojas').select('produto_ultima_atualizacao').eq('id', lojaId).single(),
      // Item #16: mesma logica de "NF travada" ja usada no painel de acao
      // gerencial (lib/resumo-dia.ts, carregarPainelAcao) -- mes atual, etapa
      // != concluida (60), nao cancelada, ate ontem (hoje ainda esta em
      // processamento natural). Antes, a home nao tinha esse alerta -- so o
      // /resumo (gerencial) tinha.
      supabase
        .from('notas_fiscais')
        .select('id', head)
        .eq('loja_id', lojaId)
        .is('deleted_at', null)
        .neq('c_etapa', '60')
        .or(NAO_CANCELADA_OR)
        .gte('d_emissao_nfe', primeiroDiaMesISO)
        .lte('d_emissao_nfe', ontemLocal),
      supabase.rpc('produtos_repor', { p_loja_id: lojaId }),
      supabase.from('transferencias').select('id', head).eq('loja_id', lojaId).neq('status', 'Concluido'),
      supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).order('data_posicao', { ascending: false }).limit(1).maybeSingle(),
      // Pendentes de reenvio: falhou ao concluir (erro generico ou Sem CMC) e ainda
      // nao concluiu. Usa o indice parcial idx_op_retry_pendente.
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId).eq('concluida', false).not('conclusao_status', 'is', null),
    ])

  const codigosRepor = (reporRes.data ?? []) as number[]
  const qtdRepor = codigosRepor.length
  const maxDate = (maxPosRes.data as { data_posicao: string } | null)?.data_posicao ?? null

  // Card "Ordens de producao" (ops.count, ja calculado no Promise.all acima) nao
  // tem filtro de data (conta todas as recentes, pos-poda). Completa com a parte
  // antiga do Contabo via contagem real (count=true, sem LIMIT) pra nao truncar
  // o numero -- disjunta do que o Supabase ja tem, sem duplicar.
  const opsAntigasCount = await contarOrdensProducaoAntigas({ lojaId, dataFinal: limiteJanelaQuente() })
  const opsTotalCount = (ops.count ?? 0) + opsAntigasCount

  // Estoque JA vencido (validade < hoje, ainda com saldo) -- mesma logica da tela
  // /validade ("Vencidos"), so que aqui e so a contagem pro alerta. Sem limite
  // inferior de data, entao busca as linhas (nao head:true) e mescla com o Contabo
  // por id pra nao contar em dobro o que ainda esta nos dois lugares antes da poda.
  const SALDO_OR = 'quantidade.gt.0,and(quantidade.is.null,identificacao_n_qtde.gt.0)'
  const { data: vencidasQuentesRaw } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_n_cod_produto, quantidade, identificacao_n_qtde')
    .eq('loja_id', lojaId)
    .not('validade', 'is', null)
    .or(SALDO_OR)
    .lt('validade', hojeLocal)
  const vencidasCompletas = await complementarOrdensProducao(vencidasQuentesRaw ?? [], {
    lojaId,
    validadeInicio: '0001-01-01',
    validadeFinal: localISO(-1),
  })
  const qtdVencidos = vencidasCompletas.filter((o) => {
    const temSaldo = Number(o.quantidade ?? 0) > 0 || (o.quantidade == null && Number(o.identificacao_n_qtde ?? 0) > 0)
    return temSaldo
  }).length

  // Phase 2: produtos a repor + saldo/mínimo para a lista
  const [prodsReporRes, posReporRes] = await Promise.all([
    qtdRepor
      ? supabase.from('produtos').select('codigo_produto, codigo, descricao').eq('loja_id', lojaId).in('codigo_produto', codigosRepor.slice(0, 8)).order('descricao')
      : (Promise.resolve({ data: [] }) as Promise<{ data: { codigo_produto: number; codigo: string; descricao: string }[] }>),
    maxDate && qtdRepor
      ? supabase.from('posicao_estoques').select('n_cod_prod, n_saldo, estoque_minimo').eq('loja_id', lojaId).eq('data_posicao', maxDate).in('n_cod_prod', codigosRepor.slice(0, 8))
      : (Promise.resolve({ data: [] }) as Promise<{ data: { n_cod_prod: number; n_saldo: number; estoque_minimo: number | null }[] }>),
  ])

  const prodsRepor = prodsReporRes.data ?? []

  // A.3.4: mapa de saldo/mínimo por produto (acumula locais)
  const saldoMap = new Map<number, { saldo: number; minimo: number }>()
  for (const r of posReporRes.data ?? []) {
    const cod = Number(r.n_cod_prod)
    const e = saldoMap.get(cod) ?? { saldo: 0, minimo: 0 }
    e.saldo += Number(r.n_saldo) || 0
    e.minimo += Number(r.estoque_minimo) || 0
    saldoMap.set(cod, e)
  }

  // A.3.3: último sync - data+hora completa + aviso se >24h
  const syncTs = loja.data?.produto_ultima_atualizacao ? new Date(loja.data.produto_ultima_atualizacao) : null
  const ultimaSync = syncTs
    ? syncTs.toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'nunca'
  const syncAtraso = !syncTs || Date.now() - syncTs.getTime() > 24 * 3600 * 1000

  const lojaNome = profile.loja?.nome_fantasia || profile.loja?.nome || ''

  type Alerta = {
    icon: LucideIcon
    token: CorToken
    texto: string
    href: string
    action?: { endpoint: string; label: string }
  }
  const alertas: Alerta[] = []
  if ((opsPendentesRetry.count ?? 0) > 0 && pode('Ordens de Producao - Concluir'))
    alertas.push({
      icon: AlertTriangle,
      token: 'err',
      texto: `${opsPendentesRetry.count} ordem(ns) de produção com falha ao concluir no Omie`,
      href: '/ordem-producao',
      action: { endpoint: '/api/sync/retry-op-conclusao', label: 'Reenviar pendentes' },
    })
  if (qtdRepor > 0 && pode('Produtos'))
    alertas.push({ icon: AlertTriangle, token: 'err', texto: `${qtdRepor} produto(s) abaixo do mínimo para repor`, href: '/produto?vista=compras&repor=1' })
  if ((errosSync.count ?? 0) > 0 && isAdmin)
    alertas.push({ icon: AlertTriangle, token: 'err', texto: `${errosSync.count} erro(s) de sincronização nas últimas 24h`, href: '/sync-status' })
  if (syncAtraso && isAdmin)
    alertas.push({ icon: TrendingUp, token: 'warn', texto: 'Sincronização com Omie atrasada (mais de 24h)', href: '/sync-status' })
  if (qtdVencidos > 0 && pode('Validade'))
    alertas.push({ icon: CalendarClock, token: 'err', texto: `${qtdVencidos} produto(s) já vencido(s) ainda em estoque`, href: '/validade?modo=vencidos' })
  if ((vencendo.count ?? 0) > 0 && pode('Validade'))
    alertas.push({ icon: CalendarClock, token: 'warn', texto: `${vencendo.count} produto(s) vencem nos próximos 7 dias`, href: '/validade' })
  if ((invAbertos.count ?? 0) > 0 && pode('Inventarios - Ver'))
    alertas.push({ icon: ClipboardList, token: 'brand', texto: `${invAbertos.count} inventário(s) em contagem aguardando finalização`, href: '/inventario' })
  if ((transfAbertas.count ?? 0) > 0 && pode('Transferencias - Ver'))
    alertas.push({ icon: ArrowLeftRight, token: 'brand', texto: `${transfAbertas.count} transferência(s) em aberto`, href: '/transferencia' })
  if ((nfPendentes.count ?? 0) > 0 && pode('Notas Fiscais'))
    alertas.push({ icon: FileText, token: 'warn', texto: `${nfPendentes.count} nota(s) fiscal(is) pendente(s) este mês`, href: '/nota-fiscal?status=P' })

  const secundarios = [
    { label: 'Notas fiscais', value: nfs.count ?? 0, hint: '30 dias', href: '/nota-fiscal', perm: 'Notas Fiscais' },
    { label: 'Ordens de produção', value: opsTotalCount, hint: 'total', href: '/ordem-producao', perm: 'Ordens de Producao' },
    { label: 'Inventários', value: invAbertos.count ?? 0, hint: 'abertos', href: '/inventario', perm: 'Inventarios - Ver' },
  ].filter((k) => pode(k.perm))

  const atalhos = [
    { label: 'Novo inventário', desc: 'Contagem de estoque', href: '/inventario', icon: ClipboardList, perm: 'Inventarios - Criar' },
    { label: 'Nova transferência', desc: 'Entre locais', href: '/transferencia', icon: ArrowLeftRight, perm: 'Transferencias - Criar' },
    { label: 'Etiquetas de NF', desc: 'Imprimir', href: '/nota-fiscal', icon: FileText, perm: 'Notas Fiscais' },
  ].filter((a) => pode(a.perm))

  const fmtQtd = (n: number) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-ink text-white p-7 lg:p-9">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{ background: 'radial-gradient(120% 80% at 85% -20%, rgba(46,181,195,0.18), transparent 60%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-brand" />
            {lojaNome}
          </div>
          <div className="mt-6 flex items-end justify-between gap-6 flex-wrap">
            <div>
              <p className="text-[12px] uppercase tracking-[0.16em] text-white/45 mb-2">Produtos em estoque</p>
              <div className="num text-[4.5rem] leading-[0.85] font-bold tracking-tight">
                <CountUp value={produtos.count ?? 0} duration={750} />
              </div>
              <div className="mt-4 h-1 w-24 rounded-full bg-brand" />
            </div>
            {/* A.3.3: badge de sync com data+hora e aviso se atrasado */}
            <div className="flex flex-col items-end gap-1.5">
              <div
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] ring-1 ${
                  syncAtraso ? 'bg-warn/20 ring-warn/30 text-warn' : 'bg-white/5 ring-white/10 text-white/70'
                }`}
              >
                <TrendingUp className={`size-3.5 ${syncAtraso ? 'text-warn' : 'text-brand'}`} />
                sync {ultimaSync}
              </div>
              {syncAtraso && (
                <span className="text-[11px] text-warn/70">atrasado (+24h)</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Precisa de atenção */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
          Precisa de atenção
        </h2>
        {alertas.length ? (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <div
                key={i}
                className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3 u-motion hover:border-text/20 hover:shadow-[var(--shadow-sm)]"
              >
                <Link href={a.href} className="flex min-w-0 flex-1 items-center gap-3.5 u-press">
                  <span className={`flex size-8 items-center justify-center rounded-md shrink-0 ${SELO_CLASSE[a.token]}`}>
                    <a.icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-text">{a.texto}</span>
                  {!a.action && (
                    <ArrowRight className="size-4 shrink-0 text-text-muted/40 u-motion group-hover:text-text-muted group-hover:translate-x-0.5" />
                  )}
                </Link>
                {a.action && <SyncButton endpoint={a.action.endpoint} label={a.action.label} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-ok/10 text-ok shrink-0">
              <CheckCircle2 className="size-4" strokeWidth={2} />
            </span>
            <span className="text-sm text-text">Tudo em ordem. Nada pendente na loja.</span>
          </div>
        )}
      </section>

      {/* KPIs secundários */}
      {secundarios.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {secundarios.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 u-motion u-card hover:border-brand/40"
            >
              <span className="absolute left-0 top-0 h-full w-1 bg-brand/0 group-hover:bg-brand u-motion" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{k.label}</p>
              <div className="mt-3 flex items-end gap-2">
                <span className="num text-[2.4rem] leading-none font-bold tracking-tight text-text">
                  <CountUp value={k.value} duration={550} />
                </span>
                <span className="mb-1 text-[12px] text-text-muted">{k.hint}</span>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* Atalhos */}
      {atalhos.length > 0 && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Ações rápidas</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {atalhos.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-4 u-motion u-press hover:bg-ink hover:border-ink"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white u-motion shrink-0">
                  <a.icon className="size-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text group-hover:text-white u-motion">{a.label}</div>
                  <div className="text-[11px] text-text-muted group-hover:text-white/50 u-motion truncate">{a.desc}</div>
                </div>
                <ArrowRight className="size-4 text-text-muted/30 group-hover:text-brand group-hover:translate-x-0.5 u-motion shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* A.3.4: Repor estoque com saldo e mínimo lado a lado */}
      {qtdRepor > 0 && pode('Produtos') && (
        <section>
          <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Repor estoque</h2>
            <Link href="/produto?vista=compras&repor=1" className="text-[13px] text-brand hover:underline">
              ver todos ({qtdRepor}) →
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {prodsRepor.map((p) => {
              const pos = saldoMap.get(p.codigo_produto)
              return (
                <li key={p.codigo_produto} className="flex items-center gap-3 py-3">
                  <span className="flex size-7 items-center justify-center rounded-md bg-err/10 text-err shrink-0">
                    <AlertTriangle className="size-3.5" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{formatarNomeProduto(p.descricao)}</span>
                  {pos && (
                    <span className="flex items-center gap-1 shrink-0 text-[12px]">
                      <span className="num text-err font-medium" title="Saldo atual">{fmtQtd(pos.saldo)}</span>
                      <span className="text-text-muted">/</span>
                      <span className="num text-text-muted" title="Estoque mínimo">{fmtQtd(pos.minimo)}</span>
                    </span>
                  )}
                  <span className="num text-[12px] text-text-muted shrink-0">{p.codigo}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Item #16: painel gerencial (graficos) so pra quem pode gerir --
          Operacao nunca ve valor de faturamento/compra/rejeito aqui. A secao
          "Ultimas notas fiscais" que existia antes (mostrava n_valor_nfe pra
          TODO MUNDO, inclusive Operacao -- vazamento real, achado nesta
          tarefa) saiu daqui; quem precisa dessa lista usa /nota-fiscal. */}
      {ator.podeGerir && <PainelGerencial lojaId={lojaId} />}
    </div>
  )
}
