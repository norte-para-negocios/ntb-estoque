import { omieRequest, type LojaOmie } from './client'

interface OmiePosicao {
  codigo_local_estoque: number
  nCodProd: number
  cCodInt: string
  cCodigo: string
  cDescricao: string
  nPrecoUnitario: number
  nSaldo: number
  nCMC: number
  nPendente: number
}

interface OmiePosResponse {
  nPagina: number
  nTotPaginas: number
  produtos?: OmiePosicao[]
}

/**
 * Busca o CMC (custo medio) de um produto especifico num local de estoque.
 * Critico para inventario e transferencia: o ajuste no Omie exige nValorUnitario = CMC.
 * Retorna null se nao encontrado.
 */
export async function getPosicaoProduto(
  loja: LojaOmie,
  codigoLocalEstoque: number,
  produtoCodigo: number,
  dataPosicao: string // formato d/m/Y
): Promise<{ n_cmc: number; n_saldo: number } | null> {
  const res = await omieRequest<OmiePosResponse>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/estoque/consulta',
    call: 'ListarPosEstoque',
    data: {
      nPagina: 1,
      nRegPorPagina: 1,
      dDataPosicao: dataPosicao,
      codigo_local_estoque: codigoLocalEstoque,
      lista_produtos: { nCodProd: produtoCodigo },
      cExibeTodos: 'S',
    },
  })

  const p = res.produtos?.[0]
  if (!p) return null
  return { n_cmc: p.nCMC ?? 0, n_saldo: p.nSaldo ?? 0 }
}
