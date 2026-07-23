import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { EtiquetaPDF, type Etiqueta, type EtiquetaConfig } from '@/components/etiqueta/EtiquetaPDF'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { resolverCodigosPorFiltro, buscarProdutosPorCodigos } from '@/lib/produtos-selecionados'

// Config fixa: só nome do produto + QR + logo (logo já é obrigatória no
// EtiquetaPDF, independente de config). Nada de campos de NF/OP (validade,
// lote, fornecedor, etc.) -- essa etiqueta não vem de um recebimento/produção.
const CONFIG_MINIMA: EtiquetaConfig = {
  mostrarFabricacao: false,
  mostrarValidade: false,
  mostrarQtdeNf: false,
  mostrarQtdeEtiqueta: false,
  mostrarLote: false,
  mostrarRecebido: false,
  mostrarFornecedor: false,
  mostrarCnpj: false,
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const url = new URL(request.url)
  let codigos: number[]
  if (url.searchParams.get('todos_filtro') === '1') {
    codigos = await resolverCodigosPorFiltro(lojaId, {
      q: url.searchParams.get('q') ?? undefined,
      familia: url.searchParams.get('familia') ?? undefined,
      tipo: url.searchParams.get('tipo') ?? undefined,
      situacao: url.searchParams.get('situacao') ?? undefined,
      fornecedor: url.searchParams.get('fornecedor') ?? undefined,
      pdv: url.searchParams.get('pdv') ?? undefined,
    })
  } else {
    codigos = [...new Set(url.searchParams.getAll('codigos').map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  }
  if (!codigos.length) {
    return NextResponse.json({ error: 'Nenhum produto selecionado' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const produtos = await buscarProdutosPorCodigos(lojaId, codigos)
  if (!produtos.length) {
    return NextResponse.json({ error: 'Produtos não encontrados' }, { status: 404 })
  }

  const nomeLoja = loja?.nome_fantasia || loja?.nome || ''
  const etiquetas: Etiqueta[] = []
  for (const p of produtos) {
    const codigoExibido = p.codigo || String(p.codigo_produto)
    const qr = await QRCode.toDataURL(String(p.codigo_produto), { margin: 1, width: 160 })
    etiquetas.push({
      codigo_produto: codigoExibido,
      descricao: formatarNomeProduto(p.descricao),
      quantidade: '',
      qtde_nf: '',
      qtde_etiqueta: '',
      validade: '',
      produzido: '',
      inclusao: '',
      lote: '',
      fornecedor: '',
      cnpj: '',
      qr,
      nome_loja: nomeLoja,
    })
  }

  const element = createElement(EtiquetaPDF, { etiquetas, config: CONFIG_MINIMA }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  try {
    const service = createServiceClient()
    await service.from('impressao_etiquetas').insert({
      loja_id: lojaId,
      origem: 'PRODUTO',
      referencia_id: 0,
      qtd_etiquetas: etiquetas.length,
      user_id: (await getUser())?.id ?? null,
    })
  } catch {
    // ignora falha de registro de historico, igual aos outros imprimir/route.ts
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="etiquetas-produtos.pdf"',
    },
  })
}
