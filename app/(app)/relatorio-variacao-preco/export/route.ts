import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { ehDesenvolvedor } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilhaMulti, planilhaResponse, type AbaPlanilha } from '@/lib/excel'
import { carregarVariacaoPreco, limiteVariacaoPreco } from '@/lib/estoque/consumo-perdas-loader'
import { alertasDaLista } from '@/lib/compras/variacao-preco-puro'
import { lerFiltroVariacao } from '../filtro'

export const dynamic = 'force-dynamic'

const fmtData = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

export async function GET(request: Request) {
  if (!(await ehDesenvolvedor())) return new Response('Não encontrado', { status: 404 })
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new Response('Relatório das lojas com estoque próprio', { status: 400 })
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const { p, ver } = lerFiltroVariacao(sp, hojeBahiaISO())
  const [cfg, d] = await Promise.all([limiteVariacaoPreco(lojaId), carregarVariacaoPreco(lojaId, { ini: p.ini, fim: p.fim })])
  const erros = [cfg.aviso, d.erro].filter((e): e is string => !!e)
  if (erros.length) return new Response(erros.join('\n'), { status: 500 })

  const todos = alertasDaLista(d.linhas, cfg.limite)
  const alertas = ver ? todos.filter((a) => a.alerta.sentido === ver) : todos
  const rows = alertas.map((a) => ({
    data: fmtData(a.data),
    nota: a.numero ?? String(a.compraId),
    fornecedor: a.fornecedor ?? 'sem fornecedor',
    situacao: a.status,
    produto: a.descricao ?? String(a.produto),
    precoBase: a.precoBase,
    precoAnterior: a.precoAnterior,
    fonte: a.fonte === 'cmc' ? 'Custo médio' : 'Última compra',
    variacao: Math.round(a.alerta.pct * 10) / 10,
    sentido: a.alerta.sentido === 'subiu' ? 'Subiu' : 'Caiu',
  }))
  const aba: AbaPlanilha = {
    rows, nome: 'Variação de preço',
    colunas: [
      { key: 'data', label: 'Data' },
      { key: 'nota', label: 'Nota' },
      { key: 'fornecedor', label: 'Fornecedor', largura: 32 },
      { key: 'situacao', label: 'Situação da nota' },
      { key: 'produto', label: 'Produto', largura: 38 },
      { key: 'precoBase', label: 'Preço agora', tipo: 'moeda' },
      { key: 'precoAnterior', label: 'Preço antes', tipo: 'moeda' },
      { key: 'fonte', label: 'Comparado com' },
      { key: 'variacao', label: 'Variação %', tipo: 'numero' },
      { key: 'sentido', label: 'Sentido' },
    ],
    opts: {
      titulo: 'Variação de preço nas notas',
      subtitulo: `${p.ini} a ${p.fim} · limite ${cfg.limite.toLocaleString('pt-BR')}%${ver ? ` · só os que ${ver === 'subiu' ? 'subiram' : 'caíram'}` : ''}`,
      autoFiltro: true,
    },
  }
  return planilhaResponse(`variacao-preco-${p.ini}-${p.fim}.xlsx`, await gerarPlanilhaMulti([aba]))
}
