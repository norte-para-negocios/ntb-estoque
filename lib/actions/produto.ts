'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { incluirProduto, alterarProduto, excluirProdutoOmie } from '@/lib/omie/produto'
import { registrarAuditoria } from '@/lib/auditoria'
import { FAIXA_CODIGO_POR_TIPO } from '@/lib/constants-omie'
import type { LojaOmie } from '@/lib/omie/client'

// Familias existentes na loja (codigo + descricao), para o seletor do cadastro.
// Busca da tabela `familias` (fonte da verdade), nao de produtos: assim familias
// recem-criadas localmente ja aparecem no select antes de ter qualquer produto vinculado.
// Inclui familias sem codigo_familia (origem=local) com codigo negativo temporario para
// o select funcionar; apenas familias com codigo_familia > 0 sao enviadas ao Omie.
export async function buscarFamilias(): Promise<{ codigo: number; descricao: string }[]> {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('familias')
    .select('id, codigo_familia, nome')
    .eq('loja_id', lojaId)
    .eq('inativo', false)
    .order('nome')
  return (data ?? []).map((f) => ({
    // codigo_familia (do Omie) quando disponivel; sen~ao usa o id local negativo
    // para nao colidir com codigos reais do Omie (sempre positivos).
    codigo: (f.codigo_familia as number | null) ?? -(f.id as number),
    descricao: f.nome as string,
  }))
}

// Sugere o PROXIMO codigo livre na faixa do tipo (pedido reuniao 18/06). Ex.: ao
// escolher "Materia Prima", retorna o maior codigo existente entre 80000-89999 + 1
// (ou o inicio da faixa se nao houver). Tipos sem faixa definida retornam null.
export async function sugerirProximoCodigo(tipo: string): Promise<string | null> {
  const faixa = FAIXA_CODIGO_POR_TIPO[tipo]
  if (!faixa) return null
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  // So a coluna codigo (leve). Filtra/calcula o maximo numerico na faixa em memoria
  // (codigo e text e pode ter nao-numericos como PRD00011, que sao ignorados).
  const { data } = await supabase
    .from('produtos')
    .select('codigo')
    .eq('loja_id', lojaId)
  let maxNaFaixa = faixa.ini - 1
  for (const row of data ?? []) {
    const c = String(row.codigo ?? '').trim()
    if (!/^\d+$/.test(c)) continue
    const n = Number(c)
    if (n >= faixa.ini && n <= faixa.fim && n > maxNaFaixa) maxNaFaixa = n
  }
  const proximo = maxNaFaixa + 1
  // Se a faixa estourou (cheia), nao sugere fora dela.
  if (proximo > faixa.fim) return String(faixa.fim)
  return String(proximo)
}

