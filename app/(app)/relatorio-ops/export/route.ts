import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilhaMulti, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { agregarOps, serieOps, type LinhaOp } from '@/lib/relatorios/ops-periodo-puro'
import { carregarOps, lerParamsOps } from '@/lib/relatorios/ops-periodo-loader'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { modoDaLoja } from '@/lib/estoque/ledger'

export const dynamic = 'force-dynamic'

const dataBR = (iso: string) => iso.split('-').reverse().join('/')

// Produção por produto, matéria-prima consumida e o dia a dia, em três abas, com os filtros da tela.
export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) === 'nenhum') return new Response('Esta loja não controla estoque', { status: 404 })
  const p = lerParamsOps(Object.fromEntries(new URL(request.url).searchParams.entries()), hojeBahiaISO())
  const filtros = { tipos: p.tipos, familias: p.familias, q: p.q }
  const { fonte, produtos, dias, meta, erros } = await carregarOps(lojaId, p.ini, p.fim, filtros)
  if (!produtos.length) return new Response('Sem produção concluída no período', { status: 404 })
  const nomeOps = fonte === 'kardex' ? 'Movimentos' : 'OPs'
  const colunas = (rotulo: string, qtde: string): ColunaExcel[] => [
    { key: 'codigo', label: 'Código', tipo: 'texto', largura: 12 },
    { key: 'rotulo', label: rotulo, tipo: 'texto', largura: 42 },
    { key: 'familia', label: 'Família', tipo: 'texto', largura: 22 },
    { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
    { key: 'qtde', label: qtde, tipo: 'numero', largura: 14 },
    { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 8 },
    { key: 'ops', label: nomeOps, tipo: 'numero', largura: 10, somar: true },
    { key: 'dias', label: 'Dias', tipo: 'numero', largura: 8 },
    { key: 'custo', label: 'Custo', tipo: 'moeda', largura: 14, somar: true },
  ]
  const rows = (ls: LinhaOp[]) => ls.map((l) => ({ ...l, tipo: rotuloTipo(l.tipo), custo: l.custo ?? '' }))
  const sub = `${dataBR(p.ini)} a ${dataBR(p.fim)} · fonte: ${fonte === 'kardex' ? 'kardex do Omie' : fonte === 'proprio' ? 'OPs do app' : 'OPs sincronizadas do Omie'}${erros.length ? ` · ATENÇÃO: falha ao ler ${erros.join(', ')}` : ''}`
  const buffer = await gerarPlanilhaMulti([
    { rows: rows(agregarOps(produtos, meta, 'produzido', filtros)), colunas: colunas('Produto', 'Quantidade produzida'), opts: { titulo: 'Produção por produto', subtitulo: sub, autoFiltro: true }, nome: 'Produzidos' },
    { rows: rows(agregarOps(produtos, meta, 'consumido', filtros)), colunas: colunas('Insumo', 'Quantidade consumida'), opts: { titulo: 'Matéria-prima consumida', subtitulo: sub, autoFiltro: true }, nome: 'Consumidos' },
    {
      rows: serieOps(dias, p.ini, p.fim).map((d) => ({ dia: dataBR(d.dia), ops: d.ops, qtde: d.qtde })),
      colunas: [{ key: 'dia', label: 'Dia', tipo: 'texto', largura: 12 }, { key: 'ops', label: nomeOps, tipo: 'numero', somar: true }, { key: 'qtde', label: 'Quantidade produzida (unidades misturadas)', tipo: 'numero' }],
      opts: { titulo: 'Produção por dia', subtitulo: sub }, nome: 'Por dia',
    },
  ])
  return planilhaResponse('producao-por-produto', buffer)
}
