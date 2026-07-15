import { buscarSaidasPeriodo } from './movimento'
import { createServiceClient } from '@/lib/supabase/server'
import { logIntegrationAttempt, type LojaOmie } from './client'

const JANELAS_DIAS = [7, 15, 30] as const

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
 * Calcula a previsao de venda das proximas janelas (7/15/30 dias) por produto,
 * a partir das saidas de estoque no mesmo periodo do ANO ANTERIOR
 * (ListarMovimentos). Grava uma linha por (produto, janela) em previsao_venda.
 */
export async function syncPrevisaoVenda(loja: LojaOmie) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const supabase = createServiceClient()
  const rows: {
    loja_id: number
    n_cod_prod: number
    qtde: number
    janela_dias: number
    periodo_ini: string
    periodo_fim: string
    updated_at: string
  }[] = []

  try {
    for (const janela of JANELAS_DIAS) {
      const fim = new Date(hoje)
      fim.setDate(fim.getDate() + janela)

      const iniAnt = new Date(hoje)
      iniAnt.setFullYear(iniAnt.getFullYear() - 1)
      const fimAnt = new Date(fim)
      fimAnt.setFullYear(fimAnt.getFullYear() - 1)

      const saidas = await buscarSaidasPeriodo(loja, fmtBR(iniAnt), fmtBR(fimAnt))

      // Triangulacao: produto que trocou de marca/fornecedor (ex.: Heineken ->
      // Spaten) nao tem venda propria no periodo comparado -- usa o historico
      // do produto substituto cadastrado em produto_substituicoes, se houver.
      const { data: substituicoes } = await supabase
        .from('produto_substituicoes')
        .select('n_cod_prod, substitui_n_cod_prod')
        .eq('loja_id', loja.id)

      for (const sub of substituicoes ?? []) {
        const proprio = saidas.get(sub.n_cod_prod)
        if (proprio == null || proprio === 0) {
          const doSubstituto = saidas.get(sub.substitui_n_cod_prod)
          if (doSubstituto != null) saidas.set(sub.n_cod_prod, doSubstituto)
        }
      }

      const periodoIni = isoDate(iniAnt)
      const periodoFim = isoDate(fimAnt)
      for (const [nCodProd, qtde] of saidas.entries()) {
        rows.push({
          loja_id: loja.id,
          n_cod_prod: nCodProd,
          qtde,
          janela_dias: janela,
          periodo_ini: periodoIni,
          periodo_fim: periodoFim,
          updated_at: new Date().toISOString(),
        })
      }
    }

    // Substitui as previsoes da loja pelas novas (produto sem saida fica sem registro = 0)
    await supabase.from('previsao_venda').delete().eq('loja_id', loja.id)
    if (rows.length) {
      await supabase.from('previsao_venda').upsert(rows, { onConflict: 'loja_id,n_cod_prod,janela_dias' })
    }

    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'PrevisaoVenda',
      request: JSON.stringify({ janelas: JANELAS_DIAS }),
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
