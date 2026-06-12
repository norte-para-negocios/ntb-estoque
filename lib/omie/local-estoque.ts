import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'

interface OmieLocal {
  codigo_local_estoque: number
  codigo: string
  descricao: string
  tipo: string
  padrao: string
  inativo: string
  dispOrdemProducao: string
  dispConsumoOP: string
  dispRemessa: string
  dispVenda: string
  dInc: string
  hInc: string
  uInc: string
  dAlt: string
  hAlt: string
  uAlt: string
}

interface OmieLocaisResponse {
  nPagina: number
  nTotPaginas: number
  locaisEncontrados?: OmieLocal[]
}

export async function syncLocaisEstoque(loja: LojaOmie) {
  const supabase = createServiceClient()
  await supabase.from('lojas').update({ local_estoque_status: 'Processando' }).eq('id', loja.id)

  try {
    let pagina = 1
    let totalPaginas = 1

    do {
      const res = await omieRequest<OmieLocaisResponse>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/estoque/local',
        call: 'ListarLocaisEstoque',
        data: { nPagina: pagina, nRegPorPagina: 1000 },
      })

      totalPaginas = res.nTotPaginas || 1
      const locais = res.locaisEncontrados ?? []

      if (locais.length) {
        const rows = locais.map((l) => ({
          loja_id: loja.id,
          codigo_local_estoque: l.codigo_local_estoque,
          codigo: l.codigo,
          descricao: l.descricao,
          tipo: l.tipo,
          padrao: l.padrao,
          inativo: l.inativo,
          disp_ordem_producao: l.dispOrdemProducao,
          disp_consumo_op: l.dispConsumoOP,
          disp_remessa: l.dispRemessa,
          disp_venda: l.dispVenda,
          d_inc: l.dInc,
          h_inc: l.hInc,
          u_inc: l.uInc,
          d_alt: l.dAlt,
          h_alt: l.hAlt,
          u_alt: l.uAlt,
          full_object: l,
          updated_at: new Date().toISOString(),
        }))
        await supabase
          .from('local_estoques')
          .upsert(rows, { onConflict: 'loja_id,codigo_local_estoque' })
      }

      pagina++
    } while (pagina <= totalPaginas)

    await supabase
      .from('lojas')
      .update({
        local_estoque_status: 'Concluido',
        local_estoque_ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', loja.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase.from('lojas').update({ local_estoque_status: 'Erro' }).eq('id', loja.id)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'LocalEstoque',
      request: 'syncLocaisEstoque',
      error: true,
      error_message: msg,
    })
    throw e
  }
}
