import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { NecessidadeMpPDF } from '@/components/relatorio/NecessidadeMpPDF'
import type { LinhaProgramacao } from '@/components/relatorio/ProgramacaoProducaoPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'

const TIPO_LABEL = new Map(PRODUTO_TIPO_ITEM.map((t) => [t.value, t.label]))
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="erro.pdf"' },
  })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const mesParam = /^\d{4}-\d{2}$/.test(searchParams.get('mes') ?? '') ? searchParams.get('mes')! : hojeBahiaISO().slice(0, 7)
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null
  const tiposArr = valoresMulti(searchParams.get('tipo_produto') ?? undefined)
  const soAtrasadas = searchParams.get('atraso') === '1'

  const [ano, mes] = mesParam.split('-').map(Number)
  // Mesmo achado/fix de programacao/route.ts (item #3b, reuniao 03/08 -- Task 5,
  // 2026-08-04): no modo atraso a grade pode cruzar varios meses, entao usa 31 dias
  // fixo em vez do numero de dias do mesParam especifico.
  const numDias = soAtrasadas ? 31 : new Date(ano, mes, 0).getDate()
  const dias = Array.from({ length: numDias }, (_, i) => i + 1)
  const mesIni = `${mesParam}-01`
  const mesFim = `${mesParam}-${String(numDias).padStart(2, '0')}`
  const hojeISO = hojeBahiaISO()

  const supabase = await createClient()

  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const lojaNome = loja?.nome_fantasia || loja?.nome || ''

  let localNome = 'Todos'
  if (localCod !== null) {
    const { data: localRow } = await supabase
      .from('local_estoques')
      .select('descricao')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', localCod)
      .maybeSingle()
    localNome = localRow?.descricao ?? String(localCod)
  }

  // Mesmo padrao de paginacao de programacao/route.ts: PostgREST corta em 1000
  // linhas sem avisar, um mes cheio de OPs facilmente passa disso.
  function montarQuery(selectCols: string, opts?: { count: 'exact'; head: true }) {
    let q = supabase.from('ordens_producao').select(selectCols, opts).eq('loja_id', lojaId)
    if (soAtrasadas) {
      // Mesmo achado/fix de programacao/route.ts: "atrasada" e relativo a HOJE, nao
      // ao mesParam selecionado -- ver comentario la pro detalhe do bug reproduzido.
      q = q.lt('identificacao_d_dt_previsao', hojeISO)
    } else {
      q = q.gte('identificacao_d_dt_previsao', mesIni).lte('identificacao_d_dt_previsao', mesFim)
    }
    if (localCod !== null) q = q.eq('identificacao_codigo_local_estoque', localCod)
    return q
  }
  type OpRow = {
    identificacao_n_cod_produto: number | null
    identificacao_d_dt_previsao: string | null
    identificacao_codigo_local_estoque: number | null
    concluida: boolean | null
    full_object: unknown
  }
  const SELECT_OP = 'identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, concluida, full_object'
  const { count: totalOps } = await montarQuery(SELECT_OP, { count: 'exact', head: true })
  const numPaginasOps = Math.ceil((totalOps ?? 0) / 1000)
  const blocosOps = await Promise.all(
    Array.from({ length: numPaginasOps }, (_, p) => montarQuery(SELECT_OP).range(p * 1000, p * 1000 + 999))
  )
  const opsRaw = blocosOps.flatMap((r) => (r.data ?? []) as unknown as OpRow[])
  // opStatus() trata full_object como fallback quando concluida vem NULL -- mantido
  // aqui em vez de mover pra montarQuery pra nao perder esse fallback.
  const ops = opsRaw.filter((o) => !soAtrasadas || opStatus(o, hojeISO) === 'atrasada')

  // Filtro de tipo_produto se refere ao tipo do produto ACABADO da OP (mesmo
  // criterio de programacao/route.ts), nao ao tipo da materia-prima em si.
  const codigosProdutoAcabado = [...new Set(ops.map((o) => o.identificacao_n_cod_produto).filter((c): c is number => c != null))]
  const tipoPorProdutoAcabado = new Map<number, string | null>()
  if (codigosProdutoAcabado.length) {
    const { data: prods } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosProdutoAcabado)
    for (const p of prods ?? []) tipoPorProdutoAcabado.set(Number(p.codigo_produto), p.tipo_item)
  }
  const tiposSet = tiposArr.length ? new Set(tiposArr) : null

  // Explode a ficha tecnica (full_object.itensDetalhes) de cada OP e acumula
  // por dia -- mesmo campo/formato ja usado em lib/actions/detalhe-movimento.ts
  // (buscarDetalheOP): {nIdProdutoMalha, nQtde}, nQtde ja escalado pra
  // quantidade da OP (nao e uma razao por unidade).
  const porIngrediente = new Map<number, LinhaProgramacao>()
  for (const o of ops) {
    const codAcabado = o.identificacao_n_cod_produto
    if (tiposSet) {
      const tipoAcabado = codAcabado != null ? tipoPorProdutoAcabado.get(codAcabado) : null
      if (!(tipoAcabado && tiposSet.has(tipoAcabado))) continue
    }
    const dia = Number(o.identificacao_d_dt_previsao?.slice(8, 10))
    if (!dia) continue
    const itensDetalhes = (o.full_object as { itensDetalhes?: { nIdProdutoMalha: number; nQtde: number }[] } | null)?.itensDetalhes ?? []
    for (const item of itensDetalhes) {
      if (!item.nIdProdutoMalha) continue
      const linha = porIngrediente.get(item.nIdProdutoMalha) ?? {
        codigo: String(item.nIdProdutoMalha),
        descricao: `Produto ${item.nIdProdutoMalha}`,
        unidade: '',
        porDia: {},
      }
      linha.porDia[dia] = (linha.porDia[dia] ?? 0) + Number(item.nQtde ?? 0)
      porIngrediente.set(item.nIdProdutoMalha, linha)
    }
  }

  // Soma de ponto flutuante de nQtde (kg fracionado) gera lixo tipo
  // 0.44999999999999996 -- arredonda pra 3 casas (precisao de grama) so na
  // exibicao, mesmo padrao ja usado em lib/ajustes-omie.ts.
  for (const linha of porIngrediente.values()) {
    for (const dia of Object.keys(linha.porDia)) {
      linha.porDia[Number(dia)] = Math.round(linha.porDia[Number(dia)] * 1000) / 1000
    }
  }

  const codigosIngrediente = [...porIngrediente.keys()]
  if (codigosIngrediente.length) {
    const { data: prods } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao, unidade')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosIngrediente)
    for (const p of prods ?? []) {
      const linha = porIngrediente.get(Number(p.codigo_produto))
      if (!linha) continue
      linha.codigo = p.codigo ?? linha.codigo
      linha.descricao = p.descricao ?? linha.descricao
      linha.unidade = p.unidade ?? ''
    }
  }

  const linhas = [...porIngrediente.values()].sort((a, b) => a.descricao.localeCompare(b.descricao))

  const filtrosAtivos: string[] = []
  if (tiposArr.length) filtrosAtivos.push(`Tipo do produto acabado: ${tiposArr.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}`)
  if (soAtrasadas) filtrosAtivos.push('Somente atrasadas')

  const nomeArquivo = `necessidade-mp-${mesParam}${soAtrasadas ? '-atrasadas' : ''}.pdf`
  // No modo atraso o resultado pode cruzar varios meses (ver montarQuery acima).
  const mesLabel = soAtrasadas
    ? `Em atraso · até ${hojeISO.slice(8, 10)}/${hojeISO.slice(5, 7)}/${hojeISO.slice(0, 4)}`
    : `${MESES[mes - 1]}/${ano}`
  const element = createElement(NecessidadeMpPDF, {
    loja: lojaNome,
    local: localNome,
    mesLabel,
    filtros: filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined,
    dias,
    linhas,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
