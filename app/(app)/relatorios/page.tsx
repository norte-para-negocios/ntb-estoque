import Link from 'next/link'
import { getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { getCurrentLojaId } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import {
  TrendingUp, BarChart3, ShoppingCart, ArrowDownUp, DollarSign, Scale, Percent, ShieldCheck, CalendarCheck, ArrowUpRight, Boxes, ClipboardX, Factory, FileBarChart, Target,
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
    grupo: 'Gerencial',
    itens: [
      { href: '/relatorio-mensal', titulo: 'Relatório mensal (PowerPoint)', icon: FileBarChart, descricao: 'Faturamento, vendas, família/fornecedores, compras/perdas e baixas de estoque num único PPTX -- mesmo formato já enviado pra consultoria.', pergunta: 'Como foi o mês, pronto pra mandar pro cliente?' },
    ],
  },
  {
    grupo: 'Dia a dia',
    itens: [
      { href: '/resumo', titulo: 'Resumo do dia', icon: CalendarCheck, descricao: 'O que entrou, saiu e deu erro no dia, com auditoria de inventário.', pergunta: 'Como foi o estoque hoje?' },
      { href: '/relatorio-movimentacao', titulo: 'Movimentação', icon: ArrowDownUp, descricao: 'Entradas e saídas por operação, local e família, com valores.', pergunta: 'O que mais movimentou e por quê?' },
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
      { href: '/relatorio-compras', titulo: 'Compras', icon: ShoppingCart, descricao: 'Quanto e de quem você compra; evolução do preço dos insumos.', pergunta: 'Estou pagando mais caro?' },
      { href: '/relatorio-estoque-valorizado', titulo: 'Estoque valorizado', icon: Boxes, descricao: 'Valor do estoque por produto: saldo x CMC da última foto do Omie.', pergunta: 'Quanto vale o meu estoque?' },
      { href: '/relatorio-margem', titulo: 'Margem', icon: Percent, descricao: 'Margem por produto e família, mais e menos rentáveis.', pergunta: 'O que dá mais lucro?' },
    ],
  },
  {
    grupo: 'Faturamento',
    itens: [
      { href: '/relatorio-faturamento', titulo: 'Faturamento', icon: DollarSign, descricao: 'Faturamento por período, produto e família.', pergunta: 'Quanto vendi?' },
      { href: '/relatorio-indicadores', titulo: 'Faturamento x Compras', icon: Scale, descricao: 'Cruza o que entrou de venda com o que saiu de compra.', pergunta: 'Estou comprando demais pro que vendo?' },
      { href: '/relatorio-meta', titulo: 'Meta de faturamento', icon: Target, descricao: 'Defina a meta diária e compare com o faturamento de cada dia, semana ou mês.', pergunta: 'Bati a meta?' },
    ],
  },
  {
    grupo: 'Fiscal',
    itens: [
      { href: '/auditoria-fiscal', titulo: 'Auditoria fiscal', icon: ShieldCheck, descricao: 'Confere as notas fiscais contra o estoque e aponta divergências.', pergunta: 'As notas batem com o estoque?' },
      { href: '/pendencias-classificacao', titulo: 'Pendências de classificação', icon: ClipboardX, descricao: 'Produtos sem família/tipo e itens de NF sem cadastro, com o R$ que representam.', pergunta: 'O que falta classificar?' },
    ],
  },
]

export default async function RelatoriosPage() {
  if (!(await getAtorGestao()).podeGerir) notFound()
  // Lojas com estoque proprio ganham o relatorio de Lucro (faturamento menos o custo real de cada baixa).
  const proprio = (await modoDaLoja(await getCurrentLojaId())) === 'proprio'
  const semOmie = (sec: (typeof RELATORIOS)[number]) =>
    proprio ? { ...sec, itens: sec.itens.map((i) => (i.href === '/relatorio-estoque-valorizado' ? { ...i, descricao: 'Valor do estoque por produto: saldo x custo médio de hoje.' } : i)) } : sec
  const secoes = RELATORIOS.map(semOmie).map((sec) =>
    proprio && sec.grupo === 'Faturamento'
      ? { ...sec, itens: [{ href: '/relatorio-lucro', titulo: 'Lucro', icon: TrendingUp, descricao: 'Faturamento menos o custo das mercadorias vendidas, por produto, família, tipo, dia ou mês.', pergunta: 'Quanto sobrou de cada venda?' }, ...sec.itens] }
      : sec
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        icon={BarChart3}
        description="Todos os relatórios num lugar só. Cada um responde uma pergunta do negócio."
      />

      {secoes.map((secao) => (
        <section key={secao.grupo}>
          <h2 className="mb-2 text-[13px] font-semibold text-text-muted">{secao.grupo}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {secao.itens.map((r) => {
              const Icon = r.icon
              return (
                <Link
                  key={r.href}
                  href={r.href}
                  className="group relative overflow-hidden rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4 u-motion hover:shadow-[var(--shadow-md)]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
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
