import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'
import { lerParamsFaturamento } from '@/lib/faturamento-params'
import { carregarItens } from '@/lib/faturamento-itens-loader'
import { filtrarPorNome, ordenarRanking, rankear, type Dimensao } from '@/lib/faturamento-itens'

export const dynamic = 'force-dynamic'
const POR_ABA: Record<string, { dim: Dimensao; nome: string }> = {
  produtos: { dim: 'produto', nome: 'Produtos' }, familias: { dim: 'familia', nome: 'Famílias' }, tipos: { dim: 'tipo', nome: 'Tipos' },
}

export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const p = lerParamsFaturamento(sp, hojeBahiaISO())
  const alvo = POR_ABA[p.aba] ?? POR_ABA.produtos
  const { linhas, aviso } = await carregarItens(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias, situacao: p.situacao })
  const rows = ordenarRanking(filtrarPorNome(rankear(linhas, alvo.dim), p.q), p.ordem, p.sentido)
    .map((r, i) => ({ pos: i + 1, rotulo: r.rotulo, valor: r.valor, quant: r.quant, cupons: r.cupons, pct: r.pct }))
  if (!rows.length) return new Response('Sem vendas no período/filtro selecionado', { status: 404 })
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'pos', label: '#', tipo: 'numero', largura: 6 },
      { key: 'rotulo', label: alvo.nome.replace(/s$/, ''), tipo: 'texto', largura: 44 },
      { key: 'valor', label: 'Faturamento', tipo: 'moeda', largura: 18, somar: true },
      { key: 'quant', label: 'Quantidade', tipo: 'numero', largura: 14, somar: true },
      { key: 'cupons', label: 'Cupons', tipo: 'numero', largura: 10 },
      { key: 'pct', label: '% do total', tipo: 'numero', largura: 12 },
    ],
    opts: { titulo: `Faturamento por ${alvo.nome.toLowerCase()}`, subtitulo: `${p.ini} a ${p.fim}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}`, autoFiltro: true },
    nome: alvo.nome,
  }])
  return planilhaResponse('faturamento', buffer)
}
