import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Package, FileText, ClipboardList, Factory, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default async function HomePage() {
  const profile = await getProfile()

  if (!profile.current_loja_id) {
    return (
      <div className="space-y-6">
        <PageHeader title={`Ola, ${profile.name.split(' ')[0]}`} />
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <p className="text-muted-foreground">
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
    { label: 'Produtos', value: produtos.count ?? 0, icon: Package, href: '/produto', hint: 'cadastrados' },
    { label: 'Notas Fiscais', value: nfs.count ?? 0, icon: FileText, href: '/nota-fiscal', hint: 'ultimos 30 dias' },
    { label: 'Ordens de Producao', value: opsAbertas.count ?? 0, icon: Factory, href: '/ordem-producao', hint: 'no total' },
    { label: 'Inventarios abertos', value: invAbertos.count ?? 0, icon: ClipboardList, href: '/inventario', hint: 'em contagem' },
  ]

  const ultimaSync = loja.data?.produto_ultima_atualizacao
    ? new Date(loja.data.produto_ultima_atualizacao).toLocaleString('pt-BR')
    : 'nunca'

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Ola, ${profile.name.split(' ')[0]}`}
        description={`${profile.loja?.nome_fantasia || profile.loja?.nome} · ultima sincronizacao ${ultimaSync}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="group rounded-xl border bg-card p-5 transition-all hover:border-brand/40 hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-between">
              <m.icon className="size-5 text-muted-foreground group-hover:text-brand transition-colors" strokeWidth={2} />
              <ArrowRight className="size-4 text-transparent group-hover:text-muted-foreground transition-colors" />
            </div>
            <div className="mt-4 tabular text-3xl font-semibold tracking-tight">{m.value.toLocaleString('pt-BR')}</div>
            <div className="mt-1 text-sm font-medium">{m.label}</div>
            <div className="text-xs text-muted-foreground">{m.hint}</div>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <div className="px-5 py-3">
          <span className="eyebrow">Acoes rapidas</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
          {[
            { label: 'Nova contagem de inventario', href: '/inventario' },
            { label: 'Nova transferencia', href: '/transferencia' },
            { label: 'Imprimir etiquetas de NF', href: '/nota-fiscal' },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center justify-between px-5 py-4 text-sm hover:bg-muted/50 transition-colors"
            >
              {a.label}
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