/**
 * Cria um produto no Omie e grava no banco (Bloco 9.1). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function criarProduto(dados: {
  codigo: string
  descricao: string
  unidade: string
  ncm: string
  valorUnitario: number
  estoqueMinimo?: number | null
  pdv?: boolean
  tipoItem?: string
  codigoFamilia?: number | null
  descricaoFamilia?: string | null
  origem?: string // origem da mercadoria (0-8)
  ean?: string
  descrDetalhada?: string
  obsInternas?: string
  marca?: string
  modelo?: string
  pesoLiq?: number
  pesoBruto?: number
  altura?: number
  largura?: number
  profundidade?: number
  cest?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Criar'))) return { error: 'Sem permissão' }

  if (!dados.codigo?.trim()) return { error: 'Informe o código do produto' }
  if (!dados.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!dados.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (dados.ncm || '').replace(/\D/g, '')
  if (ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    const res = await incluirProduto(loja, {
      codigo: dados.codigo.trim(),
      descricao: dados.descricao.trim(),
      unidade: dados.unidade.trim(),
      ncm,
      valorUnitario: Number(dados.valorUnitario) || 0,
      tipoItem: dados.tipoItem?.trim() || undefined,
      codigoFamilia: dados.codigoFamilia || undefined,
      origem: dados.origem || undefined,
      ean: dados.ean?.trim() || undefined,
      descrDetalhada: dados.descrDetalhada?.trim() || undefined,
      obsInternas: dados.obsInternas?.trim() || undefined,
      marca: dados.marca?.trim() || undefined,
      modelo: dados.modelo?.trim() || undefined,
      pesoLiq: dados.pesoLiq || undefined,
      pesoBruto: dados.pesoBruto || undefined,
      altura: dados.altura || undefined,
      largura: dados.largura || undefined,
      profundidade: dados.profundidade || undefined,
      cest: dados.cest?.replace(/\D/g, '') || undefined,
    })

    // Grava o produto recem-criado direto (sem re-sync pesado de toda a base).
    const codigoProduto = res?.codigo_produto
    if (codigoProduto) {
      await supabase.from('produtos').upsert(
        {
          loja_id: lojaId,
          codigo_produto: codigoProduto,
          codigo: dados.codigo.trim(),
          descricao: dados.descricao.trim(),
          unidade: dados.unidade.trim(),
          ncm,
          valor_unitario: Number(dados.valorUnitario) || 0,
          estoque_minimo: dados.estoqueMinimo ?? null,
          pdv: dados.pdv ?? false,
          tipo_item: dados.tipoItem?.trim() || null,
          codigo_familia: dados.codigoFamilia || null,
          descricao_familia: dados.descricaoFamilia || null,
          inativo: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'codigo_produto,loja_id' }
      )
    }

    await registrarAuditoria('criar', 'produto', codigoProduto ?? null, dados.descricao)
    revalidatePath('/produto')
    return { ok: true, codigoProduto }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar o produto no Omie' }
  }
}

/**
 * Edita um produto: salva no banco local e, em seguida, envia AlterarProduto ao Omie.
 * Ordem: (1) salvar local + atualizar campos_editados; (2) tentar AlterarProduto no Omie.
 * Se o Omie recusar, o save local JA foi feito e a resposta inclui { ok: true, omieError }.
 * Campos protegidos (campos_editados) continuam bloqueando o sync na direcao Omie->NTB.
 */
