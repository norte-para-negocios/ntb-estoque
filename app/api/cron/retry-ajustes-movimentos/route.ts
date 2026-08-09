import { NextResponse } from 'next/server'
import { retryMovimentosTransferenciaPendentes } from '@/lib/actions/transferencia'
import { retryMovimentosManuaisPendentes } from '@/lib/actions/movimentacoes'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// Cobre as duas origens de `movimentos` pendente de lancamento no Omie: movimentos
// de transferencia (transferencia_id IS NOT NULL, lib/actions/transferencia.ts) e
// ajustes manuais ENT/SAI (transferencia_id IS NULL, lib/actions/movimentacoes.ts).
// Sao dois fluxos estruturalmente diferentes (o de transferencia precisa do objeto
// pai `trans` completo; o manual so precisa da `loja`) -- por isso duas funcoes de
// retry separadas, chamadas aqui e somadas numa unica resposta.
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  // Sequencial (nao Promise.all) -- mesmo espirito comedido do resto do retry
  // automatico: as duas chamadas batem no Omie, sem motivo pra paralelizar.
  const resultadosTransferencia = await retryMovimentosTransferenciaPendentes(lojas, { limitePorLoja: 30 })
  const resultadosManuais = await retryMovimentosManuaisPendentes(lojas, { limitePorLoja: 30 })
  const resultados = [...resultadosTransferencia, ...resultadosManuais]
  const tentadas = resultados.reduce((acc, r) => acc + r.tentadas, 0)
  const sucesso = resultados.reduce((acc, r) => acc + r.sucesso, 0)
  const falhas = resultados.reduce((acc, r) => acc + r.falhas, 0)
  return NextResponse.json({
    lojas: lojas.length,
    tentadas,
    sucesso,
    falhas,
    transferencia: resultadosTransferencia,
    manuais: resultadosManuais,
  })
}
