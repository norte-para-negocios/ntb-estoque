import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  Package,
  FileText,
  ClipboardList,
  Factory,
  ArrowRight,
  Plus,
  ArrowLeftRight,
} from 'lucide-react'
import Link from 'next/link'

const ACCENT_COLORS = ['#2eb5c3', '#5b8def', '#a78bfa', '#f59e0b']

export default async function HomePage() {
  const profile = await getProfile()

  if (!profile.current_loja_id) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="size-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Package className="size-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-muted-foreground">
            Selecione uma loja no menu lateral para ver o painel.
          </p>
        </div>
      </div>
    )
  }

  const lojaId = profile.current_loja_id
  const supabase = await createClient()

  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const head = { count: 'exact' as const, head: true }

  const [produtos, nfs, opsAbertas, invAbertos, loja] = await Promise.all([
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
    supabase
      .from('lojas')
      .select('produto_ultima_atualizacao')
      .eq('id', lojaId)
      .single(),
  ])

  const metrics = [
    {
      label: 'Produtos',
      value: produtos.count ?? 0,
      icon: Package,
      href: '/produto',
      hint: 'cadastrados',
      color: ACCENT_COLORS[0],
    },
    {
      label: 'Notas Fiscais',
      value: nfs.count ?? 0,
      icon: FileText,
      href: '/nota-fiscal',
      hint: 'últimos 30 dias',
      color: ACCENT_COLORS[1],
    },
    {
      label: 'Ordens de Produção',
      value: opsAbertas.count ?? 0,
      icon: Factory,
      href: '/ordem-producao',
      hint: 'no total',
      color: ACCENT_COLORS[2],
    },
    {
      label: 'Inventários abertos',
      value: invAbertos.count ?? 0,
      icon: ClipboardList,
      href: '/inventario',
      hint: 'em contagem',
      color: ACCENT_COLORS[3],
    },
  ]

  const ultimaSync = loja.data?.produto_ultima_atualizacao
    ? new Date(loja.data.produto_ultima_atualizacao).toLocaleString('pt-BR')
    : 'nunca'

  const nome = profile.name.split(' ')[0]
  const lojaNome = profile.loja?.nome_fantasia || profile.loja?.nome || ''

  const quickActions = [
    {
      label: 'Novo inventário',
      desc: 'Contagem de estoque',
      href: '/inventario',
      icon: ClipboardList,
    },
    {
      label: 'Nova transferência',
      desc: 'Entre locais de estoque',
      href: '/transferencia',
      icon: ArrowLeftRight,
    },
    {
      label: 'Etiquetas de NF',
      desc: 'Imprimir por nota fiscal',
      href: '/nota-fiscal',
      icon: FileText,
    },
  ]

  return (
    <div className="space-y-8">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {nome}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="text-foreground/70">{lojaNome}</span>
            <span className="mx-2 opacity-20">·</span>
            <span>sync {ultimaSync}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand animate-pulse" />
          ao vivo
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-card p-5 transition-all hover:border-white/[0.13] hover:bg-white/[0.02]"
          >
            {/* Linha de acento no topo */}
            <div
              className="absolute inset-x-0 top-0 h-[2px] opacity-60 group-hover:opacity-100 transition-opacity"
              style={{ background: m.color }}
            />

            <div className="flex items-center justify-between">
              <div
                className="size-8 rounded-lg flex items-center justify-center"
                style={{ background: `${m.color}18` }}
              >
                <m.icon className="size-4" style={{ color: m.color }} strokeWidth={2} />
              </div>
              <ArrowRight
                className="size-4 text-white/10 transition-all group-hover:text-white/40 group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </div>

            <div className="mt-5 font-mono text-[2.25rem] font-semibold leading-none tracking-tight tabular-nums">
              {m.value.toLocaleString('pt-BR')}
            </div>
            <div className="mt-2 text-sm font-medium text-foreground/80">{m.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{m.hint}</div>
          </Link>
        ))}
      </div>

      {/* Ações rápidas */}
      <div>
        <p className="eyebrow mb-3">Ações rápidas</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quickActions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-4 rounded-xl border border-white/[0.07] bg-card px-5 py-4 transition-all hover:border-white/[0.13] hover:bg-white/[0.02]"
            >
              <div className="size-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                <a.icon className="size-4 text-brand" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground/90">{a.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">{a.desc}</div>
              </div>
              <Plus
                className="size-4 text-white/15 transition-all group-hover:text-brand group-hover:rotate-90 shrink-0"
                strokeWidth={2}
              />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
