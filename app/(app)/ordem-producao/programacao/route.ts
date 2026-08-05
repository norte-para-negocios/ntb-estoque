import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { opStatus } from '@/lib/op-status'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { ProgramacaoProducaoPDF, type LinhaProgramacao } from '@/components/relatorio/ProgramacaoProducaoPDF'
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
  // Achado real (reconfirmado item #3b, reuniao 03/08 -- auditoria de
  // filtros/relatorios, Task 5, 2026-08-04): no modo "atraso=1", a grade pode
  // trazer OPs de MESES ANTERIORES ao mesParam selecionado (uma OP atrasada de
  // verdade e, por definicao, planejada no passado e nunca concluida -- o mes
  // em que ela foi planejada normalmente NAO e o mes atual). 31 dias cobre
  // qualquer mes de origem; ver montarQuery abaixo pra a mudanca principal.
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

  // PostgREST corta em 1000 linhas por padrao sem avisar -- um mes cheio de OPs
  // facilmente passa disso (ex.: 5000+ numa loja ativa). Pega o total exato
  // primeiro e busca todas as paginas em paralelo, mesmo padrao ja usado em
  // relatorio-compras/transferencia.
  function montarQuery(selectCols: string, opts?: { count: 'exact'; head: true }) {
    let q = supabase.from('ordens_producao').select(selectCols, opts).eq('loja_id', lojaId)
    if (soAtrasadas) {
      // "Atrasada" (lib/op-status.ts) e definida contra HOJE, nao contra o mes
      // selecionado -- restringir por mesIni/mesFim aqui escondia (com PDF vazio,
      // sem nenhum aviso) toda OP atrasada planejada num mes anterior ao atual, que
      // e o caso mais comum (uma OP so fica "atrasada" depois que o mes dela passou
      // sem ela ser concluida). Confirmado com dado real: loja 4, local PIZZA, tinha
      // 1 OP atrasada (prevista 31/07), e "Imprimir Atrasadas" em agosto voltava
      // "Nenhuma ordem de produção prevista" -- reproduzido ao vivo na conta QA
      // antes deste fix.
      q = q.lt('identificacao_d_dt_previsao', hojeISO)
    } else {
      q = q.gte('identificacao_d_dt_previsao', mesIni).lte('identificacao_d_dt_previsao', mesFim)
    }
    if (localCod !== null) q = q.eq('identificacao_codigo_local_estoque', localCod)
    return q
  }
  type OpRow = {
    identificacao_n_cod_produto: number | null
    identificacao_n_qtde: number | null
    identificacao_d_dt_previsao: string | null
    identificacao_codigo_local_estoque: number | null
    concluida: boolean | null
    full_object: unknown
  }
  const SELECT_OP = 'identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, concluida, full_object'
  const { count: totalOps } = await montarQuery(SELECT_OP, { count: 'exact', head: true })
  const numPaginasOps = Math.ceil((totalOps ?? 0) / 1000)
  const blocosOps = await Promise.all(
    Array.from({ length: numPaginasOps }, (_, p) => montarQuery(SELECT_OP).range(p * 1000, p * 1000 + 999))
  )
  const opsRaw = blocosOps.flatMap((r) => (r.data ?? []) as unknown as OpRow[])
  // opStatus() e a fonte da verdade pra "concluida" (trata full_object como fallback
  // quando a coluna concluida vem NULL, ver lib/op-status.ts) -- mantido aqui em vez
  // de mover pra montarQuery pra nao perder esse fallback.
  const ops = opsRaw.filter((o) => !soAtrasadas || opStatus(o, hojeISO) === 'atrasada')

  const codigosProduto = [...new Set(ops.map((o) => o.identificacao_n_cod_produto).filter((c): c is number => c != null))]
  const metaPorCodigo = new Map<number, { codigo: string; descricao: string; unidade: string; tipo: string | null }>()
  if (codigosProduto.length) {
    const { data: prods } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao, unidade, tipo_item')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosProduto)
    for (const p of prods ?? []) {
      metaPorCodigo.set(Number(p.codigo_produto), {
        codigo: p.codigo ?? String(p.codigo_produto),
        descricao: p.descricao ?? '(sem descrição)',
        unidade: p.unidade ?? '',
        tipo: p.tipo_item,
      })
    }
  }

  const tiposSet = tiposArr.length ? new Set(tiposArr) : null
  const porProduto = new Map<number, LinhaProgramacao>()
  for (const o of ops) {
    const cod = o.identificacao_n_cod_produto
    if (cod == null) continue
    const meta = metaPorCodigo.get(cod)
    if (tiposSet && !(meta?.tipo && tiposSet.has(meta.tipo))) continue
    const dia = Number(o.identificacao_d_dt_previsao?.slice(8, 10))
    if (!dia) continue
    const linha = porProduto.get(cod) ?? {
      codigo: meta?.codigo ?? String(cod),
      descricao: meta?.descricao ?? `Produto ${cod}`,
      unidade: meta?.unidade ?? '',
      porDia: {},
    }
    linha.porDia[dia] = (linha.porDia[dia] ?? 0) + Number(o.identificacao_n_qtde ?? 0)
    porProduto.set(cod, linha)
  }
  const linhas = [...porProduto.values()].sort((a, b) => a.descricao.localeCompare(b.descricao))

  const filtrosAtivos: string[] = []
  if (tiposArr.length) filtrosAtivos.push(`Tipo: ${tiposArr.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}`)
  if (soAtrasadas) filtrosAtivos.push('Somente atrasadas')

  const nomeArquivo = `programacao-producao-${mesParam}${soAtrasadas ? '-atrasadas' : ''}.pdf`
  // No modo atraso, o resultado pode cruzar varios meses (ver montarQuery acima) --
  // o rotulo nao pode mais dizer "agosto/2026" como se so aquele mes contasse.
  const mesLabel = soAtrasadas
    ? `Em atraso · até ${String(hojeISO.slice(8, 10))}/${hojeISO.slice(5, 7)}/${hojeISO.slice(0, 4)}`
    : `${MESES[mes - 1]}/${ano}`
  const element = createElement(ProgramacaoProducaoPDF, {
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
