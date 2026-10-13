// Kardex do Omie (estoque/consulta ListarMovimentoEstoque): busca de 1 produto em 1 local.
import { omieRequest, type LojaOmie } from './client'
import type { MovOmie } from '@/lib/estoque/kardex-omie-puro'

export { normalizarMovOmie, marcarSaltosCmc, type MovOmie, type LinhaKardexOmie } from '@/lib/estoque/kardex-omie-puro'

type RespMov = { nTotPaginas?: number; movProdutoListar?: MovOmie[] }

/** Movimentos de 1 produto em 1 local no período (dd/mm/aaaa, até ~55 dias: o Omie corta perto de 60 sem avisar). */
export async function buscarKardexOmie(loja: LojaOmie, idProd: number, codigoLocal: number, dIni: string, dFim: string): Promise<MovOmie[]> {
  const out: MovOmie[] = []
  let pagina = 1, total = 1
  do {
    let r: RespMov
    try {
      r = await omieRequest<RespMov>({
        loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
        endpoint: 'v1/estoque/consulta', call: 'ListarMovimentoEstoque',
        data: { nPagina: pagina, nRegPorPagina: 100, dDtInicial: dIni, dDtFinal: dFim, codigo_local_estoque: codigoLocal, idProd },
      })
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e instanceof Error ? e.message : String(e))) break
      throw e
    }
    total = r.nTotPaginas || 1
    out.push(...(r.movProdutoListar ?? []))
    pagina++
  } while (pagina <= total)
  return out
}
