import { notFound } from 'next/navigation'
import { Coins, Layers, Scale, Wallet } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { BarraSaldo, fmtBRL, fmtQtd, Indicador, Saldo, SituacaoPill } from '@/components/estoque-proprio/Apresentacao'
import { AcoesProduto } from '@/components/estoque-proprio/Acoes'
import { Kardex } from '@/components/estoque-proprio/Kardex'
import { carregarEstoque, carregarMovimentos, situacaoDe, TIPOS_ITEM } from '../../dados'
import { carregarEstoqueOmie } from '../../dados-omie'
import { EspelhoOmieBarra } from '@/components/estoque-proprio/EspelhoOmieBarra'
import { KardexOmie, type LinhaKardexTela } from '@/components/estoque-proprio/KardexOmie'
import { marcarSaltosCmc, type LinhaKardexOmie } from '@/lib/estoque/kardex-omie-puro'
import { createClient } from '@/lib/supabase/server'
import { formatCustoUnit } from '@/lib/num-br'
import { CustoProduto, type LinhaPrato } from '@/components/estoque-proprio/CustoProduto'
import { NotasDoProduto } from '@/components/estoque-proprio/NotasDoProduto'
import { custoDoPrato, entradasQueFormaramCusto, serieCustoMedio, type MovCusto } from '@/lib/estoque/custo-produto-puro'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'

