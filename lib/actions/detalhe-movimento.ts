'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { complementarOrdensProducao, complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
import { statusNF } from '@/lib/nf-status'

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
  const { data: opSupabase } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, identificacao_c_num_op, num_ordem, identificacao_n_cod_produto, identificacao_n_qtde, quantidade, identificacao_d_dt_previsao, dt_conclusao_real, concluida, full_object')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .maybeSingle()

  // OPs mais antigas que 90 dias ja foram podadas do Supabase (so ordens_producao
  // recentes ficam la, historico completo mora no Contabo) -- sem este fallback,
  // clicar numa OP fora da janela quente sempre devolvia "nao encontrada", mesmo
  // ela existindo de verdade. Mesmo padrao de app/(app)/nota-fiscal/[id]/page.tsx.
  const op = opSupabase ?? (await complementarOrdensProducao([], { lojaId, id: opId }))[0] ?? null
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
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const podeEditar = await requirePermissao(lojaId, 'Transferencias - Editar')

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino, status, user_id')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
  if (!trans) return { error: 'Transferência não encontrada.' }

  const { data: responsavel } = trans.user_id
    ? await supabase.from('profiles').select('name').eq('id', trans.user_id).maybeSingle()
    : { data: null }

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id, id_prod, quan, status, descricao_status')
    .eq('transferencia_id', id)
    .order('id')

  const codigos = [...new Set((movimentos ?? []).map((m) => m.id_prod))]
  const { data: produtos } = codigos.length
    ? await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const itens = (movimentos ?? []).map((m) => {
    const p = prodMap.get(m.id_prod)
    return {
      id: m.id,
      id_prod: m.id_prod,
      descricao: formatarNomeProduto(p?.descricao) || `Produto ${m.id_prod}`,
      codigo: p?.codigo || String(m.id_prod),
      unidade: p?.unidade ?? null,
      quan: m.quan,
      status: m.status,
      descricao_status: (m as { descricao_status?: string | null }).descricao_status ?? null,
    }
  })

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_local_estoque', [trans.codigo_local_origem, trans.codigo_local_destino].filter((v): v is number => v != null))
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  return {
    id: trans.id,
    origem: localMap.get(trans.codigo_local_origem) || String(trans.codigo_local_origem),
    destino: localMap.get(trans.codigo_local_destino) || String(trans.codigo_local_destino),
    data: trans.data,
    responsavel: responsavel?.name ?? null,
    status: trans.status,
    finalizado: trans.status === 'Concluido',
    podeEditar,
    itens,
  }
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
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, full_object')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()

  const nf = nfSupabase ?? (await complementarNotasFiscais([], { lojaId, id: Number(id) }))[0] ?? null
  if (!nf) return { error: 'Nota fiscal não encontrada.' }

  const [{ data: itensRaw }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, n_id_receb, n_sequencia, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
    supabase.from('categorias_contabeis').select('id, nome').eq('loja_id', lojaId).eq('ativa', true).order('nome'),
  ])

  const itens = nfSupabase
    ? (itensRaw ?? [])
    : await complementarNotaFiscalItems(itensRaw ?? [], { lojaId, notaFiscalId: Number(id) })

  const st = statusNF(nf.c_etapa, nf.full_object)

  return {
    id: String(nf.id),
    numero: nf.c_numero_nfe,
    razaoSocial: nf.c_razao_social || nf.c_nome,
    dataEmissao: nf.d_emissao_nfe,
    valor: nf.n_valor_nfe,
    statusLabel: st.label,
    statusTom: st.tom,
    chaveNfe: nf.c_chave_nfe,
    itens,
    categorias: categorias ?? [],
  }
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
