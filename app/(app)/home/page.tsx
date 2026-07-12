import { getProfile, getPermissoesNomes } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
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
import { CountUp } from '@/components/ui-kit/CountUp'
import { Money } from '@/components/ui-kit/Money'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'
import { limiteJanelaQuente } from '@/lib/historico-contabo'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

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
  const seteDias = localISO(7)
  const desde24h = new Date(Date.now() - 24 * 3600000).toISOString()
  const head = { count: 'exact' as const, head: true }

  // Phase 1: todas as contagens + data mais recente de posicao (para valor do estoque)
  const [produtos, nfs, ops, invAbertos, vencendo, errosSync, loja, ultimasNotas, reporRes, transfAbertas, maxPosRes] =
    await Promise.all([
      supabase.from('produtos').select('id', head).eq('loja_id', lojaId),
      supabase.from('notas_fiscais').select('id', head).eq('loja_id', lojaId).gte('d_emissao_nfe', trintaDias).is('deleted_at', null),
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId),
      supabase.from('inventarios').select('id', head).eq('loja_id', lojaId).neq('status', 'Finalizado'),
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId).not('validade', 'is', null).gte('validade', hojeLocal).lte('validade', seteDias).gt('quantidade', 0),
      supabase.from('integration_attempts').select('id', head).eq('loja_id', lojaId).eq('error', true).gte('created_at', desde24h),
      supabase.from('lojas').select('produto_ultima_atualizacao').eq('id', lojaId).single(),
      supabase.from('notas_fiscais').select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe').eq('loja_id', lojaId).is('deleted_at', null).order('d_emissao_nfe', { ascending: false }).limit(5),
      supabase.rpc('produtos_repor', { p_loja_id: lojaId }),
      supabase.from('transferencias').select('id', head).eq('loja_id', lojaId).neq('status', 'Concluido'),
      supabase.from('posicao_estoques').select('data_posicao').eq('loja_id', lojaId).order('data_posicao', { ascending: false }).limit(1).maybeSingle(),
    ])

  const codigosRepor = (reporRes.data ?? []) as number[]
  const qtdRepor = codigosRepor.length
  const maxDate = (maxPosRes.data as { data_posicao: string } | null)?.data_posicao ?? null

  // Card "Ordens de producao" nao tem filtro de data (conta todas) -- soma a
  // parte antiga do Contabo pra nao cair silenciosamente depois da poda.
  const cutoff = limiteJanelaQuente()
  let opsAntigasCount = 0
  if (process.env.NTB_FRIO_API_URL) {
    try {
      const resp = await fetch(
        `${process.env.NTB_FRIO_API_URL}/ordens_producao?loja_id=${lojaId}&data_final=${cutoff}`,
        { headers: { 'X-Api-Key': process.env.NTB_FRIO_API_KEY! }, signal: AbortSignal.timeout(5000) }
      )
      if (resp.ok) {
        const json = (await resp.json()) as { rows?: unknown[] }
        opsAntigasCount = json.rows?.length ?? 0
      }
    } catch (e) {
      console.error('home/page: falha ao completar contagem de OPs com o Contabo', e)
    }
  }
  const opsTotalCount = (ops.count ?? 0) + opsAntigasCount

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

  type Alerta = { icon: LucideIcon; token: CorToken; texto: string; href: string }
  const alertas: Alerta[] = []
  if (qtdRepor > 0 && pode('Produtos'))
    alertas.push({ icon: AlertTriangle, token: 'err', texto: `${qtdRepor} produto(s) abaixo do mínimo para repor`, href: '/produto?vista=compras&repor=1' })
  if ((errosSync.count ?? 0) > 0 && isAdmin)
    alertas.push({ icon: AlertTriangle, token: 'err', texto: `${errosSync.count} erro(s) de sincronização nas últimas 24h`, href: '/sync-status' })
  if (syncAtraso && isAdmin)
    alertas.push({ icon: TrendingUp, token: 'warn', texto: 'Sincronização com Omie atrasada (mais de 24h)', href: '/sync-status' })
  if ((vencendo.count ?? 0) > 0)
    alertas.push({ icon: CalendarClock, token: 'warn', texto: `${vencendo.count} produto(s) vencem nos próximos 7 dias`, href: '/validade' })
  if ((invAbertos.count ?? 0) > 0 && pode('Inventarios - Ver'))
    alertas.push({ icon: ClipboardList, token: 'brand', texto: `${invAbertos.count} inventário(s) em contagem aguardando finalização`, href: '/inventario' })
  if ((transfAbertas.count ?? 0) > 0 && pode('Transferencias - Ver'))
    alertas.push({ icon: ArrowLeftRight, token: 'brand', texto: `${transfAbertas.count} transferência(s) em aberto`, href: '/transferencia' })

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
              <Link
                key={i}
                href={a.href}
                className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3 u-motion u-press hover:border-text/20 hover:shadow-[var(--shadow-sm)]"
              >
                <span className={`flex size-8 items-center justify-center rounded-md shrink-0 ${SELO_CLASSE[a.token]}`}>
                  <a.icon className="size-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 text-sm text-text">{a.texto}</span>
                <ArrowRight className="size-4 shrink-0 text-text-muted/40 u-motion group-hover:text-text-muted group-hover:translate-x-0.5" />
              </Link>
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

      {/* Últimas notas */}
      {pode('Notas Fiscais') && (
        <section>
          <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Últimas notas fiscais</h2>
            <Link href="/nota-fiscal" className="text-[13px] text-brand hover:underline">
              ver todas →
            </Link>
          </div>
          {ultimasNotas.data?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {ultimasNotas.data.map((nf) => (
                  <tr key={nf.id} className="border-b border-border last:border-0 u-motion hover:bg-surface-2/60">
                    <td className="py-3 pr-3 num text-text-muted w-24">{fmtData(nf.d_emissao_nfe)}</td>
                    <td className="py-3 pr-4 num font-medium text-text w-28">{nf.c_numero_nfe}</td>
                    <td className="py-3 pr-4 text-text/80 truncate max-w-0 w-full">
                      {nf.c_razao_social || nf.c_nome || '-'}
                    </td>
                    <td className="py-3 text-right num font-semibold text-text whitespace-nowrap">
                      <Money value={nf.n_valor_nfe} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={FileText} title="Nenhuma nota fiscal" hint="Sincronize com o Omie para ver as notas." />
          )}
        </section>
      )}
    </div>
  )
}
