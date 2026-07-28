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
  const numDias = new Date(ano, mes, 0).getDate()
  const dias = Array.from({ length: numDias }, (_, i) => i + 1)
  const mesIni = `${mesParam}-01`
  const mesFim = `${mesParam}-${String(numDias).padStart(2, '0')}`

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

  let query = supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_produto, identificacao_n_qtde, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, concluida, full_object')
    .eq('loja_id', lojaId)
    .gte('identificacao_d_dt_previsao', mesIni)
    .lte('identificacao_d_dt_previsao', mesFim)
  if (localCod !== null) query = query.eq('identificacao_codigo_local_estoque', localCod)

  const { data: opsRaw } = await query
  const hojeISO = hojeBahiaISO()
  const ops = (opsRaw ?? []).filter((o) => !soAtrasadas || opStatus(o, hojeISO) === 'atrasada')

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
  const element = createElement(ProgramacaoProducaoPDF, {
    loja: lojaNome,
    local: localNome,
    mesLabel: `${soAtrasadas ? 'Em atraso · ' : ''}${MESES[mes - 1]}/${ano}`,
    filtros: filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined,
    dias,
    linhas,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nomeArquivo}"` },
  })
}
