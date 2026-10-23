import { createClient } from '@/lib/supabase/server'
import { AvisoCustoSuspeito } from '@/components/relatorios/AvisoCustoSuspeito'
import { AvisoSaldoConferir } from '@/components/relatorios/AvisoSaldoConferir'
import { motivoSuspeita, resumirSaldoConferir } from '@/lib/relatorios/posicao-estoque-puro'
import { lerSaldoConferir } from '@/lib/relatorios/posicao-estoque-loader'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
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
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { Boxes } from 'lucide-react'
import { formatCustoUnit } from '@/lib/num-br'

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

type LinhaLocal = {
  codigo_produto: number
  codigo: string | null
  descricao: string | null
  codigo_local_estoque: number
  local_descricao: string | null
  n_saldo: number
  n_cmc: number
  valor_total: number
  data_foto: string
  data_ultimo_inventario: string | null
}

function diasDesde(dataISO: string): number {
  const [a, m, d] = dataISO.split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  return Math.floor((Date.now() - dt.getTime()) / 86400000)
}

const LIMITE = 500

export default async function RelatorioEstoqueValorizadoPage({
  searchParams,
}: {
  searchParams: Promise<{ familia?: string; tipo?: string; local?: string; busca?: string; ver?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  const proprio = (await modoDaLoja(lojaId)) === 'proprio'
  const ator = await getAtorGestao()
  if (!ator.podeGerir) notFound()

  const sp = await searchParams
  const familias = valoresMulti(sp.familia)
  const tipos = valoresMulti(sp.tipo)
  const locais = valoresMulti(sp.local).map(Number).filter((n) => !Number.isNaN(n))
  const busca = sp.busca?.trim() || null
  const verLocal = sp.ver === 'local'

  const supabase = await createClient()

  // Fix round 1 (revisao independente da Task 12, 2026-08-09): rpcTodos ja
  // loga erro no servidor e retorna o que coletou ate falhar, mas sem
  // `onErro` nenhum sinal chegava na tela -- totalValor/totalProdutos
  // mostrariam um numero incompleto sem aviso se a RPC falhar (timeout,
  // drift de schema -- exatamente a classe de incidente da migration 097
  // que esta auditoria inteira existe pra pegar). Mesmo padrao ja aplicado
  // em `relatorio-compras/page.tsx` (Task 11): acumula erros e mostra um
  // banner visivel.
  const errosRpc: string[] = []
  function logErroRpc(fn: string, error: { message: string }) {
    errosRpc.push(fn)
    console.error(`relatorio-estoque-valorizado: RPC ${fn} falhou -- total pode estar incompleto`, error.message)
  }

  const [linhasTodas, linhasLocalTodas, familiasOpcoes, locaisOpcoes, suspeitasRaw, saldoConferirRaw] = await Promise.all([
    // rpcTodos ao inves de .rpc() direto: o PostgREST corta em 1000 linhas por
    // padrao, sem erro -- lojas com catalogo grande tinham o "Total valorizado"
    // subcontado (so somava as linhas que vinham na 1a pagina), mesma classe de
    // bug ja achada e corrigida no Faturamento nesta sessao.
    verLocal
      ? Promise.resolve<Linha[]>([])
      : rpcTodos<Linha>(
          supabase,
          'relatorio_estoque_valorizado',
          {
            p_loja_id: lojaId,
            p_familia: familias.length ? familias : null,
            p_tipo: tipos.length ? tipos : null,
            p_local: locais.length ? locais : null,
            p_busca: busca,
          },
          (error) => logErroRpc('relatorio_estoque_valorizado', error)
        ),
    verLocal
      ? rpcTodos<LinhaLocal>(
          supabase,
          'relatorio_estoque_valorizado_local',
          {
            p_loja_id: lojaId,
            p_familia: familias.length ? familias : null,
            p_tipo: tipos.length ? tipos : null,
            p_local: locais.length ? locais : null,
            p_busca: busca,
          },
          (error) => logErroRpc('relatorio_estoque_valorizado_local', error)
        )
      : Promise.resolve<LinhaLocal[]>([]),
    buscarFamilias(),
    supabase
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .neq('inativo', 'S')
      .order('descricao'),
    // Linhas de custo médio suspeito no Omie (regra única posicao_valorizada, migration 282): o total já vem ajustado
    // pela referência de custo; aqui só a lista para o aviso. Sem a 282: sem aviso.
    supabase
      .rpc('posicao_valorizada', { p_loja_id: lojaId })
      .select('n_cod_prod, codigo_local_estoque, n_saldo, n_cmc, referencia, valor_omie, valor, fonte_referencia')
      .eq('suspeito', true)
      .limit(5000)
      .then((r) => (r.error ? [] : (r.data ?? []) as { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number; referencia: number | null; valor_omie: number; valor: number; fonte_referencia: string | null }[])),
    // saldos do Omie a conferir (migration 296): só aviso, o total não muda; sem a 296 = sem aviso
    lerSaldoConferir(supabase, lojaId, null, () => (e) => console.error('relatorio-estoque-valorizado: saldos a conferir', e.message)),
  ])

  // filtros da tela valem para a lista do aviso (local direto; produto/família/tipo pelas linhas que a RPC devolveu)
  const prodsNaTela = new Set([...linhasTodas, ...linhasLocalTodas].map((l) => Number(l.codigo_produto)))
  const nomeProd = new Map([...linhasLocalTodas, ...linhasTodas].map((l) => [Number(l.codigo_produto), {
    codigo: l.codigo ?? String(l.codigo_produto), descricao: l.descricao ?? '',
    unidade: 'unidade' in l ? l.unidade : null, tipo: 'tipo_item' in l ? l.tipo_item : null,
  }]))
  const nomeLocal = new Map((locaisOpcoes.data ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao ?? String(l.codigo_local_estoque)]))
  const suspeitas = suspeitasRaw
    .filter((x) => prodsNaTela.has(Number(x.n_cod_prod)) && (!locais.length || locais.includes(Number(x.codigo_local_estoque))))
    .map((x) => ({
      chave: `${x.n_cod_prod}:${x.codigo_local_estoque}`, codigo: nomeProd.get(Number(x.n_cod_prod))?.codigo ?? String(x.n_cod_prod),
      descricao: nomeProd.get(Number(x.n_cod_prod))?.descricao ?? '', local: nomeLocal.get(Number(x.codigo_local_estoque)) ?? String(x.codigo_local_estoque),
      quant: Number(x.n_saldo), cmcOmie: Number(x.n_cmc), referencia: x.referencia == null ? null : Number(x.referencia), valorOmie: Number(x.valor_omie), valor: Number(x.valor),
      motivo: motivoSuspeita({ unidade: nomeProd.get(Number(x.n_cod_prod))?.unidade ?? null, tipo: nomeProd.get(Number(x.n_cod_prod))?.tipo ?? null, cmcOmie: Number(x.n_cmc), referencia: x.referencia == null ? null : Number(x.referencia), fonte: x.fonte_referencia ?? null }),
    }))
    .sort((a, b) => Math.abs(b.valorOmie - b.valor) - Math.abs(a.valorOmie - a.valor))
  const ajusteOmie = Math.round(suspeitas.reduce((s, l) => s + l.valorOmie - l.valor, 0) * 100) / 100
  const saldoConferir = saldoConferirRaw ? resumirSaldoConferir(saldoConferirRaw, nomeProd, prodsNaTela) : null
  const dataFoto = linhasTodas[0]?.data_foto ?? linhasLocalTodas[0]?.data_foto ?? null
  const totalValor = linhasTodas.reduce((s, l) => s + Number(l.valor_total), 0)
  const totalProdutos = linhasTodas.length
  // Tabela continua mostrando só os 500 de maior valor (RPC já ordena por
  // valor_total desc) -- só o total/contagem dos cards precisava ser exato.
  const linhas = linhasTodas.slice(0, LIMITE)

  const linhasLocal = linhasLocalTodas.slice(0, LIMITE)
  const totalProdutosLocal = linhasLocalTodas.length
  const totalValorLocal = linhasLocalTodas.reduce((s, l) => s + Number(l.valor_total), 0)

  const campos: CampoFiltro[] = [
    {
      tipo: 'texto',
      nome: 'busca',
      label: 'Produto (nome ou código)',
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
      label: 'Família',
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

  const th = 'whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-text-muted'

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Estoque Valorizado"
          icon={Boxes}
          description={(proprio ? 'Valor do estoque atual: saldo x custo médio de hoje.' : 'Valor do estoque atual: saldo x CMC da última foto do Omie.') + ' Saldos negativos entram no total, como no Omie e na Posição de estoque.'}
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
        <SegmentLinks
          basePath="/relatorio-estoque-valorizado"
          param="ver"
          aria-label="Ver estoque valorizado por"
          opcoes={[
            { value: '', label: 'Total' },
            { value: 'local', label: 'Por local' },
          ]}
        />
      </ListaHeader>

      {errosRpc.length > 0 && (
        <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          Falha ao consultar os dados de posição — o total acima pode estar
          incompleto. Recarregue a página; se persistir, avise o suporte.
        </p>
      )}

      {suspeitas.length > 0 && (
        <AvisoCustoSuspeito suspeitas={suspeitas} ajusteOmie={ajusteOmie} totalAjustado={verLocal ? totalValorLocal : totalValor} />
      )}
      {saldoConferir && <AvisoSaldoConferir resumo={saldoConferir} total={verLocal ? totalValorLocal : totalValor} />}

      {!verLocal ? (
        <>
          {/* Cards de resumo */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
              <p className="text-[13px] text-text-muted">Total valorizado</p>
              <p className="num mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-text">{fmtMoeda(totalValor)}</p>
            </div>
            <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
              <p className="text-[13px] text-text-muted">Produtos com saldo</p>
              <p className="num mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-text">{totalProdutos}</p>
            </div>
            {dataFoto && (
              <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
                <p className="text-[13px] text-text-muted">Foto do estoque</p>
                <p className="num mt-1.5 text-[17px] font-semibold text-text">{fmtData(dataFoto)}</p>
              </div>
            )}
          </div>

          {linhas.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="Sem dados de posição"
              hint="Aguarde a sincronização de posição de estoques ou ajuste o filtro."
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface">
              <table className="w-full min-w-[520px] border-collapse text-sm sm:min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className={`sticky left-0 z-20 bg-surface text-left ${th}`}>Produto</th>
                    <th className={`text-left ${th} hidden md:table-cell`}>Família</th>
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
                            <div className="num text-[12px] text-text-muted">{l.codigo}</div>
                          )}
                        </Link>
                      </td>
                      <td className="hidden px-3 py-2 text-text-muted md:table-cell">
                        {l.descricao_familia ?? '-'}
                      </td>
                      <td className="hidden px-3 py-2 text-[12px] text-text-muted lg:table-cell">
                        {TIPO_LABEL.get(l.tipo_item ?? '') ?? l.tipo_item ?? '-'}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2 text-right text-text">
                        {fmtNum(Number(l.n_saldo), 3)} {l.unidade ?? ''}
                      </td>
                      <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text sm:table-cell">
                        {formatCustoUnit(Number(l.n_cmc))}
                      </td>
                      <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text 2xl:table-cell">
                        {l.n_preco_unitario ? fmtMoeda(Number(l.n_preco_unitario)) : '-'}
                      </td>
                      <td className="num hidden whitespace-nowrap px-3 py-2 text-right 2xl:table-cell">
                        <span
                          className={
                            l.margem_pct != null && l.margem_pct < 0
                              ? 'text-err'
                              : 'text-text'
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
                  <tr className="border-t border-border bg-surface-2 font-semibold">
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
            <p className="px-1 text-[13px] text-text-muted">
              Mostrando os {LIMITE} produtos de maior valor (de {totalProdutos} no total). Use os filtros para refinar.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
              <p className="text-[13px] text-text-muted">Total valorizado</p>
              <p className="num mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-text">{fmtMoeda(totalValorLocal)}</p>
            </div>
            <div className="rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-4">
              <p className="text-[13px] text-text-muted">Linhas (produto x local)</p>
              <p className="num mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-text">{totalProdutosLocal}</p>
            </div>
          </div>

          {linhasLocal.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="Sem dados de posição"
              hint="Aguarde a sincronização de posição de estoques ou ajuste o filtro."
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface">
              <table className="w-full min-w-[520px] border-collapse text-sm sm:min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-surface">
                    <th className={`sticky left-0 z-20 bg-surface text-left ${th}`}>Produto</th>
                    <th className={`text-left ${th}`}>Local</th>
                    <th className={`text-right ${th}`}>Saldo</th>
                    <th className={`text-right ${th} hidden sm:table-cell`}>CMC</th>
                    <th className={`text-right ${th}`}>Valor total</th>
                    <th className={`text-left ${th}`}>Último inventário</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasLocal.map((l) => {
                    const dias = l.data_ultimo_inventario ? diasDesde(l.data_ultimo_inventario) : null
                    const critico = dias == null || dias >= 30
                    return (
                      <tr
                        key={`${l.codigo_produto}-${l.codigo_local_estoque}`}
                        className="border-t border-border/60 hover:bg-surface-2/40"
                      >
                        <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                          <Link
                            href={`/relatorio-movimentacao?produto=${encodeURIComponent(l.codigo ?? l.descricao ?? '')}`}
                            className="block max-w-[220px] hover:underline"
                            title="Ver movimentações deste produto"
                          >
                            <div className="truncate text-text" title={l.descricao ?? ''}>
                              {formatarNomeProduto(l.descricao ?? '')}
                            </div>
                            {l.codigo && <div className="num text-[12px] text-text-muted">{l.codigo}</div>}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-text-muted">{l.local_descricao ?? l.codigo_local_estoque}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right text-text">
                          {fmtNum(Number(l.n_saldo), 3)}
                        </td>
                        <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text sm:table-cell">
                          {formatCustoUnit(Number(l.n_cmc))}
                        </td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">
                          {fmtMoeda(Number(l.valor_total))}
                        </td>
                        <td className={`num whitespace-nowrap px-3 py-2 ${critico ? 'text-err' : 'text-text-muted'}`}>
                          {l.data_ultimo_inventario
                            ? `${fmtData(l.data_ultimo_inventario)} (há ${dias}d)`
                            : 'Nunca contado'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalProdutosLocal > LIMITE && (
            <p className="px-1 text-[13px] text-text-muted">
              Mostrando as {LIMITE} linhas de maior valor (de {totalProdutosLocal} no total). Use os filtros para refinar.
            </p>
          )}
        </>
      )}
    </div>
  )
}
