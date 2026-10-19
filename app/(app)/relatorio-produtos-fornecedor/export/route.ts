import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'
import { carregarProdutosFornecedor, lerOpcoesPF } from '@/lib/relatorios/produtos-fornecedor-loader'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { modoDaLoja } from '@/lib/estoque/ledger'

export const dynamic = 'force-dynamic'

const dataBR = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

// Mesmas colunas do "Produtos por Fornecedor" do Omie (ERP_PRD_FOR_FORNECEDOR), todas as linhas do filtro.
export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) === 'nenhum') return new Response('Esta loja não controla estoque', { status: 404 })
  const op = lerOpcoesPF(Object.fromEntries(new URL(request.url).searchParams.entries()))
  const { linhas, erros } = await carregarProdutosFornecedor(lojaId, op)
  if (!linhas.length) return new Response('Sem dados no filtro selecionado', { status: 404 })
  const rows = linhas.map((l) => ({
    codigo: l.codigo, produto: l.descricao, familia: l.familia, tipo: rotuloTipo(l.tipo), inativo: l.inativo ? 'Sim' : 'Não',
    fornecedor: l.fornecedor, fantasia: l.fornecedor_fantasia ?? '', codForn: l.codigo_fornecedor ?? '',
    data: dataBR(l.ultima_data), nota: l.ultima_nota ?? '', qtde: Number(l.qtde) || 0, unidade: l.unidade ?? '',
    preco: Number(l.preco_unit) || 0, total: Number(l.total) || 0, custo: Number(l.custo_unit) || 0,
    custoMedio: l.custoMedio ?? '', estoque: l.estoque, compras: l.compras, totalComprado: Number(l.total_comprado) || 0, primeira: dataBR(l.primeira_data),
  }))
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'codigo', label: 'Código do produto', tipo: 'texto', largura: 12 },
      { key: 'produto', label: 'Produto', tipo: 'texto', largura: 40 },
      { key: 'familia', label: 'Família', tipo: 'texto', largura: 22 },
      { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 22 },
      { key: 'inativo', label: 'Inativo', tipo: 'texto', largura: 8 },
      { key: 'fornecedor', label: 'Fornecedor', tipo: 'texto', largura: 36 },
      { key: 'fantasia', label: 'Nome fantasia', tipo: 'texto', largura: 26 },
      { key: 'codForn', label: 'Código do fornecedor para o produto', tipo: 'texto', largura: 16 },
      { key: 'data', label: 'Data da última compra', tipo: 'texto', largura: 12 },
      { key: 'nota', label: 'Nota da última compra', tipo: 'texto', largura: 12 },
      { key: 'qtde', label: 'Quantidade da última compra', tipo: 'numero', largura: 12 },
      { key: 'unidade', label: 'Unidade', tipo: 'texto', largura: 8 },
      { key: 'preco', label: 'Preço unitário da última compra', tipo: 'moeda', largura: 14 },
      { key: 'total', label: 'Preço total da última compra', tipo: 'moeda', largura: 14, somar: true },
      { key: 'custo', label: 'Custo do item na última compra', tipo: 'moeda', largura: 14 },
      { key: 'custoMedio', label: 'Custo médio atual', tipo: 'moeda', largura: 14 },
      { key: 'estoque', label: 'Estoque atual', tipo: 'numero', largura: 12 },
      { key: 'compras', label: 'Nº de compras', tipo: 'numero', largura: 10 },
      { key: 'totalComprado', label: 'Total comprado', tipo: 'moeda', largura: 14, somar: true },
      { key: 'primeira', label: 'Primeira compra', tipo: 'texto', largura: 12 },
    ],
    opts: {
      titulo: 'Produtos por fornecedor',
      subtitulo: `Última compra por produto e fornecedor (quantidade e preço na unidade de estoque)${erros.length ? ` · ATENÇÃO: falha ao ler ${erros.join(', ')}` : ''}`,
      autoFiltro: true,
    },
    nome: 'Produtos por fornecedor',
  }])
  return planilhaResponse('produtos-por-fornecedor', buffer)
}
