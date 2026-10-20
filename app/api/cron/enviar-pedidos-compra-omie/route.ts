import { NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { processarFilaPedidosCompraOmie } from '@/lib/omie/pedido-compra-gravar'
import { gravacaoPedidosOmieLigada } from '@/lib/compras/pedido-omie-gravar-puro'

export const maxDuration = 300

// C1 (20/10/2026): reenvia ao Omie os pedidos de compra aprovados que ainda não foram gravados (lojas Omie liberadas).
// NÃO está no scripts/sync-cron.sh: entra lá só na ativação (plano 2026-10-20-c1-pedido-compra-omie.md).
// Com OMIE_GRAVAR_PEDIDOS_COMPRA desligada responde 200 sem ler o banco nem chamar o Omie.
// 502 só quando houve trabalho e nenhuma loja conseguiu enviar nada (mesmo padrão dos outros crons de reenvio).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!gravacaoPedidosOmieLigada(process.env)) return NextResponse.json({ desligado: true })
  try {
    const r = await processarFilaPedidosCompraOmie()
    for (const x of r) if (x.erro || x.parouNoErro) console.error(`enviar-pedidos-compra-omie: loja ${x.loja}: ${x.erro ?? 'parou no 1º erro do ciclo'}`)
    const tentados = r.reduce((a, x) => a + x.tentados, 0)
    const enviados = r.reduce((a, x) => a + x.enviados, 0)
    const houveTrabalho = tentados > 0 || r.some((x) => x.erro)
    return NextResponse.json({ lojas: r.length, tentados, enviados, detalhe: r }, { status: houveTrabalho && enviados === 0 ? 502 : 200 })
  } catch (e) {
    console.error('enviar-pedidos-compra-omie:', e)
    return NextResponse.json({ error: 'falha ao processar a fila' }, { status: 502 })
  }
}