export async function editarProduto(
  id: number,
  dados: {
    descricao: string
    codigoFamilia: number | null
    descricaoFamilia: string | null
    tipoItem: string | null
    unidade: string
    ncm: string | null
    valorUnitario: number | null
    estoqueMinimo: number | null
    pdv: boolean
    inativo: boolean
  }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Editar'))) return { error: 'Sem permissão' }
  if (!id) return { error: 'Produto inválido' }

  if (!dados.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!dados.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (dados.ncm || '').replace(/\D/g, '')
  if (ncm && ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos (ou deixe em branco)' }
  if (dados.valorUnitario != null && (Number.isNaN(dados.valorUnitario) || dados.valorUnitario < 0)) {
    return { error: 'Preço de venda inválido' }
  }
  if (dados.estoqueMinimo != null && (Number.isNaN(dados.estoqueMinimo) || dados.estoqueMinimo < 0)) {
    return { error: 'Estoque mínimo inválido' }
  }

  const supabase = createServiceClient()

  // Estado atual para comparar e so marcar como "editado a mao" o que realmente mudou.
  // Inclui codigo_produto (nCodProd) para identificar o produto ao chamar o Omie.
  const { data: atual } = await supabase
    .from('produtos')
    .select(
      'codigo_produto, descricao, codigo_familia, descricao_familia, tipo_item, unidade, ncm, valor_unitario, estoque_minimo, inativo, campos_editados'
    )
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()
  if (!atual) return { error: 'Produto não encontrado' }

  const novo = {
    descricao: dados.descricao.trim(),
    codigo_familia: dados.codigoFamilia,
    descricao_familia: dados.descricaoFamilia,
    tipo_item: dados.tipoItem?.trim() || null,
    unidade: dados.unidade.trim(),
    ncm: ncm || null,
    valor_unitario: dados.valorUnitario,
    estoque_minimo: dados.estoqueMinimo,
    pdv: dados.pdv,
    inativo: dados.inativo,
  }

  // Campos que o sync sobrescreve e portanto precisam de protecao quando editados.
  // estoque_minimo ja e override historico (o sync nunca o toca), entao nao entra aqui.
  const PROTEGIVEIS = [
    'descricao',
    'codigo_familia',
    'descricao_familia',
    'tipo_item',
    'unidade',
    'ncm',
    'valor_unitario',
    'inativo',
  ] as const

  const editadosAtuais = new Set<string>(
    Array.isArray(atual.campos_editados) ? (atual.campos_editados as string[]) : []
  )
  // Normaliza para comparar so o que importa. NCM no banco pode vir formatado do Omie
  // ("0804.40.00") e o form grava so digitos ("08044000"): comparar por digitos evita
  // marcar NCM como editado sem o usuario ter mudado nada.
  const norm = (campo: string, v: unknown): string => {
    if (campo === 'ncm') return String(v ?? '').replace(/\D/g, '')
    // O Omie usa codigo_familia 0 para "sem familia"; tratar 0/null/'' como iguais
    // evita marcar familia como editada sem o usuario ter mudado nada.
    if (campo === 'codigo_familia') return Number(v) > 0 ? String(Number(v)) : ''
    return String(v ?? '').trim()
  }
  for (const campo of PROTEGIVEIS) {
    // family vem como par (codigo + descricao): tratar como um conjunto.
    const mudou = norm(campo, atual[campo as keyof typeof atual]) !== norm(campo, novo[campo as keyof typeof novo])
    if (mudou) {
      editadosAtuais.add(campo)
      if (campo === 'codigo_familia' || campo === 'descricao_familia') {
        editadosAtuais.add('codigo_familia')
        editadosAtuais.add('descricao_familia')
      }
    }
  }

  const { error: dbError } = await supabase
    .from('produtos')
    .update({
      ...novo,
      campos_editados: [...editadosAtuais],
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('loja_id', lojaId)

  if (dbError) return { error: dbError.message }
  await registrarAuditoria('editar', 'produto', (atual.codigo_produto as number | null) ?? id, novo.descricao)
  revalidatePath('/produto')

  // Envia alteracao ao Omie (AlterarProduto). Se falhar, o save local ja foi feito
  // e retornamos ok:true + omieError para o form mostrar aviso sem bloquear o usuario.
  const codigoProduto = atual.codigo_produto as number | null
  if (!codigoProduto) {
    // Produto sem nCodProd no banco (ex.: criado fora do Omie) nao tem como alterar no Omie.
    return { ok: true, omieError: 'Produto sem ID Omie (codigo_produto nulo): alteracao local salva, Omie nao atualizado.' }
  }

  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) {
    return { ok: true, omieError: 'Loja nao encontrada: alteracao local salva, Omie nao atualizado.' }
  }

  try {
    await alterarProduto(loja, {
      codigoProduto,
      descricao: novo.descricao,
      unidade: novo.unidade,
      ncm: novo.ncm || null,
      valorUnitario: novo.valor_unitario,
      tipoItem: novo.tipo_item,
      // Família só-local tem código NEGATIVO (placeholder do select); ela não existe no
      // Omie. Enviar negativo dava rejeição — manda null (= sem família no Omie).
      codigoFamilia: novo.codigo_familia != null && novo.codigo_familia > 0 ? novo.codigo_familia : null,
      inativo: novo.inativo,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao enviar ao Omie'
    return { ok: true, omieError: msg }
  }
}

/**
 * Exclui um produto no Omie e remove do banco (Bloco 9.2 / C2). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function excluirProduto(codigoProduto: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Excluir'))) return { error: 'Sem permissão' }
  if (!codigoProduto) return { error: 'Produto inválido' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    await excluirProdutoOmie(loja, codigoProduto)
    await supabase.from('produtos').delete().eq('loja_id', lojaId).eq('codigo_produto', codigoProduto)
    await registrarAuditoria('excluir', 'produto', codigoProduto, null)
    revalidatePath('/produto')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao excluir o produto no Omie' }
  }
}
