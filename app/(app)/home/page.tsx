import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import {
  Package,
  FileText,
  ClipboardList,
  Factory,
  ArrowLeftRight,
  ArrowRight,
} from 'lucide-react'
import { StatCard } from '@/components/ui-kit/StatCard'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'

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

  const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const head = { count: 'exact' as const, head: true }

  const [produtos, nfs, ops, invAbertos, loja, ultimasNotas] = await Promise.all([
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
    supabase.from('lojas').select('produto_ultima_atualizacao').eq('id', lojaId).single(),
    supabase
      .from('notas_fiscais')
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe')
      .eq('loja_id', lojaId)
      .is('deleted_at', null)
      .order('d_emissao_nfe', { ascending: false })
      .limit(5),
  ])

  const metrics = [
    { label: 'Produtos', value: produtos.count ?? 0, icon: Package, href: '/produto', hint: 'cadastrados', accent: '#2eb5c3' },
    { label: 'Notas Fiscais', value: nfs.count ?? 0, icon: FileText, href: '/nota-fiscal', hint: 'últimos 30 dias', accent: '#3b82f6' },
    { label: 'Ordens de Produção', value: ops.count ?? 0, icon: Factory, href: '/ordem-producao', hint: 'no total', accent: '#a78bfa' },
    { label: 'Inventários abertos', value: invAbertos.count ?? 0, icon: ClipboardList, href: '/inventario', hint: 'em contagem', accent: '#f59e0b' },
  ]

  const ultimaSync = loja.data?.produto_ultima_atualizacao
    ? new Date(loja.data.produto_ultima_atualizacao).toLocaleString('pt-BR')
    : 'nunca'

  const nome = profile.name.split(' ')[0]
  const lojaNome = profile.loja?.nome_fantasia || profile.loja?.nome || ''

  const atalhos = [
    { label: 'Novo inventário', desc: 'Contagem de estoque', href: '/inventario', icon: ClipboardList },
    { label: 'Nova transferência', desc: 'Entre locais de estoque', href: '/transferencia', icon: ArrowLeftRight },
    { label: 'Etiquetas de NF', desc: 'Imprimir por nota fiscal', href: '/nota-fiscal', icon: FileText },
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Olá, {nome}</h1>
          <p className="mt-1 text-sm text-text-muted">
            <span className="text-text/80">{lojaNome}</span>
            <span className="mx-2 opacity-30">·</span>
            <span>sync {ultimaSync}</span>
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-muted">
          <span className="size-1.5 rounded-full bg-brand animate-pulse" />
          ao vivo
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <StatCard key={m.label} {...m} />
        ))}
      </div>

      <div>
        <p className="eyebrow mb-3">Atalhos</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {atalhos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 transition-all duration-200 hover:shadow-[var(--shadow-md)]"
              style={{ transitionTimingFunction: 'var(--ease)' }}
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-brand-soft text-brand shrink-0">
                <a.icon className="size-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text">{a.label}</div>
                <div className="truncate text-[11px] text-text-muted">{a.desc}</div>
              </div>
              <ArrowRight className="size-4 text-text-muted/30 transition-all group-hover:text-brand group-hover:translate-x-0.5 shrink-0" />
            </Link>
          ))}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Últimas notas fiscais</p>
        {ultimasNotas.data?.length ? (
          <DataTable>
            <thead>
              <tr>
                <th>Emissão</th>
                <th>NFe</th>
                <th>Fornecedor</th>
                <th className="text-right">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ultimasNotas.data.map((nf) => (
                <tr key={nf.id}>
                  <td className="num text-text-muted">{fmtData(nf.d_emissao_nfe)}</td>
                  <td className="num">{nf.c_numero_nfe}</td>
                  <td className="max-w-xs truncate">{nf.c_razao_social || nf.c_nome || '-'}</td>
                  <td className="text-right">
                    <Money value={nf.n_valor_nfe} />
                  </td>
                  <td className="text-right">
                    <Link href={`/nota-fiscal/${nf.id}`} className="text-brand hover:underline whitespace-nowrap">
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState icon={FileText} title="Nenhuma nota fiscal" hint="Sincronize com o Omie para ver as notas." />
        )}
      </div>
    </div>
  )
}
