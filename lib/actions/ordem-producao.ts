'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
  concluirOrdemProducao,
  incluirOrdemProducao,
  fetchOrdemProducao,
} from '@/lib/omie/ordem-producao'
import type { LojaOmie } from '@/lib/omie/client'

// 'YYYY-MM-DD' (input date) -> 'DD/MM/YYYY' (formato que o Omie espera).
function dataParaBR(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Cria uma OP no Omie e reflete no banco. A validade fica SO no nosso sistema.
 * ATENCAO: escreve de verdade no Omie da loja; testar apenas com o cliente ciente.
 */
export async function criarOrdemProducao(input: {
  nCodProduto: number
  data: string // 'YYYY-MM-DD'
  quantidade: number
  codigoLocalEstoque?: number | null
  validade?: string | null // 'YYYY-MM-DD', so local
  obs?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) {
    return { error: 'Sem permissão' }
  }
  if (!input.nCodProduto) return { error: 'Selecione um produto' }
  if (!input.quantidade || input.quantidade <= 0) return { error: 'Informe a quantidade' }

  const dData = dataParaBR(input.data)
  if (!dData) return { error: 'Data inválida' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  const cCodIntOP = `NTB-${Date.now()}`

  try {
    const res = await incluirOrdemProducao(loja, {
      cCodIntOP,
      nCodProduto: input.nCodProduto,
      dData,
      nQtde: input.quantidade,
      codigoLocalEstoque: input.codigoLocalEstoque ?? undefined,
      obs: input.obs,
    })

    const nCodOP = res?.nCodOP
    if (!nCodOP) return { error: 'O Omie não retornou a ordem criada.' }

    // Traz a OP completa (numero, data de inclusao etc.) para o banco
    await fetchOrdemProducao(loja, nCodOP)

    // Validade fica so no nosso sistema
    if (input.validade) {
      await supabase
        .from('ordens_producao')
        .update({ validade: input.validade, updated_at: new Date().toISOString() })
        .eq('loja_id', lojaId)
        .eq('identificacao_n_cod_op', nCodOP)
    }

    revalidatePath('/ordem-producao')
    return { ok: true, nCodOP }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar a OP no Omie' }
  }
}

export async function setValidadeOP(opId: number, validade: string | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('ordens_producao')
    .update({ validade, updated_at: new Date().toISOString() })
    .eq('id', opId)
    .eq('loja_id', lojaId)
  revalidatePath('/ordem-producao')
}

export async function setQuantidadeOP(opId: number, quantidade: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('ordens_producao')
    .update({ quantidade, updated_at: new Date().toISOString() })
    .eq('id', opId)
    .eq('loja_id', lojaId)
  revalidatePath('/ordem-producao')
}

export async function finishOP(opId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, identificacao_d_dt_previsao, quantidade, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      identificacao_d_dt_previsao: string | null
      quantidade: number | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) {
    return { error: 'Ordem de produção não encontrada' }
  }

  try {
    // Conclui na DATA DA OP (previsao/periodo dela), nao no dia de hoje.
    // identificacao_d_dt_previsao vem 'YYYY-MM-DD'; o Omie espera 'DD/MM/YYYY'.
    const prev = op.identificacao_d_dt_previsao
    const m = prev?.match(/^(\d{4})-(\d{2})-(\d{2})/)
    const dataConclusao = m ? `${m[3]}/${m[2]}/${m[1]}` : new Date().toLocaleDateString('pt-BR')
    await concluirOrdemProducao(op.loja, op.identificacao_n_cod_op, dataConclusao, op.quantidade ?? 1, '')

    // Marca conclusao localmente para a OP nao reaparecer como pendente
    // (o sync nem sempre traz cConcluida de imediato). O filtro op_concluido
    // da pagina considera este campo como verdade de conclusao.
    await supabase
      .from('ordens_producao')
      .update({
        adicionais_d_dt_conclusao: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', opId)
      .eq('loja_id', lojaId)

    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao concluir no Omie' }
  }
}
