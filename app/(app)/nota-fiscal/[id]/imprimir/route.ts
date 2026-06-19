import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { EtiquetaPDF, type Etiqueta, type EtiquetaConfig, type AlturaPreset, ALTURA_PRESETS } from '@/components/etiqueta/EtiquetaPDF'
import { formatarNomeProduto } from '@/lib/formatar-nome'

function num(v: unknown, dec: number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function parseConfig(url: string): EtiquetaConfig {
  const sp = new URL(url).searchParams
  const preset = sp.get('altura') as AlturaPreset | null
  return {
    alturaPreset: preset && preset in ALTURA_PRESETS ? preset : undefined,
    offsetX: sp.has('ox') ? Number(sp.get('ox')) : undefined,
    offsetY: sp.has('oy') ? Number(sp.get('oy')) : undefined,
    nomeExibido: sp.get('nome') ?? undefined,
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  // Subconjunto opcional de itens (impressão individual/selecionada)
  const itensParam = new URL(request.url).searchParams.get('itens')
  const itensIds = itensParam
    ? itensParam.split(',').map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : null

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('c_numero_nfe, c_nome')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!nf) return NextResponse.json({ error: 'Nota fiscal não encontrada' }, { status: 404 })

  const { data: loja } = await supabase.from('lojas').select('cnpj, nome, nome_fantasia').eq('id', lojaId).single()

  // Itens com quantidade definida + produto associado
  let itensQuery = supabase
    .from('nota_fiscal_items')
    .select('id, c_descricao_produto, quantidade, n_qtde_nfe, c_unidade_nfe, produto_codigo, full_object')
    .eq('nota_fiscal_id', id)
    .eq('loja_id', lojaId)
    .not('quantidade', 'is', null)
    .gt('quantidade', 0)
    .order('n_sequencia')

  if (itensIds?.length) itensQuery = itensQuery.in('id', itensIds)

  const { data: itens } = await itensQuery

  if (!itens?.length) {
    return NextResponse.json(
      { error: 'Nenhum item com quantidade definida para etiqueta' },
      { status: 404 }
    )
  }

  // Resolver código do produto (o QR e "Produto:" usam o codigo do cadastro)
  const codigosProd = [...new Set(itens.map((i) => i.produto_codigo).filter(Boolean))]
  const { data: produtos } = codigosProd.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigosProd)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [String(p.codigo_produto), p]))

  const etiquetas: Etiqueta[] = []
  for (const item of itens) {
    const prod = prodMap.get(String(item.produto_codigo))
    const unidade = prod?.unidade || item.c_unidade_nfe || ''
    const fo = (item.full_object ?? {}) as {
      itensAjustes?: { nQtdeRecebida?: number }
      itensCabec?: { nIdValidade?: string }
      infoCadastro?: { dRec?: string }
    }
    const qtdeRecebida = fo.itensAjustes?.nQtdeRecebida ?? 0
    const codigoProduto = prod?.codigo || item.produto_codigo || ''

    const qr = await QRCode.toDataURL(String(codigoProduto), { margin: 1, width: 160 })

    etiquetas.push({
      codigo_produto: String(codigoProduto),
      descricao: formatarNomeProduto(item.c_descricao_produto),
      lote: '',
      quantidade: '',
      qtde_nf: `${num(qtdeRecebida, 0)}(${unidade})`,
      qtde_etiqueta: `${num(item.quantidade, 0)}(${unidade})`,
      validade: fo.itensCabec?.nIdValidade ?? '',
      inclusao: fo.infoCadastro?.dRec ?? '',
      produzido: '',
      fornecedor: nf.c_nome ?? '',
      cnpj: loja?.cnpj ?? '',
      qr,
      nome_loja: loja?.nome_fantasia || loja?.nome || '',
    })
  }

  const config = parseConfig(request.url)
  const element = createElement(EtiquetaPDF, { etiquetas, config }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  // Registra a impressao no historico (aditivo, nao quebra o PDF em caso de erro)
  try {
    const service = createServiceClient()
    await service.from('impressao_etiquetas').insert({
      loja_id: lojaId,
      origem: 'NF',
      referencia_id: Number(id),
      qtd_etiquetas: etiquetas.length,
      user_id: (await getUser())?.id ?? null,
    })
  } catch {
    // ignora falha de registro de historico
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="etiquetas-nfe-${nf.c_numero_nfe}.pdf"`,
    },
  })
}
