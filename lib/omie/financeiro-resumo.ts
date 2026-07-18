// Card financeiro "hoje" (relatorio-indicadores): 1 chamada ao vivo ao Omie,
// sem sync nem tabela nova. Nunca lanca erro -- se o Omie falhar (rede, rate
// limit, credencial), devolve null e o card simplesmente nao aparece (mesmo
// principio de buscarFrio/gravarFatoNoFrio: nunca quebrar a pagina por causa
// de uma fonte auxiliar).
import { omieRequest, type LojaOmie } from './client'
import { dataOmieBR } from '@/lib/data-bahia'

export type ResumoFinanceiroHoje = {
  contaCorrente: { vTotal: number }
  contaPagar: { nTotal: number; vAtraso: number; vTotal: number }
  contaReceber: { nTotal: number; vAtraso: number; vTotal: number }
  fluxoCaixa: { dDia: string; vPagar: number; vReceber: number; vSaldo: number }[]
}

export async function buscarResumoFinanceiroHoje(loja: LojaOmie): Promise<ResumoFinanceiroHoje | null> {
  try {
    const r = await omieRequest<ResumoFinanceiroHoje>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      endpoint: 'v1/financas/resumo',
      call: 'ObterResumoFinancas',
      data: { dDia: dataOmieBR(null) },
    })
    if (!r?.contaCorrente) return null
    return r
  } catch (e) {
    console.error('financeiro-resumo: falha ao consultar ObterResumoFinancas', e)
    return null
  }
}
