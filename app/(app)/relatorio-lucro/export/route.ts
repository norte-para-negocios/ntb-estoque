import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'
import { carregarLucro, lerFiltro, DIMS_LUCRO } from '../dados'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Relatório das lojas com estoque próprio', { status: 400 })
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const f = lerFiltro(sp)
  const d = await carregarLucro(lojaId, f)
  const colunas = [
    { key: 'rotulo', label: DIMS_LUCRO.find((x) => x.value === f.dim)?.label ?? 'Item', largura: 38 },
    { key: 'quantidade', label: 'Qtde', tipo: 'numero' as const, somar: true },
    { key: 'faturamento', label: 'Faturamento', tipo: 'moeda' as const, somar: true },
    { key: 'cmv', label: 'Custo (CMV)', tipo: 'moeda' as const, somar: true },
    { key: 'lucro', label: 'Lucro', tipo: 'moeda' as const, somar: true },
    { key: 'margem', label: 'Margem %', tipo: 'numero' as const },
    { key: 'sinal', label: 'Atenção', largura: 22 },
  ]
  const rows = d.linhas.map((l) => ({ ...l, sinal: l.itens_sem_baixa > 0 ? 'Sem baixa de estoque' : l.itens_sem_custo > 0 ? 'Saiu com custo zero' : '' }))
  const aba: AbaPlanilha = { rows, colunas, opts: { titulo: 'Lucro', subtitulo: `${f.ini} a ${f.fim} · agrupado por ${DIMS_LUCRO.find((x) => x.value === f.dim)?.label?.toLowerCase()}`, autoFiltro: true }, nome: 'Lucro' }
  return planilhaResponse(`lucro-${f.ini}-${f.fim}.xlsx`, await gerarPlanilhaMulti([aba]))
}
