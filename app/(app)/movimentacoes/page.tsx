import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { buscarFamilias } from '@/lib/actions/produto'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ArrowLeftRight } from 'lucide-react'
import { HistoricoTab } from '@/components/movimentacoes/HistoricoTab'
import { MovimentosTab } from '@/components/movimentacoes/MovimentosTab'

export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    produto?: string
    familia?: string
    tipo?: string
    modo?: string
    mov?: string
    page?: string
    aba?: string
    local?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()

  const sp = await searchParams
  const aba = sp.aba === 'movimentos' ? 'movimentos' : 'historico'

  // FiltrosGaveta só aparece no Histórico
  let campos: CampoFiltro[] = []
  if (aba === 'historico') {
    const supabase = await createClient()
    const [familias, { data: locaisRaw }] = await Promise.all([
      buscarFamilias(),
      supabase
        .from('local_estoques')
        .select('codigo_local_estoque, descricao')
        .eq('loja_id', lojaId)
        .order('descricao'),
    ])
    campos = [
      { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
      { tipo: 'data', nome: 'data_final', label: 'Data final' },
      { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
      { tipo: 'multi-select', nome: 'tipo', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
      { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f.descricao, label: f.descricao })) },
      {
        tipo: 'multi-select',
        nome: 'local',
        label: 'Local de estoque (produtos com estoque no local)',
        opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
      },
    ]
  }

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Movimentações"
          icon={ArrowLeftRight}
          description="Histórico de entradas e saídas por produto (2026)"
          actions={
            aba === 'historico' ? (
              <FiltrosGaveta
                basePath="/movimentacoes"
                campos={campos}
                defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', tipo: sp.tipo ?? '', familia: sp.familia ?? '', local: sp.local ?? '' }}
                naoContar={['data_inicio', 'data_final']}
                persistirEm="/movimentacoes"
              />
            ) : undefined
          }
        />
        {aba === 'historico' && (
          <ChipsFiltrosAtivos
            basePath="/movimentacoes"
            campos={campos}
            naoMostrar={['data_inicio', 'data_final']}
            persistirEm="/movimentacoes"
          />
        )}
      </ListaHeader>

      <SegmentLinks
        basePath="/movimentacoes"
        param="aba"
        opcoes={[
          { value: '', label: 'Histórico' },
          { value: 'movimentos', label: 'Movimentos' },
        ]}
      />

      {aba === 'historico'
        ? <HistoricoTab sp={sp} lojaId={lojaId} />
        : <MovimentosTab sp={sp} lojaId={lojaId} />
      }
    </div>
  )
}
