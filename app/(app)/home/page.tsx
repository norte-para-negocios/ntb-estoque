import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
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
import { Num } from '@/components/ui-kit/Num'
import { Money } from '@/components/ui-kit/Money'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'

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

  // Multi-tenant: nao-admin so pode ver dados de lojas que tem em loja_user.
  const isAdmin = profile.perfil === 'Admin'
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

  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const seteDias = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
  const desde24h = new Date(Date.now() - 24 * 3600000).toISOString()
  const head = { count: 'exact' as const, head: true }

  const [produtos, nfs, ops, invAbertos, vencendo, errosSync, loja, ultimasNotas, reporRes, transfAbertas] =
    await Promise.all([
      supabase.from('produtos').select('id', head).eq('loja_id', lojaId),
      supabase
        .from('notas_fiscais')
        .select('id', head)
        .eq('loja_id', lojaId)
        .gte('d_emissao_nfe', trintaDias)
        .is('deleted_at', null),
      supabase.from('ordens_producao').select('id', head).eq('loja_id', lojaId),
      supabase
        .from('inventarios')
        .select('id', head)
        .eq('loja_id', lojaId)
        .neq('status', 'Finalizado'),
      // Produtos (OPs) vencendo nos proximos 7 dias
      supabase
        .from('ordens_producao')
        .select('id', head)
        .eq('loja_id', lojaId)
        .not('validade', 'is', null)
        .lte('validade', seteDias),
      // Erros de sincronizacao da loja nas ultimas 24h
      supabase
        .from('integration_attempts')
        .select('id', head)
        .eq('loja_id', lojaId)
        .eq('error', true)
        .gte('created_at', desde24h),
      supabase.from('lojas').select('produto_ultima_atualizacao').eq('id', lojaId).single(),
      supabase
        .from('notas_fiscais')
        .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe')
        .eq('loja_id', lojaId)
        .is('deleted_at', null)
        .order('d_emissao_nfe', { ascending: false })
        .limit(5),
      // Produtos abaixo do minimo (a repor) — mesma RPC da tela de Compras.
      supabase.rpc('produtos_repor', { p_loja_id: lojaId }),
      // Transferencias ainda nao concluidas (em contagem/abertas).
      supabase.from('transferencias').select('id', head).eq('loja_id', lojaId).neq('status', 'Concluido'),
    ])

  // D1: produtos prestes a ruptura (abaixo do minimo). Lista os principais + ver todos.
  const codigosRepor = (reporRes.data ?? []) as number[]
  const qtdRepor = codigosRepor.length
  const { data: prodsRepor } = qtdRepor
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigosRepor.slice(0, 8))
        .order('descricao')
    : { data: [] }

  const ultimaSync = loja.data?.produto_ultima_atualizacao
    ? new Date(loja.data.produto_ultima_atualizacao).toLocaleTimeString('pt-BR', {
        timeZone: 'America/Bahia',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'nunca'

  const lojaNome = profile.loja?.nome_fantasia || profile.loja?.nome || ''

  // Fila "Precisa de atenção": só itens com contagem > 0.
  type Alerta = { icon: LucideIcon; token: CorToken; texto: string; href: string }
  const alertas: Alerta[] = []
  if (qtdRepor > 0)
    alertas.push({
      icon: AlertTriangle,
      token: 'err',
      texto: `${qtdRepor} produto(s) abaixo do mínimo para repor`,
      href: '/produto?vista=compras&repor=1',
    })
  if ((errosSync.count ?? 0) > 0)
    alertas.push({
      icon: AlertTriangle,
      token: 'err',
      texto: `${errosSync.count} erro(s) de sincronização nas últimas 24h`,
      href: '/sync-status',
    })
  if ((vencendo.count ?? 0) > 0)
    alertas.push({
      icon: CalendarClock,
      token: 'warn',
      texto: `${vencendo.count} produto(s) vencem nos próximos 7 dias`,
      href: '/validade?dias=7',
    })
  if ((invAbertos.count ?? 0) > 0)
    alertas.push({
      icon: ClipboardList,
      token: 'brand',
      texto: `${invAbertos.count} inventário(s) em contagem aguardando finalização`,
      href: '/inventario',
    })
  if ((transfAbertas.count ?? 0) > 0)
    alertas.push({
      icon: ArrowLeftRight,
      token: 'brand',
      texto: `${transfAbertas.count} transferência(s) em aberto`,
      href: '/transferencia',
    })

  // KPIs em faixa densa (produtos rebaixado de hero para um número entre os outros).
  const kpis = [
    { label: 'Produtos', value: produtos.count ?? 0, href: '/produto' },
    { label: 'Notas fiscais', value: nfs.count ?? 0, href: '/nota-fiscal' },
    { label: 'Ordens', value: ops.count ?? 0, href: '/ordem-producao' },
    { label: 'Inventários', value: invAbertos.count ?? 0, href: '/inventario' },
  ]

  const atalhos = [
    { label: 'Novo inventário', desc: 'Contagem de estoque', href: '/inventario', icon: ClipboardList },
    { label: 'Nova transferência', desc: 'Entre locais', href: '/transferencia', icon: ArrowLeftRight },
    { label: 'Etiquetas de NF', desc: 'Imprimir', href: '/nota-fiscal', icon: FileText },
  ]

  return (
    <div className="space-y-6">
      {/* Cabeçalho enxuto: loja + sync (sem hero gigante) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand" />
          <h1 className="text-base font-semibold text-text">{lojaNome || 'Painel'}</h1>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
          <TrendingUp className="size-3.5 text-brand" /> sync {ultimaSync}
        </span>
      </div>

      {/* Precisa de atenção — fila acionável, primeira coisa na tela */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text">Precisa de atenção</h2>
        {alertas.length ? (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <Link
                key={i}
                href={a.href}
                className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3 transition-all duration-200 hover:border-text/20 hover:shadow-[var(--shadow-sm)]"
                style={{ transitionTimingFunction: 'var(--ease)' }}
              >
                <span
                  className={`flex size-8 items-center justify-center rounded-md shrink-0 ${SELO_CLASSE[a.token]}`}
                >
                  <a.icon className="size-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 text-sm text-text">{a.texto}</span>
                <ArrowRight className="size-4 shrink-0 text-text-muted/40 transition-all group-hover:text-text-muted group-hover:translate-x-0.5" />
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

      {/* KPIs em faixa densa (divide-x, sem caixas separadas) */}
      <section className="grid grid-cols-4 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="group p-3 transition-colors hover:bg-surface-2/40 sm:p-4"
          >
            <p className="truncate text-[10px] font-medium text-text-muted sm:text-[11px]">{k.label}</p>
            <div className="num mt-1 text-xl font-semibold tracking-tight text-text sm:text-2xl">
              <Num value={k.value} />
            </div>
          </Link>
        ))}
      </section>

      {/* Atalhos */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text">Ações rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {atalhos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-4 transition-all duration-300 hover:bg-ink hover:border-ink"
              style={{ transitionTimingFunction: 'var(--ease)' }}
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white transition-colors shrink-0">
                <a.icon className="size-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text group-hover:text-white transition-colors">{a.label}</div>
                <div className="text-[11px] text-text-muted group-hover:text-white/50 transition-colors truncate">{a.desc}</div>
              </div>
              <ArrowRight className="size-4 text-text-muted/30 group-hover:text-brand group-hover:translate-x-1 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      </section>

      {/* Repor estoque — produtos abaixo do minimo (D1) */}
      {qtdRepor > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-text">Repor estoque</h2>
            <Link href="/produto?vista=compras&repor=1" className="text-[13px] text-brand hover:underline">
              ver todos ({qtdRepor}) →
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {(prodsRepor ?? []).map((p) => (
              <li key={p.codigo_produto} className="flex items-center gap-3 py-3">
                <span className="flex size-7 items-center justify-center rounded-md bg-err/10 text-err shrink-0">
                  <AlertTriangle className="size-3.5" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{formatarNomeProduto(p.descricao)}</span>
                <span className="num text-[12px] text-text-muted shrink-0">{p.codigo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Últimas notas */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-text">Últimas notas fiscais</h2>
          <Link href="/nota-fiscal" className="text-[13px] text-brand hover:underline">
            ver todas →
          </Link>
        </div>
        {ultimasNotas.data?.length ? (
          <table className="w-full text-sm">
            <tbody>
              {ultimasNotas.data.map((nf) => (
                <tr key={nf.id} className="border-b border-border last:border-0 hover:bg-surface-2/50 transition-colors">
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
    </div>
  )
}
