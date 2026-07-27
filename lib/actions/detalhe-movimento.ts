'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export type Ingrediente = { cod: number; nome: string; unidade: string; qtd: number }

export type DetalheOP = {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdPlanejada: number | null
  qtdProduzida: number | null
  dataPrevisao: string | null
  dataConclusao: string | null
  concluida: boolean
  podeReverter: boolean
  ingredientes: Ingrediente[]
}

export async function buscarDetalheOP(opId: number): Promise<{ error: string } | DetalheOP> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, identificacao_d_dt_previsao, dt_conclusao_real, concluida, full_object')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!op) return { error: 'Ordem de produção não encontrada.' }

  const { data: prod } = op.identificacao_n_cod_produto
    ? await supabase.from('produtos').select('descricao, unidade').eq('loja_id', lojaId).eq('codigo_produto', op.identificacao_n_cod_produto).maybeSingle()
    : { data: null }

  const itensDetalhes = (op.full_object as { itensDetalhes?: { nIdProdutoMalha: number; nQtde: number }[] } | null)?.itensDetalhes ?? []
  const codsIngrediente = [...new Set(itensDetalhes.map((i) => i.nIdProdutoMalha).filter(Boolean))]
  const { data: ingProds } = codsIngrediente.length
    ? await supabase.from('produtos').select('codigo_produto, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codsIngrediente)
    : { data: [] as { codigo_produto: number; descricao: string; unidade: string }[] }
  const ingMap = new Map((ingProds ?? []).map((p) => [p.codigo_produto, p]))
  const ingredientes: Ingrediente[] = itensDetalhes
    .filter((i) => i.nIdProdutoMalha)
    .map((i) => {
      const p = ingMap.get(i.nIdProdutoMalha)
      return { cod: i.nIdProdutoMalha, nome: formatarNomeProduto(p?.descricao) || `#${i.nIdProdutoMalha}`, unidade: p?.unidade ?? '', qtd: Number(i.nQtde) }
    })

  const podeReverter = await requirePermissao(lojaId, 'Ordens de Producao - Reverter')

  return {
    id: op.id,
    numOP: op.identificacao_c_num_op || op.num_ordem || String(op.id),
    produto: formatarNomeProduto(prod?.descricao) || `Produto ${op.identificacao_n_cod_produto}`,
    unidade: prod?.unidade || 'UN',
    qtdPlanejada: op.identificacao_n_qtde,
    qtdProduzida: op.quantidade,
    dataPrevisao: op.identificacao_d_dt_previsao,
    dataConclusao: op.dt_conclusao_real,
    concluida: !!op.concluida,
    podeReverter,
    ingredientes,
  }
}

export type DetalheTransferencia = {
  id: number
  origem: string
  destino: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/transferencia/ContagemTransferencia').ItemMovimento[]
}

export async function buscarDetalheTransferencia(id: number): Promise<{ error: string } | DetalheTransferencia> {
  return { error: 'not implemented' } // substituído na Task 3
}

export type DetalheNotaFiscal = {
  id: string
  numero: string | null
  razaoSocial: string | null
  dataEmissao: string | null
  valor: number | null
  statusLabel: string
  statusTom: 'ok' | 'warn' | 'err'
  chaveNfe: string | null
  itens: import('@/components/nota-fiscal/ItensNotaFiscal').ItemNF[]
  categorias: { id: number; nome: string }[]
}

export async function buscarDetalheNotaFiscal(id: string): Promise<{ error: string } | DetalheNotaFiscal> {
  return { error: 'not implemented' } // substituído na Task 4
}

export type DetalheInventario = {
  id: number
  local: string
  data: string
  responsavel: string | null
  status: string
  finalizado: boolean
  podeEditar: boolean
  itens: import('@/components/inventario/ContagemInventario').ItemContagem[]
}

export async function buscarDetalheInventario(id: number): Promise<{ error: string } | DetalheInventario> {
  return { error: 'not implemented' } // substituído na Task 5
}
