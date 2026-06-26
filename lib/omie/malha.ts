import { omieRequest, type LojaOmie } from './client'

// Estrutura de produto (ficha tecnica / BOM) do Omie. SO LEITURA.
// Grafia confirmada por probe real (loja 3, 18/06): v1/geral/malha / ConsultarEstrutura
// com { idProduto }. Retorna ident + itens[] (componentes com quantidade/unidade/perda).
// NAO ha escrita aqui de proposito: a malha mexe nos itens reais do produto e so deve
// ser editada com o Ramon (regra critica da Fase 3).

export interface EstruturaItem {
  idMalha: number
  idProdMalha: number
  codProdMalha: string
  descrProdMalha: string
  descrFamMalha: string
  quantProdMalha: number
  unidProdMalha: string
  percPerdaProdMalha: number
  pesoLiqProdMalha: number
  pesoBrutoProdMalha: number
}

export interface EstruturaIdent {
  idProduto: number
  codProduto: string
  descrProduto: string
  descrFamilia: string
  tipoProduto: string
  unidProduto: string
  pesoLiqProduto: number
  pesoBrutoProduto: number
}

export interface EstruturaResp {
  ident?: EstruturaIdent
  itens?: EstruturaItem[]
  custoProducao?: { vMOD?: number; vGGF?: number }
  faultstring?: string
  faultcode?: string
}

// --- ESCRITA da malha (v1/geral/malha) ---
// Shape descoberto por probe (loja 3, 23/06): IncluirEstrutura usa o wrapper
// obrigatorio `itemMalhaIncluir`. Os campos internos espelham os da leitura
// (idProdMalha = idProduto do componente, quantProdMalha, percPerdaProdMalha).
// AlterarEstrutura/ExcluirEstrutura usam idMalha (a linha da estrutura).
// CONFIRMAR os nomes internos com um probe quando a API destravar.

export async function incluirEstrutura(
  loja: LojaOmie,
  idProduto: number,
  item: { idProdMalha: number; quantProdMalha: number; percPerdaProdMalha?: number }
) {
  return omieRequest<EstruturaResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/malha',
    call: 'IncluirEstrutura',
    data: {
      idProduto,
      itemMalhaIncluir: {
        idProdMalha: item.idProdMalha,
        quantProdMalha: item.quantProdMalha,
        percPerdaProdMalha: item.percPerdaProdMalha ?? 0,
      },
    },
  })
}

export async function alterarEstrutura(
  loja: LojaOmie,
  idProduto: number,
  idMalha: number,
  item: { quantProdMalha: number; percPerdaProdMalha?: number }
) {
  return omieRequest<EstruturaResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/malha',
    call: 'AlterarEstrutura',
    data: {
      idProduto,
      idMalha,
      itemMalhaAlterar: {
        quantProdMalha: item.quantProdMalha,
        percPerdaProdMalha: item.percPerdaProdMalha ?? 0,
      },
    },
  })
}

export async function excluirEstrutura(loja: LojaOmie, idProduto: number, idMalha: number) {
  return omieRequest<EstruturaResp>({
    loja_id: loja.id,
    omie_app_key: loja.omie_app_key,
    omie_app_secret: loja.omie_app_secret,
    endpoint: 'v1/geral/malha',
    call: 'ExcluirEstrutura',
    data: { idProduto, idMalha },
  })
}

/**
 * Consulta a estrutura (BOM) de um produto no Omie. SO LEITURA.
 * Retorna null quando o produto nao tem estrutura cadastrada (faultcode 103).
 */
export async function consultarEstrutura(
  loja: LojaOmie,
  idProduto: number
): Promise<EstruturaResp | null> {
  try {
    const res = await omieRequest<EstruturaResp>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      endpoint: 'v1/geral/malha',
      call: 'ConsultarEstrutura',
      data: { idProduto },
    })
    if (!res?.ident && !res?.itens?.length) return null
    return res
  } catch (e) {
    // Produto sem estrutura: o Omie devolve "Produto nao encontrado" (faultcode 103)
    // ou estrutura vazia. Trata como "sem ficha tecnica", nao como erro fatal.
    const msg = e instanceof Error ? e.message : String(e)
    if (/produto n.o encontrado|n.o existe|sem estrutura/i.test(msg)) return null
    throw e
  }
}
