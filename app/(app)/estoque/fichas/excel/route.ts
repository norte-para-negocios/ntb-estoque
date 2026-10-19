import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'
import { explodirEstrutura, type ItemFicha } from '@/lib/relatorios/estrutura-puro'
import { carregarCustoESaldo } from '@/lib/relatorios/custo-medio-loader'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { carregarFichasDaLoja } from '../dados'
import { carregarLocais, carregarProdutosMin } from '../../dados-produtos'

export const dynamic = 'force-dynamic'

// "Estrutura dos Produtos" do Omie (ERP_ESTRUTURA_TODOS): cada prato com os itens da ficha e, logo abaixo de cada
// produto intermediário, os itens da ficha dele (quantidade já no prato). Custo = custo médio de hoje × quantidade.
export async function GET() {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'omie' && modo !== 'proprio') return new Response('Esta loja não controla estoque', { status: 404 })
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return new Response('Sem permissão', { status: 403 })
  const erros: string[] = []
  const [{ linhas, avisos }, produtos, locais, { custo }] = await Promise.all([
    carregarFichasDaLoja(lojaId, modo), carregarProdutosMin(lojaId), carregarLocais(lojaId), carregarCustoESaldo(lojaId, (o) => erros.push(o)),
  ])
  if (!linhas.length) return new Response('Nenhuma ficha técnica lida nesta loja', { status: 404 })

  const fichas = new Map<number, ItemFicha[]>()
  const localDe = new Map<string, number | null>()
  for (const l of linhas) {
    fichas.set(l.produto, [...(fichas.get(l.produto) ?? []), { insumo: l.insumo, quantidade: l.quantidade, perda: l.perda, unidade: l.unidade }])
    localDe.set(`${l.produto}:${l.insumo}`, l.local)
  }
  const nome = (c: number) => produtos.get(c)?.descricao ?? `Produto ${c}`
  const codigo = (c: number) => produtos.get(c)?.codigo ?? String(c)
  const pratos = [...fichas.keys()].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR'))
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6
  const rows = pratos.flatMap((p) => explodirEstrutura(fichas, p).map((l) => {
    const cu = custo.get(l.insumo) ?? null
    const local = l.nivel === 1 ? localDe.get(`${p}:${l.insumo}`) ?? null : null
    return {
      codProduto: codigo(p), produto: nome(p), tipoProduto: rotuloTipo(produtos.get(p)?.tipo_item ?? ''), unProduto: produtos.get(p)?.unidade ?? '',
      inativo: produtos.get(p)?.inativo ? 'Sim' : 'Não', nivel: l.nivel, ordem: l.ordem, posicao: l.caminho,
      codItem: codigo(l.insumo), item: `${'  '.repeat(l.nivel - 1)}${nome(l.insumo)}${l.ciclo ? ' (repete: ficha em ciclo)' : ''}`,
      tipoItem: rotuloTipo(produtos.get(l.insumo)?.tipo_item ?? ''), quantidade: l.quantidade, unItem: produtos.get(l.insumo)?.unidade ?? l.unidade ?? '',
      perda: l.perda, custoUnit: cu ?? '', custoTotal: cu == null ? '' : r6(cu * l.quantidade),
      local: local == null ? '' : locais.get(local) ?? String(local), intermediario: l.temFicha ? 'Sim' : '',
    }
  }))
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'codProduto', label: 'Código do produto', tipo: 'texto', largura: 12 },
      { key: 'produto', label: 'Produto', tipo: 'texto', largura: 36 },
      { key: 'tipoProduto', label: 'Tipo do produto', tipo: 'texto', largura: 20 },
      { key: 'unProduto', label: 'Unidade do produto', tipo: 'texto', largura: 8 },
      { key: 'inativo', label: 'Inativo', tipo: 'texto', largura: 8 },
      { key: 'nivel', label: 'Nível', tipo: 'numero', largura: 6 },
      { key: 'ordem', label: 'Ordem', tipo: 'numero', largura: 6 },
      { key: 'posicao', label: 'Posição', tipo: 'texto', largura: 8 },
      { key: 'codItem', label: 'Código do item', tipo: 'texto', largura: 12 },
      { key: 'item', label: 'Item', tipo: 'texto', largura: 40 },
      { key: 'tipoItem', label: 'Tipo do item', tipo: 'texto', largura: 20 },
      { key: 'quantidade', label: 'Quantidade do item (no produto)', tipo: 'numero', largura: 14 },
      { key: 'unItem', label: 'Unidade do item', tipo: 'texto', largura: 8 },
      { key: 'perda', label: '% de perda', tipo: 'numero', largura: 8 },
      { key: 'custoUnit', label: 'Custo unitário do item (médio hoje)', tipo: 'moeda', largura: 14 },
      { key: 'custoTotal', label: 'Custo total do item', tipo: 'moeda', largura: 14 },
      { key: 'local', label: 'Local de consumo', tipo: 'texto', largura: 18 },
      { key: 'intermediario', label: 'Tem ficha própria', tipo: 'texto', largura: 10 },
    ],
    opts: {
      titulo: 'Estrutura dos produtos',
      subtitulo: `${pratos.length} produtos com ficha · itens dos produtos intermediários abertos logo abaixo deles, com a quantidade no produto${[...avisos, ...(erros.length ? [`falha ao ler ${erros.join(', ')}`] : [])].map((a) => ` · ${a}`).join('')}`,
      autoFiltro: true,
    },
    nome: 'Estrutura',
  }])
  return planilhaResponse('estrutura-dos-produtos', buffer)
}
