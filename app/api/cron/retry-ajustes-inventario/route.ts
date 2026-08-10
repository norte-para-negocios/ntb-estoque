import { NextResponse } from 'next/server'
import { retryAjustesInventarioPendentes } from '@/lib/actions/inventario'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 300

// limitePorLoja 30->10 (Important #3, auditoria 2026-08-09/10): com 30, esta rota
// estourava o timeout de 120s do `curl -m 120` de scripts/sync-cron.sh EM TODO
// CICLO desde o deploy (log sempre "000ERR", indistinguivel de falha real). 10
// encurta o tempo de execucao por ciclo; ver tambem o aumento de `-m 120` -> `-m
// 240` em sync-cron.sh (mitigacao complementar, nao substitui esta reducao).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const lojas = await getLojasAtivas()
  const resultados = await retryAjustesInventarioPendentes(lojas, { limitePorLoja: 10 })
  const tentadas = resultados.reduce((acc, r) => acc + r.tentadas, 0)
  const sucesso = resultados.reduce((acc, r) => acc + r.sucesso, 0)
  const falhas = resultados.reduce((acc, r) => acc + r.falhas, 0)
  // 502 quando houve trabalho de verdade (algo pendente ou erro de query) e
  // NENHUM sucesso real (Important #4, mesmo padrao ja aplicado em
  // snapshot-margem-diario/sync-preco-movimentacao nesta mesma auditoria).
  // Cuidado: um ciclo sem NADA pendente (tentadas=0, sem erro de query em nenhuma
  // loja) e o caso saudavel mais comum -- nao pode virar 502 so por falta de
  // trabalho, senao a maioria dos ciclos vira alarme falso.
  const houveTrabalhoOuErro = tentadas > 0 || resultados.some((r) => r.erro)
  const falhaTotal = houveTrabalhoOuErro && sucesso === 0
  return NextResponse.json(
    { lojas: lojas.length, tentadas, sucesso, falhas, resultados },
    { status: falhaTotal ? 502 : 200 }
  )
}
