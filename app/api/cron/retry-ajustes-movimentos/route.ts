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
//
// limitePorLoja 30->10 nas duas chamadas (Important #3, auditoria 2026-08-09/10):
// com 30+30 sequencial, esta rota estourava o timeout de 120s do `curl -m 120` de
// scripts/sync-cron.sh EM TODO CICLO desde o deploy (log sempre "000ERR"). Reduzir
// so uma das duas chamadas nao encurtaria o tempo total da rota o suficiente --
// as duas rodam sequencial dentro da mesma requisicao. Ver tambem o aumento de
// `-m 120` -> `-m 240` em sync-cron.sh (mitigacao complementar).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  // Sequencial (nao Promise.all) -- mesmo espirito comedido do resto do retry
  // automatico: as duas chamadas batem no Omie, sem motivo pra paralelizar.
  const resultadosTransferencia = await retryMovimentosTransferenciaPendentes(lojas, { limitePorLoja: 10 })
  const resultadosManuais = await retryMovimentosManuaisPendentes(lojas, { limitePorLoja: 10 })
  const resultados = [...resultadosTransferencia, ...resultadosManuais]
  const tentadas = resultados.reduce((acc, r) => acc + r.tentadas, 0)
  const sucesso = resultados.reduce((acc, r) => acc + r.sucesso, 0)
  const falhas = resultados.reduce((acc, r) => acc + r.falhas, 0)
  // 502 quando houve trabalho de verdade (algo pendente ou erro de query, em
  // qualquer uma das duas origens) e NENHUM sucesso real (Important #4, mesmo
  // padrao ja aplicado em snapshot-margem-diario/sync-preco-movimentacao nesta
  // mesma auditoria). Um ciclo sem nada pendente e o caso saudavel mais comum --
  // nao pode virar 502 so por falta de trabalho.
  const houveTrabalhoOuErro = tentadas > 0 || resultados.some((r) => r.erro)
  const falhaTotal = houveTrabalhoOuErro && sucesso === 0
  return NextResponse.json(
    {
      lojas: lojas.length,
      tentadas,
      sucesso,
      falhas,
      transferencia: resultadosTransferencia,
      manuais: resultadosManuais,
    },
    { status: falhaTotal ? 502 : 200 }
  )
}
