import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CookingPot, Factory, Layers } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista, type Coluna } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Indicador, fmtBRL, fmtQtd } from '@/components/estoque-proprio/Apresentacao'
import { ProduzirLote } from '@/components/ficha-tecnica/ProduzirLote'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { carregarBase } from '../ficha-tecnica/dados'

type OrdemRow = { id: number; codigo_produto: number; quantidade: number; custo_total: number; custo_unitario: number; user_id: string | null; obs: string | null; created_at: string }

export default async function ProducaoPropriaPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()
  const podeProduzir = await requirePermissao(lojaId, 'Ordens de Producao - Criar')

  const { supabase, produtos, cmc, fichas } = await carregarBase(lojaId)
  const [locaisRes, saldos, ordensRes] = await Promise.all([
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo, padrao').eq('loja_id', lojaId).order('descricao'),
    buscarTodasLinhas<{ codigo_local_estoque: number; codigo_produto: number; saldo: number }>((from, to) =>
      supabase.from('estoque_saldos').select('codigo_local_estoque, codigo_produto, saldo').eq('loja_id', lojaId)
        .order('codigo_produto').order('codigo_local_estoque').range(from, to)),
    supabase.from('ordens_producao_proprio').select('id, codigo_produto, quantidade, custo_total, custo_unitario, user_id, obs, created_at')
      .eq('loja_id', lojaId).order('id', { ascending: false }).limit(30),
  ])
  const locais = ((locaisRes.data ?? []) as { codigo_local_estoque: number; descricao: string | null; inativo: string | null; padrao: string | null }[])
    .filter((l) => l.inativo !== 'S')
    .map((l) => ({ codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? 'Local', padrao: l.padrao === 'S' }))
  const porCodigo = new Map(produtos.map((p) => [p.codigoProduto, p]))
  const ordens = (ordensRes.data ?? []) as OrdemRow[]

  const produziveis = [...fichas.values()]
    .map((f) => ({ f, p: porCodigo.get(f.codigoProduto) }))
    .filter((x): x is { f: typeof x.f; p: NonNullable<typeof x.p> } => !!x.p)
    .sort((a, b) => a.p.descricao.localeCompare(b.p.descricao, 'pt-BR'))

  const hoje = new Date().toDateString()
  const lotesHoje = ordens.filter((o) => new Date(o.created_at).toDateString() === hoje).length

  const colunas: Coluna<OrdemRow>[] = [
    {
      label: 'Produto', primaria: true, flexivel: true,
      render: (o) => {
        const p = porCodigo.get(Number(o.codigo_produto))
        return (
          <Link href={`/ficha-tecnica/${o.codigo_produto}`} className="block min-w-0">
            <span className="block truncate font-medium text-text hover:underline">{p?.descricao ?? o.codigo_produto}</span>
            <span className="text-[12px] text-text-muted">{new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{o.obs ? ` · ${o.obs}` : ''}</span>
          </Link>
        )
      },
    },
    { label: 'Produzido', alinhar: 'right', render: (o) => <span className="num">{fmtQtd(Number(o.quantidade))} <span className="text-[12px] text-text-muted">{porCodigo.get(Number(o.codigo_produto))?.unidade ?? ''}</span></span> },
    { label: 'Custo do lote', alinhar: 'right', render: (o) => <span className="num">{fmtBRL(Number(o.custo_total))}</span> },
    { label: 'Custo por unidade', alinhar: 'right', ocultarMobile: true, render: (o) => <span className="num">{fmtBRL(Number(o.custo_unitario))}</span> },
  ]

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Produção" description="Produza molhos, caldas e preparos: consome os insumos e entrega o produto pronto no estoque." />
      </ListaHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Indicador icon={Layers} rotulo="Receitas para produzir" valor={String(produziveis.length)} dica="fichas ativas" />
        <Indicador icon={Factory} rotulo="Lotes hoje" valor={String(lotesHoje)} />
        <Indicador icon={CookingPot} rotulo="Últimos lotes" valor={String(ordens.length)} dica="mostrando até 30" />
      </div>

      {podeProduzir && (
        <ProduzirLote
          produtos={produziveis.map(({ f, p }) => ({
            codigoProduto: p.codigoProduto, descricao: p.descricao, codigo: p.codigo, unidade: p.unidade,
            ficha: { codigoProduto: f.codigoProduto, rendimento: f.rendimento, expandirNaVenda: f.expandirNaVenda, itens: f.itens },
          }))}
          fichas={[...fichas.values()].map(({ codigoProduto, rendimento, expandirNaVenda, itens }) => ({ codigoProduto, rendimento, expandirNaVenda, itens }))}
          cmc={[...cmc.entries()]}
          nomes={produtos.map((p) => ({ codigoProduto: p.codigoProduto, descricao: p.descricao, unidade: p.unidade }))}
          saldos={saldos.map((s) => ({ local: Number(s.codigo_local_estoque), produto: Number(s.codigo_produto), saldo: Number(s.saldo) }))}
          locais={locais}
        />
      )}

      <Lista
        colunas={colunas}
        linhas={ordens}
        chaveLinha={(o) => o.id}
        vazio={<EmptyState icon={Factory} title="Nenhum lote produzido ainda" hint="Crie a ficha de um preparo em Fichas técnicas e produza o primeiro lote aqui." />}
      />
    </div>
  )
}
