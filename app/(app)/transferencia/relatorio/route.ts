import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { fmtData, fmtDataParam } from '@/lib/pdf-utils'
import {
  RelatorioTransferenciaPDF,
  type RelatorioTransferenciaItem,
} from '@/components/relatorio/RelatorioTransferenciaPDF'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { labelTipoItem } from '@/lib/constants-omie'
import { complementarMovimentos } from '@/lib/historico-contabo'
import { escapeIlikeOr } from '@/lib/utils-busca'

// Mapa de motivo (TRF/TPQ) para texto legivel no PDF.
const LABEL_MOTIVO: Record<string, string> = {
  TRF: 'Transferência',
  TPQ: 'Perda/Quebra',
}

async function pdfErroResponse(titulo: string, mensagem: string) {
  const el = createElement(PdfErro, { titulo, mensagem }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="erro.pdf"',
    },
  })
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) {
    return pdfErroResponse('Sem permissão', 'Você não tem permissão para acessar este relatório.')
  }

  const { searchParams } = new URL(request.url)
  const dataInicio =
    searchParams.get('data_inicio') ||
    new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const dataFinal = searchParams.get('data_final') || new Date().toISOString().split('T')[0]
  // familia/tipo vem como lista separada por virgula (multi-select) na URL.
  const familia = searchParams.get('familia') || ''
  const tipo = searchParams.get('tipo') || ''
  const familiasArr = valoresMulti(familia)
  const tiposArr = valoresMulti(tipo)
  const status = searchParams.get('status') || ''
  const motivo = searchParams.get('motivo') || ''
  const produto = searchParams.get('produto') || ''
  const local = searchParams.get('local') || ''

  const supabase = await createClient()

  const { data: loja } = await supabase
    .from('lojas')
    .select('nome, nome_fantasia')
    .eq('id', lojaId)
    .single()

  const nomeLoja = loja?.nome_fantasia || loja?.nome || 'Loja'

  // Nomes dos locais — usado tanto para exibir origem/destino quanto para o
  // subtitulo "Local: X, Y" quando o filtro de local estiver ativo.
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  // Filtro de familia/tipo/produto via produtos -> movimentos -> transferencia_id.
  // BUG corrigido (auditoria 2026-07-19): produto e local eram aceitos na tela
  // mas nunca chegavam a esta rota — o PDF sempre saía sem esses 2 filtros
  // mesmo com eles ativos na lista.
  let idsFiltrados: number[] | null = null
  if (familiasArr.length || tiposArr.length || produto) {
    function buildProdQuery(from: number, to: number) {
      let q = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).range(from, to)
      if (familiasArr.length) q = q.in('descricao_familia', familiasArr)
      if (tiposArr.length) q = q.in('tipo_item', tiposArr)
      if (produto) {
        const termo = escapeIlikeOr(produto)
        q = q.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      }
      return q
    }
    // Paginado: um tipo/familia isolado pode ter mais de 1000 produtos (ex: loja 6,
    // tipo "99", tem 1143) — sem paginar, o PostgREST corta em 1000 SEM avisar e o
    // filtro passa a ignorar produtos de verdade (falso negativo: transferencia some
    // do relatorio mesmo contendo produto do filtro escolhido).
    const codigos: number[] = []
    for (let from = 0; ; from += 1000) {
      const { data: bloco } = await buildProdQuery(from, from + 999)
      if (!bloco?.length) break
      codigos.push(...bloco.map((p) => p.codigo_produto).filter((v): v is number => v != null))
      if (bloco.length < 1000) break
    }
    const codigosUnicos = [...new Set(codigos)]

    if (codigosUnicos.length) {
      const movsData: { id: number; id_prod: number; transferencia_id: number | null; id_ajuste: number | null }[] = []
      for (let from = 0; ; from += 1000) {
        const { data: bloco } = await supabase
          .from('movimentos')
          .select('id, id_prod, transferencia_id, id_ajuste')
          .eq('loja_id', lojaId)
          .in('id_prod', codigosUnicos)
          .not('transferencia_id', 'is', null)
          .range(from, from + 999)
        if (!bloco?.length) break
        movsData.push(...bloco)
        if (bloco.length < 1000) break
      }
      // complementarMovimentos nao aceita uma lista de id_prod (a API do Contabo so
      // filtra por 1 produto por vez), entao ela busca TODOS os movimentos da loja
      // sem filtro de produto — precisa refiltrar aqui, senao movimentos do Contabo
      // de produtos fora da familia/tipo escolhido vazam pro resultado (idsFiltrados
      // incluiria transferencias que nao tem nenhum produto do filtro).
      const codigosSet = new Set(codigosUnicos)
      const movs = (await complementarMovimentos(movsData, { lojaId })).filter((m) =>
        codigosSet.has(m.id_prod)
      )
      idsFiltrados = [
        ...new Set(
          (movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null),
        ),
      ]
    } else {
      idsFiltrados = []
    }
  }

  const PAGE_SIZE = 1000
  type Linha = {
    id: number
    data: string | null
    codigo_local_origem: string | null
    codigo_local_destino: string | null
    motivo: string | null
    status: string | null
    movimentos: { count: number }[]
  }
  const transferencias: Linha[] = []

  const locaisArr = valoresMulti(local)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n))

  function buildQuery(from: number, to: number) {
    let q = supabase
      .from('transferencias')
      .select('id, data, codigo_local_origem, codigo_local_destino, motivo, status, movimentos(count)')
      .eq('loja_id', lojaId)
      .gte('data', dataInicio)
      .lte('data', `${dataFinal}T23:59:59`)
      .order('data', { ascending: false })
      .range(from, to)
    if (idsFiltrados !== null) q = q.in('id', idsFiltrados.length ? idsFiltrados : [-1])
    // BUG corrigido (auditoria 2026-07-19): status aqui vem como código 'A'/'C'
    // (igual à tela e ao export Excel), não como o texto cru do Omie —
    // um `.eq('status', status)` literal nunca batia com nada real
    // ("Concluido"/"Em contagem"...) e devolvia o PDF sempre vazio quando o
    // filtro de status estivesse ativo.
    if (status === 'C') q = q.eq('status', 'Concluido')
    else if (status === 'A') q = q.neq('status', 'Concluido')
    if (motivo === 'TRF' || motivo === 'TPQ') q = q.eq('motivo', motivo)
    if (locaisArr.length) {
      const lista = locaisArr.join(',')
      q = q.or(`codigo_local_origem.in.(${lista}),codigo_local_destino.in.(${lista})`)
    }
    return q
  }

  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGE_SIZE
    const { data: bloco } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (!bloco?.length) break
    transferencias.push(...(bloco as Linha[]))
    if (bloco.length < PAGE_SIZE) break
  }

  const itens: RelatorioTransferenciaItem[] = transferencias.map((t) => ({
    data: fmtData(t.data),
    origem: localMap.get(t.codigo_local_origem ?? '') || t.codigo_local_origem || '-',
    destino: localMap.get(t.codigo_local_destino ?? '') || t.codigo_local_destino || '-',
    motivo: t.motivo ? (LABEL_MOTIVO[t.motivo] ?? t.motivo) : undefined,
    produtos: Array.isArray(t.movimentos) ? t.movimentos[0]?.count ?? 0 : 0,
    status: t.status || 'N/A',
  }))

  // Monta subtitulo com filtros aplicados.
  const filtrosAtivos: string[] = []
  if (familiasArr.length) filtrosAtivos.push(`Família: ${familiasArr.join(', ')}`)
  if (tiposArr.length) filtrosAtivos.push(`Tipo: ${tiposArr.map((t) => labelTipoItem(t)).join(', ')}`)
  if (produto) filtrosAtivos.push(`Produto: ${produto}`)
  if (locaisArr.length) {
    const nomes = locaisArr.map((c) => localMap.get(c) || String(c))
    filtrosAtivos.push(`Local: ${nomes.join(', ')}`)
  }
  if (status === 'C') filtrosAtivos.push('Status: Concluída')
  else if (status === 'A') filtrosAtivos.push('Status: Em aberto')
  if (motivo === 'TRF') filtrosAtivos.push('Motivo: Transferência')
  else if (motivo === 'TPQ') filtrosAtivos.push('Motivo: Perda / quebra')

  const periodo = `${fmtDataParam(dataInicio)} a ${fmtDataParam(dataFinal)}`
  const filtros = filtrosAtivos.length ? filtrosAtivos.join(', ') : undefined

  // Nome do arquivo inclui loja e periodo.
  const nomeArquivo = `relatorio-transferencias-${nomeLoja.replace(/\s+/g, '-').toLowerCase()}-${dataInicio}-${dataFinal}.pdf`

  const element = createElement(RelatorioTransferenciaPDF, {
    loja: nomeLoja,
    periodo,
    filtros,
    transferencias: itens,
  }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomeArquivo}"`,
    },
  })
}
