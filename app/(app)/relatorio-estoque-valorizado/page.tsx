import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { buscarFamilias } from '@/lib/actions/produto'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { Boxes } from 'lucide-react'

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))

function fmtMoeda(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtNum(n: number, dec = 3) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtData(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}
function fmtMargem(n: number | null) {
  if (n == null) return '-'
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

type Linha = {
  codigo_produto: number
  codigo: string | null
  descricao: string | null
  descricao_familia: string | null
  tipo_item: string | null
  unidade: string | null
  n_saldo: number
  n_cmc: number
  n_preco_unitario: number | null
  margem_pct: number | null
  valor_total: number
  data_foto: string
}

const LIMITE = 500

export default async function RelatorioEstoqueValorizadoPage({
  searchParams,
}: {
  searchParams: Promise<{ familia?: string; tipo?: string; local?: string; busca?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const familias = valoresMulti(sp.familia)
  const tipos = valoresMulti(sp.tipo)
  const locais = valoresMulti(sp.local).map(Number).filter((n) => !Number.isNaN(n))
  const busca = sp.busca?.trim() || null

  const supabase = await createClient()

  const [linhasTodas, familiasOpcoes, locaisOpcoes] = await Promise.all([
    // rpcTodos ao inves de .rpc() direto: o PostgREST corta em 1000 linhas por
    // padrao, sem erro -- lojas com catalogo grande tinham o "Total valorizado"
    // subcontado (so somava as linhas que vinham na 1a pagina), mesma classe de
    // bug ja achada e corrigida no Faturamento nesta sessao.
    rpcTodos<Linha>(supabase, 'relatorio_estoque_valorizado', {
      p_loja_id: lojaId,
      p_familia: familias.length ? familias : null,
      p_tipo: tipos.length ? tipos : null,
      p_local: locais.length ? locais : null,
      p_busca: busca,
    }),
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .neq('inativo', 'S')
      .order('descricao'),
  ])

  const dataFoto = linhasTodas[0]?.data_foto ?? null
  const totalValor = linhasTodas.reduce((s, l) => s + Number(l.valor_total), 0)
  const totalProdutos = linhasTodas.length
  // Tabela continua mostrando só os 500 de maior valor (RPC já ordena por
  // valor_total desc) -- só o total/contagem dos cards precisava ser exato.
  const linhas = linhasTodas.slice(0, LIMITE)

  const campos: CampoFiltro[] = [
    {
      tipo: 'texto',
      nome: 'busca',
      label: 'Produto (nome ou codigo)',
    },
    {
      tipo: 'multi-select',
      nome: 'tipo',
      label: 'Tipo de mercadoria',
      opcoes: PRODUTO_TIPO_ITEM,
    },
    {
      tipo: 'multi-select',
      nome: 'familia',
      label: 'Familia',
      opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })),
    },
    {
      tipo: 'multi-select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisOpcoes.data ?? []).map((l) => ({
        value: String(l.codigo_local_estoque),
        label: l.descricao ?? String(l.codigo_local_estoque),
      })),
    },
  ]

  const th = 'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Estoque Valorizado"
          icon={Boxes}
          description="Valor do estoque atual: saldo x CMC da ultima foto do Omie."
          voltarHref="/relatorios"
          actions={
            <FiltrosGaveta
              basePath="/relatorio-estoque-valorizado"
              campos={campos}
              defaults={{
                busca: sp.busca ?? '',
                tipo: sp.tipo ?? '',
                familia: sp.familia ?? '',
                local: sp.local ?? '',
              }}
              persistirEm="/relatorio-estoque-valorizado"
            />
          }
        />
        <ChipsFiltrosAtivos
          basePath="/relatorio-estoque-valorizado"
          campos={campos}
          persistirEm="/relatorio-estoque-valorizado"
        />
      </ListaHeader>

      {/* Cards de resumo */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total valorizado</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{fmtMoeda(totalValor)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produtos no estoque</p>
          <p className="num mt-0.5 text-xl font-semibold text-text">{totalProdutos}</p>
        </div>
        {dataFoto && (
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Foto do estoque</p>
            <p className="mt-0.5 text-sm font-semibold text-text">{fmtData(dataFoto)}</p>
          </div>
        )}
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Sem dados de posicao"
          hint="Aguarde a sincronizacao de posicao de estoques ou ajuste o filtro."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2">
                <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Produto</th>
                <th className={`text-left ${th} hidden md:table-cell`}>Familia</th>
                <th className={`text-left ${th} hidden lg:table-cell`}>Tipo</th>
                <th className={`text-right ${th}`}>Saldo</th>
                <th className={`text-right ${th} hidden sm:table-cell`}>CMC</th>
                <th className={`text-right ${th} hidden 2xl:table-cell`}>PDV</th>
                <th className={`text-right ${th} hidden 2xl:table-cell`}>Margem</th>
                <th className={`text-right ${th}`}>Valor total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.codigo_produto} className="border-t border-border/60 hover:bg-surface-2/40">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <Link
                      href={`/relatorio-movimentacao?produto=${encodeURIComponent(l.codigo ?? l.descricao ?? '')}`}
                      className="block max-w-[220px] hover:underline"
                      title="Ver movimentações deste produto"
                    >
                      <div className="truncate text-text" title={l.descricao ?? ''}>
                        {formatarNomeProduto(l.descricao ?? '')}
                      </div>
                      {l.codigo && (
                        <div className="num text-[11px] text-text-muted">{l.codigo}</div>
                      )}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2 text-text-muted md:table-cell">
                    {l.descricao_familia ?? '-'}
                  </td>
                  <td className="hidden px-3 py-2 text-[12px] text-text-muted lg:table-cell">
                    {TIPO_LABEL.get(l.tipo_item ?? '') ?? l.tipo_item ?? '-'}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">
                    {fmtNum(Number(l.n_saldo), 3)} {l.unidade ?? ''}
                  </td>
                  <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted sm:table-cell">
                    {fmtMoeda(Number(l.n_cmc))}
                  </td>
                  <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted 2xl:table-cell">
                    {l.n_preco_unitario ? fmtMoeda(Number(l.n_preco_unitario)) : '-'}
                  </td>
                  <td className="num hidden whitespace-nowrap px-3 py-2 text-right 2xl:table-cell">
                    <span
                      className={
                        l.margem_pct != null && l.margem_pct < 0
                          ? 'text-err'
                          : l.margem_pct != null && l.margem_pct >= 30
                          ? 'text-ok'
                          : 'text-text-muted'
                      }
                    >
                      {fmtMargem(l.margem_pct)}
                    </span>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">
                    {fmtMoeda(Number(l.valor_total))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-2/70 font-semibold">
                <td className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-text">
                  {totalProdutos} produto(s)
                </td>
                <td className="hidden md:table-cell" />
                <td className="hidden lg:table-cell" />
                <td />
                <td className="hidden sm:table-cell" />
                <td className="hidden 2xl:table-cell" />
                <td className="hidden 2xl:table-cell" />
                <td className="num whitespace-nowrap px-3 py-2 text-right text-text">
                  {fmtMoeda(totalValor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {totalProdutos > LIMITE && (
        <p className="px-1 text-[11px] text-text-muted">
          Mostrando os {LIMITE} produtos de maior valor (de {totalProdutos} no total). Use os filtros para refinar.
        </p>
      )}
    </div>
  )
}
