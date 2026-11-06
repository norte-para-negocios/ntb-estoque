import { acessoFinanceiro, PERM } from '@/lib/financeiro/dados'
import { carregarDre } from '@/lib/financeiro/dre-carregar'
import { ROTULO_LINHA, type CodigoFora } from '@/lib/financeiro/dre-puro'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'

export const dynamic = 'force-dynamic'
const FORA: CodigoFora[] = ['fora_compras_estoque', 'fora_investimento', 'fora_sem_categoria']

// DRE em Excel: mesmas regras e mesmos números da tela (só dev, estoque próprio, permissão de contas correntes).
export async function GET(request: Request) {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { meses, consolidada, lojas, dre, erro } = await carregarDre(lojaId, sp)
  if (erro) return new Response(erro, { status: 500 })
  const receita = dre.linhas.find((l) => l.codigo === 'receita_bruta')?.total ?? 0
  const colunas = [
    { key: 'linha', label: 'Linha', largura: 34 },
    ...meses.map((m) => ({ key: m, label: `${m.slice(5)}/${m.slice(0, 4)}`, tipo: 'moeda' as const })),
    ...(meses.length > 1 ? [{ key: 'total', label: 'Total', tipo: 'moeda' as const }] : []),
    { key: 'pct', label: '% da receita', tipo: 'numero' as const },
  ]
  const rows: Record<string, unknown>[] = dre.linhas.map((l) => ({
    linha: l.nivel === 'base' ? `  ${l.rotulo}` : l.rotulo,
    ...Object.fromEntries(meses.map((m) => [m, l.valores[m]])),
    total: l.total,
    pct: l.total == null || !receita ? null : Math.round((l.total / receita) * 1000) / 10,
  }))
  rows.push({ linha: '' }, { linha: 'Fora da DRE (para conferência)' })
  for (const f of FORA) {
    rows.push({
      linha: `  ${ROTULO_LINHA[f]}`,
      ...Object.fromEntries(meses.map((m) => [m, dre.fora[f][m]])),
      total: Math.round(meses.reduce((s, m) => s + dre.fora[f][m], 0) * 100) / 100,
    })
  }
  const escopo = consolidada ? `consolidada (${lojas.map((l) => l.nome).join(', ')})` : 'esta loja'
  const aba: AbaPlanilha = { rows, colunas, nome: 'DRE', opts: { titulo: 'DRE por competência', subtitulo: `${meses[0]} a ${meses[meses.length - 1]} · ${escopo}` } }
  return planilhaResponse(`dre-${meses[0]}-${meses[meses.length - 1]}${consolidada ? '-consolidada' : ''}.xlsx`, await gerarPlanilhaMulti([aba]))
}
