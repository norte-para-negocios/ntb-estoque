import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow, OrdemProducaoCard } from '@/components/ordem-producao/OrdemProducaoRow'
import { CriarOrdemProducao } from '@/components/ordem-producao/CriarOrdemProducao'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Paginacao } from '@/components/ui-kit/Paginacao'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { escapeIlike, escapeIlikeOr } from '@/lib/utils-busca'
import { btnClass } from '@/components/ui-kit/Button'
import { isOpConcluida, opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { Factory, Download } from 'lucide-react'

const POR_PAGINA = 50

// Converte a data normalizada do banco (YYYY-MM-DD) para DD/MM/AAAA. E uma data
// pura (sem hora), entao nao tem questao de fuso.
function fmtDataBR(d: string | null): string | null {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

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

  // Filtro de periodo: default no mes corrente quando o usuario nao informa.
  // Atende o pedido do cliente (abrir no mes atual) e reduz o volume da listagem.
  // OBS de produto: OPs sem identificacao_d_dt_previsao (sem data agendada) ficam
  // fora do filtro de periodo (gte/lte nao casam NULL). Confirmar com o Ramon se
  // precisa de um modo "sem data" para nao esconder pendentes nao agendadas.
  const hojeISO = hojeBahiaISO() // YYYY-MM-DD em America/Bahia
  const [anoAtual, mesAtual] = hojeISO.split('-').map(Number)
  const primeiroDiaMes = `${hojeISO.slice(0, 7)}-01`
  const ultimoDiaMes = `${hojeISO.slice(0, 7)}-${String(new Date(anoAtual, mesAtual, 0).getDate()).padStart(2, '0')}`
  const dataInicio = sp.data_inicio ?? primeiroDiaMes
  const dataFinal = sp.data_final ?? ultimoDiaMes

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

  type OPRow = {
    id: number
    num_ordem: string | null
    identificacao_c_num_op: string | null
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    identificacao_d_dt_previsao: string | null
    validade: string | null
    quantidade: number | null
    adicionais_d_dt_conclusao: string | null
    c_concluida: string | null // full_object->outrasInf->>cConcluida (achatado no select)
  }

  function baseQuery() {
    // c_concluida vem achatado do JSON (so o escalar), para nao trazer o
    // full_object inteiro de cada OP no filtro de conclusao. O desempate por id
    // garante janelas .range estaveis (updated_at nao e unico).
    let q = supabase
      .from('ordens_producao')
      .select(
        'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, validade, quantidade, adicionais_d_dt_conclusao, c_concluida:full_object->outrasInf->>cConcluida'
      )
      .eq('loja_id', lojaId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
    if (dataInicio) q = q.gte('identificacao_d_dt_previsao', dataInicio)
    if (dataFinal) q = q.lte('identificacao_d_dt_previsao', dataFinal)
    if (sp.ordem_producao) q = q.ilike('identificacao_c_num_op', `%${escapeIlike(sp.ordem_producao)}%`)
    if (codigosFiltro !== null) {
      q = q.in('identificacao_n_cod_produto', codigosFiltro.length ? codigosFiltro : [-1])
    }
    return q
  }

  let ordens: OPRow[]
  let temProxima: boolean
  if (filtraConclusao) {
    // Conclusao so da pra avaliar em memoria (deriva de c_concluida/adicionais,
    // nao filtravel no PostgREST). Pagina o conjunto completo em lote: sem isso a
    // query batia no teto de 1000 e o filtro operava sobre parte dos dados,
    // parecendo ignorado.
    const querConcluida = sp.op_concluido === 'S'
    const todas: OPRow[] = []
    const LOTE = 1000
    const MAX_LOTES = 60 // teto de seguranca (~60k OPs) para nao travar o SSR
    for (let off = 0, i = 0; i < MAX_LOTES; off += LOTE, i++) {
      const { data } = await baseQuery().range(off, off + LOTE - 1)
      const lote = (data ?? []) as OPRow[]
      if (!lote.length) break
      todas.push(...lote)
      if (lote.length < LOTE) break
    }
    const filtradas = todas.filter((o) => isOpConcluida(o) === querConcluida)
    temProxima = filtradas.length > page * POR_PAGINA
    ordens = filtradas.slice((page - 1) * POR_PAGINA, page * POR_PAGINA)
  } else {
    // .range busca POR_PAGINA+1 de proposito: a linha extra detecta a proxima pagina.
    const { data } = await baseQuery().range((page - 1) * POR_PAGINA, page * POR_PAGINA)
    const ordensRaw = (data ?? []) as OPRow[]
    temProxima = ordensRaw.length > POR_PAGINA
    ordens = temProxima ? ordensRaw.slice(0, POR_PAGINA) : ordensRaw
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
  // Usa o periodo efetivo (mes corrente por default) para o CSV bater com a tela.
  exportParams.set('data_inicio', dataInicio)
  exportParams.set('data_final', dataFinal)
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
                data_inicio: dataInicio,
                data_final: dataFinal,
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
            return {
              id: op.id,
              numOP: op.identificacao_c_num_op || op.num_ordem || '-',
              produto: formatarNomeProduto(prod?.descricao) || `Produto ${op.identificacao_n_cod_produto}`,
              unidade: prod?.unidade || 'UN',
              qtdOP: op.identificacao_n_qtde,
              validade: op.validade,
              quantidade: op.quantidade,
              // data real/agendada da OP (identificacao_d_dt_previsao), nao a de
              // inclusao, que na recorrencia vem como hoje (bug que o cliente viu).
              data: fmtDataBR(op.identificacao_d_dt_previsao),
              concluida: isOpConcluida(op),
              status: opStatus(op, hojeISO),
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
