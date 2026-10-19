import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilha, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { carregarSugestao, lerParamsSugestao } from '@/lib/compras/sugestao-dados'
import { filtrarSugestao } from '@/lib/compras/sugestao-puro'

// Excel da Sugestão de compra: as colunas do grid do Omie, com os mesmos filtros da tela (sem o corte de linhas).
const COLUNAS: ColunaExcel[] = [
  { key: 'rotulo', label: 'Recomendação', largura: 26 },
  { key: 'fornecedor', label: 'Fornecedor (última nota)', largura: 30 },
  { key: 'codigo', label: 'Produto', largura: 12 },
  { key: 'descricao', label: 'Descrição do produto', largura: 40 },
  { key: 'consumoMedio', label: 'Consumo médio diário', tipo: 'numero' },
  { key: 'consumoTotal', label: 'Consumo total', tipo: 'numero' },
  { key: 'estoqueMinimo', label: 'Estoque mínimo', tipo: 'numero' },
  { key: 'estoqueAtual', label: 'Estoque atual', tipo: 'numero' },
  { key: 'duracao', label: 'Duração do estoque (dias)', tipo: 'numero' },
  { key: 'leadTime', label: 'Lead time (dias)', tipo: 'numero' },
  { key: 'pontoPedido', label: 'Ponto de pedido (quantidade)', tipo: 'numero' },
  { key: 'diasAtePonto', label: 'Ponto de pedido (dias)', tipo: 'numero' },
  { key: 'entradaNf', label: 'Entrada prevista: notas a receber', tipo: 'numero' },
  { key: 'entradaOps', label: 'Entrada prevista: OPs abertas', tipo: 'numero' },
  { key: 'entradaPedidos', label: 'Entrada prevista: pedidos', tipo: 'numero' },
  { key: 'entradaPrevista', label: 'Entrada prevista', tipo: 'numero' },
  { key: 'saidaProjetada', label: 'Saída projetada', tipo: 'numero' },
  { key: 'previsaoVenda', label: 'Previsão de venda no período', tipo: 'numero' },
  { key: 'consumoOps', label: 'Consumo nas OPs abertas', tipo: 'numero' },
  { key: 'sugestao', label: 'Sugestão', tipo: 'numero' },
  { key: 'ultimoCusto', label: 'Último custo', tipo: 'moeda' },
  { key: 'valorEstimado', label: 'Valor estimado', tipo: 'moeda', somar: true },
  { key: 'familia', label: 'Família do produto', largura: 22 },
  { key: 'tipoItem', label: 'Tipo do produto', largura: 8 },
  { key: 'unidade', label: 'Unidade', largura: 8 },
]

export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo === 'nenhum' || !(await requirePermissao(lojaId, 'Compras - Sugestao'))) return new Response('Sem permissão', { status: 403 })
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries())
  const p = lerParamsSugestao(sp, hojeBahiaISO())
  const { linhas, erro } = await carregarSugestao(lojaId, modo, p)
  if (erro) return new Response(erro, { status: 502 })
  const vis = filtrarSugestao(linhas, { q: sp.q, tipos: valoresMulti(sp.tipo), familia: sp.familia, ver: sp.ver, acao: sp.acao, fornecedor: sp.fornecedor })
  const rows = vis.map((l) => ({ ...l, fornecedor: l.fornecedorNome ?? '' }))
  const br = (iso: string) => iso.split('-').reverse().join('/')
  const buf = await gerarPlanilha(rows, COLUNAS, {
    titulo: 'Sugestão de compra',
    subtitulo: `Análise ${br(p.ini)} a ${br(p.fim)} (${p.diasAnalise} dias) · estimativa ${br(p.projIni)} a ${br(p.projFim)} (${p.diasEstimativa} dias) · projeção: ${p.base === 'previsao' ? 'previsão de venda + OPs abertas' : 'consumo médio (Omie)'}`,
    autoFiltro: true,
  })
  return planilhaResponse(`sugestao-compra-${hojeBahiaISO()}`, buf)
}