export default async function ProdutoEstoquePage({ params }: { params: Promise<{ codigo: string }> }) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const ehOmie = modo === 'omie'
  const podeMovimentar = !ehOmie && (await requirePermissao(lojaId, 'Movimentacoes - Criar'))

  const { codigo } = await params
  const cod = Number(codigo)
  if (!Number.isFinite(cod)) notFound()

  const espelho = ehOmie ? await carregarEstoqueOmie(lojaId) : null
  const visao = espelho ?? (await carregarEstoque(lojaId))
  const p = visao.linhas.find((l) => l.codigoProduto === cod)
  if (!p) notFound()
  const movimentos = ehOmie ? [] : await carregarMovimentos(lojaId, { codigoProduto: cod }, 100)

  // Loja Omie: kardex espelhado (kardex_omie, migration 159). Sem a tabela, a seção avisa em vez de quebrar.
  let kardexOmie: LinhaKardexTela[] = []
  let kardexAtivo = true
  let ultimaCarga: { carregadoEm: string; movimentos: number } | null = null
  if (ehOmie) {
    const supabase = await createClient()
    const { data, error } = await supabase.from('kardex_omie')
      .select('loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, tipo, quantidade, valor_unit, cmc_apos, saldo_apos, num_doc, num_pedido, id_ajuste, id_cupom, cancelado')
      .eq('loja_id', lojaId).eq('n_cod_prod', cod)
      .order('data_mov', { ascending: false }).order('id_mov', { ascending: false }).limit(1000)
    if (error) kardexAtivo = false
    const { data: carga } = await supabase.from('kardex_omie_carga').select('carregado_em, movimentos')
      .eq('loja_id', lojaId).eq('n_cod_prod', cod).maybeSingle()
    if (carga) ultimaCarga = { carregadoEm: carga.carregado_em as string, movimentos: Number(carga.movimentos) }
    const nomeLocal = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
    kardexOmie = marcarSaltosCmc(((data ?? []) as LinhaKardexOmie[]).map((m) => ({
      ...m, quantidade: Number(m.quantidade), valor_unit: m.valor_unit == null ? null : Number(m.valor_unit),
      cmc_apos: m.cmc_apos == null ? null : Number(m.cmc_apos), saldo_apos: m.saldo_apos == null ? null : Number(m.saldo_apos),
      id_mov: Number(m.id_mov), codigo_local_estoque: Number(m.codigo_local_estoque),
    })))
      .reverse()
      .map((m) => ({ ...m, local: nomeLocal.get(m.codigo_local_estoque) ?? String(m.codigo_local_estoque) }))
  }

  // Custo do produto: série do custo médio, entradas que formaram o custo e custo do prato pela ficha.
  const nomeLocalCusto = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
  let movsCusto: MovCusto[] = []
  if (ehOmie) {
    movsCusto = kardexOmie.map((m) => ({
      data: m.data_mov, ordem: m.id_mov, local: m.codigo_local_estoque, quantidade: m.quantidade, valorUnit: m.valor_unit,
      cmc: m.cmc_apos, saldo: m.saldo_apos, cancelado: m.cancelado, doc: m.num_pedido ?? m.num_doc, origem: m.des_origem || m.cod_origem || null,
    }))
  } else {
    const supabase = await createClient()
    const { data } = await supabase.from('estoque_movimentos')
      .select('id, data_ref, codigo_local_estoque, quantidade, custo_unitario, cmc_apos, saldo_apos, origem, ref, reverses_id')
      .eq('loja_id', lojaId).eq('codigo_produto', cod).order('id', { ascending: false }).limit(1000)
    const rows = (data ?? []) as { id: number; data_ref: string; codigo_local_estoque: number; quantidade: number; custo_unitario: number | null; cmc_apos: number | null; saldo_apos: number; origem: string; ref: string; reverses_id: number | null }[]
    const estornados = new Set(rows.map((r) => r.reverses_id).filter((x): x is number => x != null).map(Number))
    movsCusto = rows.map((r) => ({
      data: r.data_ref, ordem: Number(r.id), local: Number(r.codigo_local_estoque), quantidade: Number(r.quantidade),
      valorUnit: r.custo_unitario == null ? null : Number(r.custo_unitario), cmc: r.cmc_apos == null ? null : Number(r.cmc_apos),
      saldo: Number(r.saldo_apos), cancelado: estornados.has(Number(r.id)) || r.reverses_id != null, doc: r.ref, origem: r.origem,
    }))
  }
  const ehPrato = p.tipoItem === '03' || p.tipoItem === '04'
  const porCodigo = new Map(visao.linhas.map((l) => [l.codigoProduto, l]))
  let prato: { total: number; linhas: LinhaPrato[]; semCusto: number } | null = null
  let notaFicha: string | undefined
  if (ehPrato) {
    const supabase = await createClient()
    let itens: { insumo: number; qtdPorUnidade: number; descricao: string | null; unidade: string | null }[] = []
    if (ehOmie) {
      const { data } = await supabase.from('estrutura_produto_cache')
        .select('codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, unidade')
        .eq('loja_id', lojaId).eq('codigo_produto', cod).order('id')
      itens = (data ?? []).map((r) => ({
        insumo: Number(r.codigo_produto_insumo), qtdPorUnidade: Number(r.quantidade) * (1 + Number(r.percentual_perda ?? 0) / 100),
        descricao: r.descricao_insumo as string | null, unidade: r.unidade as string | null,
      }))
    } else {
      const ficha = (await carregarFichasAtivas(supabase, lojaId).catch(() => new Map())).get(cod)
      itens = (ficha?.itens ?? []).map((i: { codigoInsumo: number; quantidadeLiquida: number; fatorCorrecao: number; perdaPct: number }) => ({
        insumo: i.codigoInsumo, qtdPorUnidade: (i.quantidadeLiquida * i.fatorCorrecao * (1 + i.perdaPct / 100)) / (ficha?.rendimento || 1),
        descricao: null, unidade: null,
      }))
    }
    if (itens.length) {
      const r = custoDoPrato(itens.map((i) => ({ insumo: i.insumo, qtdPorUnidade: i.qtdPorUnidade, cmc: porCodigo.get(i.insumo)?.custoSuspeito ? null : (porCodigo.get(i.insumo)?.cmc ?? null) })))
      prato = {
        total: r.total, semCusto: r.semCusto.length,
        linhas: r.linhas.map((l, k) => ({
          ...l, descricao: porCodigo.get(l.insumo)?.descricao ?? itens[k].descricao ?? `Produto ${l.insumo}`,
          unidade: porCodigo.get(l.insumo)?.unidade ?? itens[k].unidade ?? '',
        })),
      }
    } else {
      notaFicha = ehOmie ? 'Ficha técnica ainda não lida do Omie (ou o produto não tem ficha).' : 'Este produto não tem ficha técnica ativa.'
    }
  }

  const locaisAtivos = visao.locais.filter((l) => !l.inativo)
  const saldos = p.locais.map((x) => ({ codigoLocal: x.codigoLocal, saldo: x.saldo, minimo: x.minimo }))
  // Mostra todo local ativo, mesmo sem movimento (saldo 0), para dar para receber/transferir nele.
  const porLocal = locaisAtivos.map((l) => {
    const s = p.locais.find((x) => x.codigoLocal === l.codigoLocal)
    const saldo = s?.saldo ?? 0
    const minimo = s?.minimo ?? null
    return { ...l, saldo, minimo, situacao: situacaoDe(saldo, minimo) }
  })

  return (
    <div className="space-y-5">
      <PageHeader
        voltarHref="/estoque"
        title={p.descricao}
        description={`Código ${p.codigo} · ${p.familia}${p.tipoItem ? ` · ${TIPOS_ITEM[p.tipoItem] ?? p.tipoItem}` : ''} · unidade ${p.unidade}`}
        actions={podeMovimentar ? (
          <AcoesProduto
            produto={{ codigoProduto: p.codigoProduto, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }}
            locais={locaisAtivos.map((l) => ({ codigoLocal: l.codigoLocal, descricao: l.descricao }))}
            saldos={saldos}
          />
        ) : undefined}
      />

      <EstoqueAtalhos atual="estoque" />

      {espelho && <EspelhoOmieBarra atualizadoEm={espelho.atualizadoEm} locaisSemLeitura={espelho.locaisSemLeitura} custoSuspeito={p.custoSuspeito ? 1 : 0} podeAtualizar={false} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador icon={Layers} rotulo="Saldo total" valor={`${fmtQtd(p.saldo)} ${p.unidade}`} tom={p.situacao === 'negativo' ? 'erro' : p.situacao === 'baixo' ? 'aviso' : undefined} dica={p.situacao === 'negativo' ? 'Saldo negativo: lance a entrada' : undefined} />
        <Indicador icon={Coins} rotulo="Custo médio" valor={p.cmc ? formatCustoUnit(p.cmc) : '-'} dica={`por ${p.unidade}`} />
        <Indicador icon={Wallet} rotulo="Valor em estoque" valor={fmtBRL(p.valor)} dica="saldo × custo médio" />
        <Indicador icon={Scale} rotulo="Estoque mínimo" valor={p.minimo != null ? `${fmtQtd(p.minimo)} ${p.unidade}` : 'Não definido'} />
      </div>

      <section aria-label="Saldo por local">
        <h2 className="mb-2 text-[15px] font-semibold text-text">Saldo por local</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {porLocal.map((l) => (
            <div key={l.codigoLocal} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
              <div className="flex items-start justify-between gap-2">
                <a href={`/estoque/local/${l.codigoLocal}`} className="text-[14px] font-medium text-text hover:underline">{l.descricao}</a>
                <SituacaoPill situacao={l.situacao} />
              </div>
              <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em]"><Saldo valor={l.saldo} unidade={p.unidade} /></div>
              <div className="mt-2"><BarraSaldo saldo={l.saldo} minimo={l.minimo} situacao={l.situacao} /></div>
              <div className="mt-1.5 text-[12px] text-text-muted">{l.minimo != null ? `Mínimo ${fmtQtd(l.minimo)} ${p.unidade}` : 'Sem mínimo definido'}</div>
            </div>
          ))}
          {porLocal.length === 0 && <p className="text-[13px] text-text-muted">Nenhum local de estoque ativo. Crie um local para começar.</p>}
        </div>
      </section>

      <CustoProduto series={serieCustoMedio(movsCusto)} entradas={entradasQueFormaramCusto(movsCusto)} nomeLocal={nomeLocalCusto} unidade={p.unidade} prato={prato} notaFicha={notaFicha} />

      {ehOmie ? (
        <section aria-label="Movimentos no Omie">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[15px] font-semibold text-text">Movimentos no Omie</h2><a href={`/estoque/kardex?produto=${p.codigoProduto}&data_inicio=2026-07-01`} className="text-[13px] font-medium text-brand hover:underline">Ver todo o histórico no kardex da loja</a></div>
          {kardexAtivo
            ? <KardexOmie codigoProduto={p.codigoProduto} unidade={p.unidade} linhas={kardexOmie.slice(0, 300)} podeCarregar ultimaCarga={ultimaCarga} />
            : <p className="text-[13px] text-text-muted">Kardex do Omie ainda não ativado.</p>}
        </section>
      ) : (
        <section aria-label="Kardex">
          <h2 className="mb-2 text-[15px] font-semibold text-text">Movimentos (kardex)</h2>
          <Kardex movimentos={movimentos} unidade={p.unidade} podeEstornar={podeMovimentar} />
          <p className="mt-2 text-[12px] text-text-muted">* entrada sem custo informado: o custo médio não foi alterado.</p>
        </section>
      )}
      <NotasDoProduto lojaId={lojaId} codigoProduto={p.codigoProduto} codigo={p.codigo} />
    </div>
  )
}
