import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow, OrdemProducaoCard } from '@/components/ordem-producao/OrdemProducaoRow'
import { CriarOrdemProducao } from '@/components/ordem-producao/CriarOrdemProducao'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { Factory, Download } from 'lucide-react'

const POR_PAGINA = 50

export default async function OrdemProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    ordem_producao?: string
    op_produto?: string
    tipo_produto?: string
    op_concluido?: string
    page?: string
  }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const supabase = await createClient()

  const sp = await searchParams
  const page = Math.max(1, Number(sp.page) || 1)

  // Filtro op_concluido em memoria: a unica fonte confiavel de conclusao e
  // full_object.outrasInf.cConcluida ('S'/'N'), alem do marcador local
  // adicionais_d_dt_conclusao gravado por finishOP. Como nao da pra filtrar
  // JSON aninhado no PostgREST, fazemos isso apos buscar. Por isso, quando o
  // filtro op_concluido esta ativo, buscamos sem range e paginamos em memoria.
  const filtraConclusao = sp.op_concluido === 'S' || sp.op_concluido === 'N'

  // Filtros op_produto / tipo_produto: as colunas produto_* em ordens_producao
  // sao 100% NULL. Cruzamos via a tabela produtos para obter os codigo_produto
  // e filtramos por identificacao_n_cod_produto (campo preenchido).
  let codigosFiltro: number[] | null = null
  if (sp.op_produto || sp.tipo_produto) {
    let prodQuery = supabase
      .from('produtos')
      .select('codigo_produto')
      .eq('loja_id', lojaId)
    if (sp.op_produto) {
      const termo = escapeIlikeOr(sp.op_produto)
      prodQuery = prodQuery.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
    }
    if (sp.tipo_produto) prodQuery = prodQuery.eq('tipo_item', sp.tipo_produto)
    const { data: prods } = await prodQuery
    codigosFiltro = [
      ...new Set((prods ?? []).map((p) => p.codigo_produto).filter((v): v is number => v != null)),
    ]
  }

  let query = supabase
    .from('ordens_producao')
    .select(
      'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, quantidade, adicionais_d_dt_conclusao, full_object'
    )
    .eq('loja_id', lojaId)
    .order('updated_at', { ascending: false })

  if (sp.data_inicio) query = query.gte('identificacao_d_dt_previsao', sp.data_inicio)
  if (sp.data_final) query = query.lte('identificacao_d_dt_previsao', sp.data_final)
  if (sp.ordem_producao) {
    query = query.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
  }
  if (codigosFiltro !== null) {
    query = query.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
  }

  if (!filtraConclusao) {
    query = query.range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  }

  const { data: ordensRaw } = await query

  function isConcluida(o: { adicionais_d_dt_conclusao?: string | null; full_object?: unknown }): boolean {
    if (o.adicionais_d_dt_conclusao) return true
    const fo = (o.full_object ?? {}) as { outrasInf?: { cConcluida?: string } }
    return fo.outrasInf?.cConcluida === 'S'
  }

  let ordens: typeof ordensRaw
  let temProxima: boolean
  if (filtraConclusao) {
    const querConcluida = sp.op_concluido === 'S'
    const filtradas = (ordensRaw ?? []).filter((o) => isConcluida(o) === querConcluida)
    temProxima = filtradas.length > page * POR_PAGINA
    ordens = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  } else {
    temProxima = (ordensRaw?.length ?? 0) > POR_PAGINA
    ordens = temProxima ? ordensRaw!.slice(0, POR_PAGINA) : ordensRaw
  }

  // Buscar descricoes dos produtos relacionados
  const codigos = [...new Set((ordens ?? []).map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  // Locais de estoque ativos da loja para o seletor de "Criar OP"
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao')

  const exportParams = new URLSearchParams()
  if (sp.data_inicio) exportParams.set('data_inicio', sp.data_inicio)
  if (sp.data_final) exportParams.set('data_final', sp.data_final)
  if (sp.ordem_producao) exportParams.set('ordem_producao', sp.ordem_producao)
  if (sp.op_produto) exportParams.set('op_produto', sp.op_produto)
  if (sp.tipo_produto) exportParams.set('tipo_produto', sp.tipo_produto)
  if (sp.op_concluido) exportParams.set('op_concluido', sp.op_concluido)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ordens de Produção"
        icon={Factory}
        actions={
          <>
            <FiltrosGaveta
              basePath="/ordem-producao"
              campos={[
                { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
                { tipo: 'data', nome: 'data_final', label: 'Data final' },
                { tipo: 'texto', nome: 'ordem_producao', label: 'Ordem de produção' },
                { tipo: 'texto', nome: 'op_produto', label: 'Produto (código ou descrição)' },
                { tipo: 'select', nome: 'tipo_produto', label: 'Tipo de produto', opcoes: PRODUTO_TIPO_ITEM },
                {
                  tipo: 'select',
                  nome: 'op_concluido',
                  label: 'Concluído',
                  opcoes: [
                    { value: 'S', label: 'Sim' },
                    { value: 'N', label: 'Não' },
                  ],
                },
              ]}
              defaults={{
                data_inicio: sp.data_inicio ?? '',
                data_final: sp.data_final ?? '',
                ordem_producao: sp.ordem_producao ?? '',
                op_produto: sp.op_produto ?? '',
                tipo_produto: sp.tipo_produto ?? '',
                op_concluido: sp.op_concluido ?? '',
              }}
            />
            <a
              href={`/ordem-producao/export?${exportParams.toString()}`}
              className={btnClass('outline')}
            >
              <Download className="size-4" /> Exportar
            </a>
            <SyncButton endpoint="/api/sync/ordens-producao" label="Atualizar agora" />
            <CriarOrdemProducao locais={locais ?? []} />
          </>
        }
      />

      {ordens?.length ? (
        (() => {
          const linhas = ordens.map((op) => {
            const prod = prodMap.get(op.identificacao_n_cod_produto)
            const fo = (op.full_object ?? {}) as { outrasInf?: { dInclusao?: string } }
            return {
              id: op.id,
              numOP: op.identificacao_c_num_op || op.num_ordem || '-',
              produto: prod?.descricao || `Produto ${op.identificacao_n_cod_produto}`,
              unidade: prod?.unidade || 'UN',
              qtdOP: op.identificacao_n_qtde,
              validade: op.validade,
              quantidade: op.quantidade,
              inclusao: fo.outrasInf?.dInclusao || null,
            }
          })
          return (
            <>
              {/* Desktop: tabela com steppers na linha */}
              <div className="hidden lg:block">
                <DataTable>
                  <thead>
                    <tr>
                      <th>OP</th>
                      <th>Produto</th>
                      <th className="text-right">Qtd OP</th>
                      <th>Validade</th>
                      <th>Quantidade</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((op) => (
                      <OrdemProducaoRow key={op.id} op={op} />
                    ))}
                  </tbody>
                </DataTable>
              </div>
              {/* Mobile: cards empilhados com steppers em bloco vertical */}
              <div className="space-y-3 lg:hidden">
                {linhas.map((op) => (
                  <OrdemProducaoCard key={op.id} op={op} />
                ))}
              </div>
            </>
          )
        })()
      ) : (
        <EmptyState
          icon={Factory}
          title="Nenhuma ordem de produção"
          hint="Sincronize com o Omie."
        />
      )}

      {(page > 1 || temProxima) && (
        <Paginacao basePath="/ordem-producao" page={page} temProxima={temProxima} />
      )}
    </div>
  )
}
