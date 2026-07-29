import Link from 'next/link'
import { getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import {
  BarChart3, ShoppingCart, ArrowDownUp, DollarSign, Scale, Percent, ShieldCheck, CalendarCheck, ArrowUpRight, Boxes, ClipboardX, Factory,
} from 'lucide-react'

type Rel = {
  href: string
  titulo: string
  descricao: string
  icon: React.ElementType
  pergunta: string
}

const RELATORIOS: { grupo: string; itens: Rel[] }[] = [
  {
    grupo: 'Dia a dia',
    itens: [
      { href: '/resumo', titulo: 'Resumo do dia', icon: CalendarCheck, descricao: 'O que entrou, saiu e deu erro no dia, com auditoria de inventario.', pergunta: 'Como foi o estoque hoje?' },
      { href: '/relatorio-movimentacao', titulo: 'Movimentacao', icon: ArrowDownUp, descricao: 'Entradas e saidas por operacao, local e familia, com valores.', pergunta: 'O que mais movimentou e por que?' },
    ],
  },
  {
    grupo: 'Produção',
    itens: [
      { href: '/relatorio-producao', titulo: 'Dashboard de Produção', icon: Factory, descricao: 'OPs concluídas por dia/semana/mês, com quebra por quem concluiu.', pergunta: 'Quem produziu e quando?' },
    ],
  },
  {
    grupo: 'Compras e custo',
    itens: [
      { href: '/relatorio-compras', titulo: 'Compras', icon: ShoppingCart, descricao: 'Quanto e de quem voce compra; evolucao do preco dos insumos.', pergunta: 'Estou pagando mais caro?' },
      { href: '/relatorio-estoque-valorizado', titulo: 'Estoque valorizado', icon: Boxes, descricao: 'Valor do estoque por produto: saldo x CMC da ultima foto do Omie.', pergunta: 'Quanto vale o meu estoque?' },
      { href: '/relatorio-margem', titulo: 'Margem', icon: Percent, descricao: 'Margem por produto e familia, mais e menos rentaveis.', pergunta: 'O que da mais lucro?' },
    ],
  },
  {
    grupo: 'Faturamento',
    itens: [
      { href: '/relatorio-faturamento', titulo: 'Faturamento', icon: DollarSign, descricao: 'Faturamento por periodo, produto e familia.', pergunta: 'Quanto vendi?' },
      { href: '/relatorio-indicadores', titulo: 'Faturamento x Compras', icon: Scale, descricao: 'Cruza o que entrou de venda com o que saiu de compra.', pergunta: 'Estou comprando demais pro que vendo?' },
    ],
  },
  {
    grupo: 'Fiscal',
    itens: [
      { href: '/auditoria-fiscal', titulo: 'Auditoria fiscal', icon: ShieldCheck, descricao: 'Confere as notas fiscais contra o estoque e aponta divergencias.', pergunta: 'As notas batem com o estoque?' },
      { href: '/pendencias-classificacao', titulo: 'Pendencias de classificacao', icon: ClipboardX, descricao: 'Produtos sem familia/tipo e itens de NF sem cadastro, com o R$ que representam.', pergunta: 'O que falta classificar?' },
    ],
  },
]

export default async function RelatoriosPage() {
  if (!(await getAtorGestao()).podeGerir) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatorios"
        icon={BarChart3}
        description="Todos os relatorios num lugar so. Cada um responde uma pergunta do negocio."
      />

      {RELATORIOS.map((secao) => (
        <section key={secao.grupo}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{secao.grupo}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {secao.itens.map((r) => {
              const Icon = r.icon
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="group relative overflow-hidden rounded-xl border border-border bg-surface p-4 u-motion hover:border-brand/50"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <Icon className="size-[18px]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text group-hover:text-brand">{r.titulo}</span>
                        <ArrowUpRight className="ml-auto size-4 text-text-muted/30 group-hover:text-brand" />
                      </div>
                      <p className="mt-0.5 text-[13px] font-medium text-text-muted">{r.pergunta}</p>
                      <p className="mt-1 text-[12px] text-text-muted/80 leading-relaxed">{r.descricao}</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
