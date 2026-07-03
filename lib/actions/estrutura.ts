'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { consultarEstrutura, incluirEstrutura, alterarEstrutura, excluirEstrutura } from '@/lib/omie/malha'
import type { LojaOmie } from '@/lib/omie/client'
import { registrarAuditoria } from '@/lib/auditoria'
import { revalidatePath } from 'next/cache'

export type EstruturaItemView = {
  idMalha: number // linha da estrutura no Omie (para alterar/excluir)
  idProdMalha: number // codigo_produto (idProduto Omie) do componente
  codigo: string
  descricao: string
  familia: string
  quantidade: number
  unidade: string
  perda: number
}

export type ConsumoView = {
  codigo: string
  descricao: string
  quantidade: number // consumido na ultima OP
  doEstoque: boolean
}

export type EstruturaView = {
  produto: { codigo: string; descricao: string; tipo: string; unidade: string } | null
  itens: EstruturaItemView[]
  consumoOP: { numero: string | null; data: string | null; itens: ConsumoView[] } | null
  semEstrutura: boolean
}

type OPItemDetalhe = {
  nIdProdutoMalha: number
  nQtde: number
  cUtilizarDoEstoque?: string
}

/**
 * Le a ESTRUTURA (BOM) de um produto e o CONSUMO real na ultima OP concluida.
 * SO LEITURA. A estrutura vem do Omie (ConsultarEstrutura). O consumo vem do
 * full_object das OPs ja salvas no banco (itensDetalhes), sem chamada extra ao Omie.
 * A edicao da ficha tecnica fica para validar com o Ramon (nao escrevemos a malha).
 */
export async function verEstrutura(
  codigoProduto: number
): Promise<{ error: string } | { ok: true; view: EstruturaView }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  // Estrutura (BOM) do Omie.
  let estrutura
  try {
    estrutura = await consultarEstrutura(loja, codigoProduto)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao consultar a estrutura no Omie' }
  }

  const itens: EstruturaItemView[] = (estrutura?.itens ?? []).map((i) => ({
    idMalha: i.idMalha,
    idProdMalha: i.idProdMalha,
    codigo: i.codProdMalha,
    descricao: i.descrProdMalha,
    familia: i.descrFamMalha,
    quantidade: Number(i.quantProdMalha) || 0,
    unidade: i.unidProdMalha,
    perda: Number(i.percPerdaProdMalha) || 0,
  }))

  const produto = estrutura?.ident
    ? {
        codigo: estrutura.ident.codProduto,
        descricao: estrutura.ident.descrProduto,
        tipo: estrutura.ident.tipoProduto,
        unidade: estrutura.ident.unidProduto,
      }
    : null

  // Consumo real: ultima OP concluida desse produto (full_object.itensDetalhes).
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_c_num_op, dt_conclusao_real, full_object')
    .eq('loja_id', lojaId)
    .eq('identificacao_n_cod_produto', codigoProduto)
    .eq('concluida', true)
    .order('dt_conclusao_real', { ascending: false })
    .limit(1)
    .maybeSingle()

  let consumoOP: EstruturaView['consumoOP'] = null
  if (op?.full_object) {
    const fo = op.full_object as { itensDetalhes?: OPItemDetalhe[] }
    const det = fo.itensDetalhes ?? []
    if (det.length) {
      // Resolve descricao dos componentes pelo codigo_produto (nIdProdutoMalha).
      const ids = [...new Set(det.map((d) => d.nIdProdutoMalha))]
      const { data: prods } = await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', ids)
      const mapa = new Map<number, { codigo: string | null; descricao: string | null }>()
      for (const p of prods ?? [])
        mapa.set(p.codigo_produto as number, { codigo: p.codigo as string, descricao: p.descricao as string })

      consumoOP = {
        numero: (op.identificacao_c_num_op as string | null) ?? null,
        data: (op.dt_conclusao_real as string | null) ?? null,
        itens: det.map((d) => {
          const info = mapa.get(d.nIdProdutoMalha)
          return {
            codigo: info?.codigo ?? String(d.nIdProdutoMalha),
            descricao: info?.descricao ?? '(componente)',
            quantidade: Number(d.nQtde) || 0,
            doEstoque: d.cUtilizarDoEstoque === 'S',
          }
        }),
      }
    }
  }

  return {
    ok: true,
    view: {
      produto,
      itens,
      consumoOP,
      semEstrutura: !itens.length,
    },
  }
}

