import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Zap, DollarSign, Wallet, Users, BarChart3, ShoppingBag, ShoppingCart, Clock, ArrowUpRight } from 'lucide-react'

type StatusBeta = 'planejado' | 'em-dev' | 'disponivel'

const MODULOS: {
  titulo: string
  descricao: string
  icon: React.ElementType
  status: StatusBeta
  href?: string
}[] = [
  {
    titulo: 'Faturamento Nativo',
    descricao: 'NFC-e do PDV sincronizada direto via API (sem upload manual). Visao por produto, familia e semana.',
    icon: DollarSign,
    status: 'planejado',
  },
  {
    titulo: 'Financeiro',
    descricao: 'Contas a pagar e receber sincronizadas do Omie: atrasados, a vencer, totais por loja.',
    icon: Wallet,
    status: 'disponivel',
    href: '/beta/financeiro',
  },
  {
    titulo: 'CRM',
    descricao: 'Clientes e fornecedores com historico de NFs, ultimos precos e contas abertas.',
    icon: Users,
    status: 'disponivel',
    href: '/beta/crm',
  },
  {
    titulo: 'Compras',
    descricao: 'Ranking de fornecedores por valor e evolucao de precos dos insumos (ultimo x menor x medio).',
    icon: ShoppingCart,
    status: 'disponivel',
    href: '/beta/compras',
  },
  {
    titulo: 'Relatorios Avancados',
    descricao: 'DRE, estoque valorizado, margem por produto. Todos com export Excel.',
    icon: BarChart3,
    status: 'planejado',
  },
  {
    titulo: 'Pedidos e Producao',
    descricao: 'Gerar pedido de compra no Omie a partir da sugestao. Pedidos de venda e progresso de OPs.',
    icon: ShoppingBag,
    status: 'planejado',
  },
]

const STATUS_LABEL: Record<StatusBeta, string> = {
  planejado: 'Planejado',
  'em-dev': 'Em desenvolvimento',
  disponivel: 'Disponivel',
}

const STATUS_COR: Record<StatusBeta, string> = {
  planejado: 'bg-surface-2 text-text-muted border-border',
  'em-dev': 'bg-warn/10 text-warn border-warn/30',
  disponivel: 'bg-ok/10 text-ok border-ok/30',
}

export default function BetaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="VTBstock Beta"
        icon={Zap}
        description="Modulos experimentais: copia do Omie, financeiro, CRM e mais. So super admins tem acesso."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULOS.map((m) => {
          const Icon = m.icon
          const corClasse = STATUS_COR[m.status]
          const card = (
            <div className={`group relative overflow-hidden rounded-xl border bg-surface p-5 u-motion ${m.href ? 'border-brand/30 hover:border-brand/60 cursor-pointer' : 'border-border'}`}>
              <div className="flex items-start gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand shrink-0 mt-0.5">
                  <Icon className="size-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text">{m.titulo}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${corClasse}`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                    {m.href && <ArrowUpRight className="ml-auto size-4 text-text-muted/30 group-hover:text-text-muted" />}
                  </div>
                  <p className="mt-1.5 text-[12px] text-text-muted leading-relaxed">{m.descricao}</p>
                </div>
              </div>
            </div>
          )
          return m.href ? <Link key={m.titulo} href={m.href}>{card}</Link> : card
        })}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-4 py-3 text-[12px] text-text-muted">
        <Clock className="size-3.5 shrink-0" />
        Os modulos serao liberados conforme o desenvolvimento avanca. Acesso automatico assim que estiverem disponiveis.
      </div>
    </div>
  )
}
