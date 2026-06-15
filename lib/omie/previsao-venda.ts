import { buscarSaidasPeriodo } from './movimento'
import { createServiceClient } from '@/lib/supabase/server'
import { logIntegrationAttempt, type LojaOmie } from './client'

function fmtBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Calcula a previsao de venda da PROXIMA SEMANA por produto, a partir das saidas
 * de estoque no mesmo periodo do ANO ANTERIOR (ListarMovimentos). Grava em previsao_venda.
 */
export async function syncPrevisaoVenda(loja: LojaOmie) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const fim = new Date(hoje)
  fim.setDate(fim.getDate() + 7) // proxima semana

  const iniAnt = new Date(hoje)
  iniAnt.setFullYear(iniAnt.getFullYear() - 1)
  const fimAnt = new Date(fim)
  fimAnt.setFullYear(fimAnt.getFullYear() - 1)

  const supabase = createServiceClient()

  try {
    const saidas = await buscarSaidasPeriodo(loja, fmtBR(iniAnt), fmtBR(fimAnt))

    const periodoIni = isoDate(iniAnt)
    const periodoFim = isoDate(fimAnt)
    const rows = [...saidas.entries()].map(([nCodProd, qtde]) => ({
      loja_id: loja.id,
      n_cod_prod: nCodProd,
      qtde,
      periodo_ini: periodoIni,
      periodo_fim: periodoFim,
      updated_at: new Date().toISOString(),
    }))

    // Substitui as previsoes da loja pelas novas (produto sem saida fica sem registro = 0)
    await supabase.from('previsao_venda').delete().eq('loja_id', loja.id)
    if (rows.length) {
      await supabase.from('previsao_venda').upsert(rows, { onConflict: 'loja_id,n_cod_prod' })
    }

    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'PrevisaoVenda',
      request: JSON.stringify({ de: fmtBR(iniAnt), ate: fmtBR(fimAnt) }),
      response: JSON.stringify({ produtos: rows.length }),
      code: '200',
    })

    return rows.length
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'PrevisaoVenda',
      request: 'syncPrevisaoVenda',
      error: true,
      error_message: msg,
    })
    throw e
  }
}
