import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'
import { CLASSES } from '@/lib/relatorios/engenharia-cardapio-puro'
import { carregarEngenharia } from '@/lib/relatorios/engenharia-cardapio-loader'

export const dynamic = 'force-dynamic'

// Engenharia de cardápio em Excel: os mesmos pratos, grupos e cortes da tela (só dev, estoque próprio).
export async function GET(request: Request) {
  if (!(await ehDesenvolvedor())) return new Response('Não encontrado', { status: 404 })
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Relatório das lojas com estoque próprio', { status: 400 })
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const p = lerPeriodo(sp, hojeBahiaISO(), 366)
  const { erro, familia, r } = await carregarEngenharia(lojaId, p.ini, p.fim, sp.familia)
  if (erro) return new Response(erro, { status: 500 })
  const titulo = (c: string) => CLASSES.find((x) => x.classe === c)?.titulo ?? c
  const pratos: AbaPlanilha = {
    nome: 'Pratos',
    opts: {
      titulo: 'Engenharia de cardápio', autoFiltro: true,
      subtitulo: `${p.ini} a ${p.fim}${familia ? ` · família ${familia}` : ' · todas as famílias'} · vende muito = ${r.corteQuantidade.toFixed(1)} un. ou mais · lucra bem = R$ ${r.corteMargemUnit.toFixed(2)} ou mais por un.`,
    },
    colunas: [
      { key: 'rotulo', label: 'Prato', largura: 40 },
      { key: 'grupo', label: 'Grupo', largura: 28 },
      { key: 'quantidade', label: 'Vendidos', tipo: 'numero', somar: true },
      { key: 'participacao', label: '% das vendas', tipo: 'numero' },
      { key: 'faturamento', label: 'Faturamento', tipo: 'moeda', somar: true },
      { key: 'cmv', label: 'Custo (CMV)', tipo: 'moeda', somar: true },
      { key: 'margemUnit', label: 'Lucro por un.', tipo: 'moeda' },
      { key: 'margemPct', label: 'Margem %', tipo: 'numero' },
      { key: 'lucro', label: 'Lucro', tipo: 'moeda', somar: true },
      { key: 'obs', label: 'Atenção', largura: 30 },
    ],
    rows: r.itens.map((i) => ({ ...i, grupo: titulo(i.classe), obs: i.custoIncompleto ? 'Parte das vendas sem custo' : '' })),
  }
  const semCusto: AbaPlanilha = {
    nome: 'Sem custo', opts: { titulo: 'Vendidos sem custo (fora da conta)' },
    colunas: [
      { key: 'rotulo', label: 'Prato', largura: 40 },
      { key: 'quantidade', label: 'Vendidos', tipo: 'numero', somar: true },
      { key: 'faturamento', label: 'Faturamento', tipo: 'moeda', somar: true },
    ],
    rows: r.semCusto,
  }
  return planilhaResponse(`engenharia-cardapio-${p.ini}-${p.fim}.xlsx`, await gerarPlanilhaMulti(r.semCusto.length ? [pratos, semCusto] : [pratos]))
}