// Item desejado da estrutura, vindo do editor. idMalha presente = já existe no Omie.
export type ItemEstruturaInput = {
  idMalha: number | null
  idProdMalha: number // codigo_produto (idProduto Omie) do componente
  codigo: string
  descricao: string
  quantidade: number
  perda: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const quaseIgual = (a: number, b: number) => Math.abs(a - b) < 1e-9

/**
 * Salva a ESTRUTURA (ficha técnica) de um produto no Omie aplicando o diff:
 * inclui os novos, altera os que mudaram (qtde/perda) e exclui os removidos.
 * ESCREVE no Omie (v1/geral/malha). Sequencial com anti-rajada (a API bloqueia
 * por "consumo indevido" em rajadas). Só para produto acabado (04) ou em processo (03).
 */
export async function salvarEstrutura(
  codigoProduto: number,
  itens: ItemEstruturaInput[]
): Promise<{ error: string } | { ok: true; incluidos: number; alterados: number; excluidos: number }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos - Editar'))) return { error: 'Sem permissão para editar a ficha técnica' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas').select('id, omie_app_key, omie_app_secret').eq('id', lojaId).single<LojaOmie>()
  if (!loja?.omie_app_key || !loja?.omie_app_secret) return { error: 'Loja sem chave do Omie' }

  // Só acabado/em processo têm estrutura (regra do Omie + pedido do Ramon).
  const { data: prod } = await supabase
    .from('produtos').select('tipo_item, descricao').eq('loja_id', lojaId).eq('codigo_produto', codigoProduto).maybeSingle()
  if (prod && prod.tipo_item !== '04' && prod.tipo_item !== '03') {
    return { error: 'Só produto acabado ou em processo tem ficha técnica' }
  }
  if (itens.some((i) => !(i.quantidade > 0))) return { error: 'Quantidade inválida em algum componente' }

  // Estado atual no Omie (para diff).
  let atual
  try {
    atual = await consultarEstrutura(loja, codigoProduto)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao ler a estrutura atual no Omie' }
  }
  const atuais = new Map<number, { idProdMalha: number; quant: number; perda: number }>()
  for (const it of atual?.itens ?? []) {
    atuais.set(it.idMalha, { idProdMalha: it.idProdMalha, quant: Number(it.quantProdMalha) || 0, perda: Number(it.percPerdaProdMalha) || 0 })
  }

  const idMalhasDesejados = new Set(itens.map((i) => i.idMalha).filter((v): v is number => v != null))
  let incluidos = 0, alterados = 0, excluidos = 0
  // O diff aplica em varias chamadas sequenciais ao Omie; se uma falhar no meio,
  // as anteriores ja foram gravadas la. A mensagem de erro sempre reporta quantas
  // ja foram aplicadas com sucesso antes da falha, pra nao passar a impressao de
  // "nada foi salvo" quando na verdade uma parte ja foi.
  const progresso = () => `(já aplicado: +${incluidos} ~${alterados} -${excluidos})`
  try {
    // 1) Inclui os novos (sem idMalha).
    for (const it of itens.filter((i) => i.idMalha == null)) {
      const r = await incluirEstrutura(loja, codigoProduto, { idProdMalha: it.idProdMalha, quantProdMalha: it.quantidade, percPerdaProdMalha: it.perda })
      if (r?.faultstring) return { error: `Incluir "${it.descricao}": ${r.faultstring} ${progresso()}` }
      incluidos++
      await sleep(800)
    }
    // 2) Altera os que mudaram (qtde/perda).
    for (const it of itens.filter((i) => i.idMalha != null)) {
      const cur = atuais.get(it.idMalha!)
      if (cur && (!quaseIgual(cur.quant, it.quantidade) || !quaseIgual(cur.perda, it.perda))) {
        const r = await alterarEstrutura(loja, codigoProduto, it.idMalha!, { quantProdMalha: it.quantidade, percPerdaProdMalha: it.perda })
        if (r?.faultstring) return { error: `Alterar "${it.descricao}": ${r.faultstring} ${progresso()}` }
        alterados++
        await sleep(800)
      }
    }
    // 3) Exclui os que sumiram.
    for (const [idMalha] of atuais) {
      if (!idMalhasDesejados.has(idMalha)) {
        const r = await excluirEstrutura(loja, codigoProduto, idMalha)
        if (r?.faultstring) return { error: `Excluir componente: ${r.faultstring} ${progresso()}` }
        excluidos++
        await sleep(800)
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao salvar a estrutura no Omie'
    return { error: `${msg} ${progresso()}` }
  }

  await registrarAuditoria('editar', 'ficha técnica', codigoProduto, `${prod?.descricao ?? ''}: +${incluidos} ~${alterados} -${excluidos}`)
  revalidatePath('/produto')
  return { ok: true, incluidos, alterados, excluidos }
}
