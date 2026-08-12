import { omieRequest, type LojaOmie } from './client'

interface OmieMovItem {
  nCodProd: number
  cCodigo: string
  cDescricao: string
  movimentos: { dDataMovimento: string; nQtdeEntradas: number; nQtdeSaidas: number }[]
}

interface OmieMovResponse {
  pagina: number
  total_de_paginas: number
  total_de_registros: number
  cadastros?: OmieMovItem[]
}

/**
 * Soma as SAIDAS de estoque por produto num periodo (ListarMovimentos do Omie).
 * Pagina ate o fim e agrega nQtdeSaidas por nCodProd. Retorna Map<nCodProd, totalSaidas>.
 * Datas em 'DD/MM/AAAA'. Periodo sem movimento volta como Map vazio (nao e erro).
 */
export async function buscarSaidasPeriodo(
  loja: LojaOmie,
  dataInicial: string,
  dataFinal: string
): Promise<Map<number, number>> {
  const saidas = new Map<number, number>()
  let pagina = 1
  let totalPaginas = 1

  do {
    let res: OmieMovResponse
    try {
      res = await omieRequest<OmieMovResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        is_test: loja.is_test,
        endpoint: 'v1/estoque/movestoque',
        call: 'ListarMovimentos',
        data: {
          pagina,
          registros_por_pagina: 100,
          data_inicial: dataInicial,
          data_final: dataFinal,
          ordenar_por: 'CODIGO',
        },
      })
    } catch (e) {
      // "Nao existem registros para a pagina" => acabou (ou periodo vazio)
      const msg = e instanceof Error ? e.message : String(e)
      if (/não existem registros|nao existem registros/i.test(msg)) break
      throw e
    }

    totalPaginas = res.total_de_paginas || 1
    for (const c of res.cadastros ?? []) {
      let total = 0
      for (const m of c.movimentos ?? []) total += m.nQtdeSaidas ?? 0
      if (total > 0) saidas.set(c.nCodProd, (saidas.get(c.nCodProd) ?? 0) + total)
    }
    pagina++
  } while (pagina <= totalPaginas)

  return saidas
}
