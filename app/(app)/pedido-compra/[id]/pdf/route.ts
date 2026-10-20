import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { estadoPedidoCompraLoja } from '@/lib/compras/pedido-compra-loja'
import { createServiceClient } from '@/lib/supabase/server'
import { PdfErro } from '@/components/relatorio/PdfChrome'
import { PedidoCompraPDF, type PedidoPDFDados } from '@/components/relatorio/PedidoCompraPDF'
import { parcelasDoPedido } from '@/lib/compras/pedido-puro'
import { carregarPedido, envioOmieDosPedidos } from '../../dados'

const pdf = (buf: Buffer, nome: string) =>
  new NextResponse(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nome}"` } })
const br = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : null)
const cnpj = (d: string | null | undefined) => {
  const x = (d ?? '').replace(/\D/g, '')
  return x.length === 14 ? `${x.slice(0, 2)}.${x.slice(2, 5)}.${x.slice(5, 8)}/${x.slice(8, 12)}-${x.slice(12)}` : null // CPF (pessoa física) não sai no PDF
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  const onde = (await estadoPedidoCompraLoja(lojaId)).onde
  const pode = onde !== null && ((await requirePermissao(lojaId, 'Compras - Pedidos')) || (await requirePermissao(lojaId, 'Compras - Aprovar pedidos')))
  if (!pode) return pdf(await renderToBuffer(createElement(PdfErro, { titulo: 'Acesso negado', mensagem: 'Você não tem permissão para pedidos de compra.' }) as Parameters<typeof renderToBuffer>[0]), 'erro.pdf')
  const { id } = await params
  const p = /^\d+$/.test(id) ? await carregarPedido(lojaId, Number(id)) : null
  if (!p) return pdf(await renderToBuffer(createElement(PdfErro, { titulo: 'Pedido não encontrado', mensagem: 'Este pedido não existe nesta loja.' }) as Parameters<typeof renderToBuffer>[0]), 'erro.pdf')
  const { data: loja } = await createServiceClient().from('lojas').select('nome, nome_fantasia, cnpj').eq('id', lojaId).maybeSingle()
  const { cab, resumo, itens } = p
  const numeroOmie = onde === 'omie' ? (await envioOmieDosPedidos(lojaId, [cab.id])).get(cab.id)?.numeroOmie ?? null : null
  const d: PedidoPDFDados = {
    loja: loja?.nome_fantasia || loja?.nome || `Loja ${lojaId}`, lojaCnpj: cnpj(loja?.cnpj), numero: cab.numero, etapa: resumo.etapaExibida.rotulo,
    emissao: br(cab.created_at) ?? '', previsao: br(cab.previsao_entrega), fornecedor: cab.fornecedor_nome, fornecedorCnpj: cnpj(cab.fornecedor_cnpj),
    numeroFornecedor: cab.numero_fornecedor, contato: cab.contato,
    itens: itens.map((i) => ({ linha: i.linha, codigo: p.codigos.get(i.codigoProduto) ?? String(i.codigoProduto), descricao: i.descricao, unidade: i.unidade ?? '', quantidade: i.quantidade, preco: i.precoUnitario, obs: i.obs })),
    mercadorias: resumo.valorItens, frete: Number(cab.frete) || 0, outras: Number(cab.outras_despesas) || 0, total: resumo.total,
    parcelas: parcelasDoPedido(Array.isArray(cab.parcelas) ? cab.parcelas : [], resumo.total, cab.previsao_entrega).map((x) => ({ ...x, vencimento: br(x.vencimento) })),
    obs: cab.obs, aprovadoPor: cab.aprovado_por_nome, numeroOmie,
  }
  return pdf(await renderToBuffer(createElement(PedidoCompraPDF, { d }) as Parameters<typeof renderToBuffer>[0]), `pedido-compra-${cab.numero}.pdf`)
}
