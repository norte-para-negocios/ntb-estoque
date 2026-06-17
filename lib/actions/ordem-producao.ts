'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, requirePermissao } from '@/lib/auth'
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

// Soma X dias a uma data 'YYYY-MM-DD' e devolve 'YYYY-MM-DD'. O Date normaliza
// virada de mes/ano. Base do calculo de validade por OP (dia da OP + X dias).
function addDiasISO(iso: string, dias: number): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias)
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
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
      obs: [input.obs, await carimboUsuario()].filter(Boolean).join(' · '),
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

/**
 * Cria VARIAS OPs de uma vez: uma por (produto x data). Permite listar produtos,
 * escolher qualquer data e repetir semanalmente (recorrencia). Escreve no Omie.
 */
export async function criarOrdensProducao(input: {
  // validadeDias: dias de validade (calculados por ocorrencia: data da OP + dias)
  itens: { nCodProduto: number; quantidade: number; validadeDias?: number | null }[]
  datas: string[] // 'YYYY-MM-DD'
  codigoLocalEstoque?: number | null
  obs?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) return { error: 'Sem permissão' }
  if (!input.itens.length) return { error: 'Adicione ao menos um produto' }
  if (!input.datas.length) return { error: 'Informe a data' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  let criadas = 0
  const erros: string[] = []
  let seq = 0

  for (const dataISO of input.datas) {
    const dData = dataParaBR(dataISO)
    if (!dData) {
      erros.push(`Data inválida: ${dataISO}`)
      continue
    }
    for (const item of input.itens) {
      if (!item.nCodProduto || !item.quantidade || item.quantidade <= 0) {
        erros.push('Produto/quantidade inválidos')
        continue
      }
      const cCodIntOP = `NTB-${Date.now()}-${seq++}`
      try {
        const res = await incluirOrdemProducao(loja, {
          cCodIntOP,
          nCodProduto: item.nCodProduto,
          dData,
          nQtde: item.quantidade,
          codigoLocalEstoque: input.codigoLocalEstoque ?? undefined,
          obs: [input.obs, await carimboUsuario()].filter(Boolean).join(' · '),
        })
        const nCodOP = res?.nCodOP
        if (!nCodOP) {
          erros.push('O Omie não retornou a ordem criada.')
          continue
        }
        await fetchOrdemProducao(loja, nCodOP)
        // Validade = data DESTA ocorrencia + X dias (calculo por OP). Resolve o
        // bug de todas as recorrencias herdarem a validade da primeira. Fica so
        // no nosso banco (o Omie nao recebe a validade aqui).
        const validade =
          item.validadeDias && item.validadeDias > 0 ? addDiasISO(dataISO, item.validadeDias) : null
        if (validade) {
          await supabase
            .from('ordens_producao')
            .update({ validade, updated_at: new Date().toISOString() })
            .eq('loja_id', lojaId)
            .eq('identificacao_n_cod_op', nCodOP)
        }
        criadas++
      } catch (e) {
        erros.push(e instanceof Error ? e.message : 'Falha ao criar a OP')
      }
    }
  }

  revalidatePath('/ordem-producao')
  return { ok: true, criadas, erros }
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

export async function finishOP(opId: number, dataEscolhidaISO?: string | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, identificacao_d_dt_previsao, quantidade, full_object, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      identificacao_d_dt_previsao: string | null
      quantidade: number | null
      full_object: { infAdicionais?: { dDtInicio?: string } } | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) {
    return { error: 'Ordem de produção não encontrada' }
  }

  try {
    // Data de conclusao: 1) a que o usuario ESCOLHEU (se veio); 2) a DATA DA OP
    // (data de inicio no Omie), NUNCA o dia de hoje; 3) a previsao do banco;
    // 4) hoje como ultimo fallback.
    let dataConclusao = ''
    if (dataEscolhidaISO) {
      const me = dataEscolhidaISO.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (me) dataConclusao = `${me[3]}/${me[2]}/${me[1]}`
    }
    if (!dataConclusao) {
      const dInicio = op.full_object?.infAdicionais?.dDtInicio
      dataConclusao = dInicio && /^\d{2}\/\d{2}\/\d{4}$/.test(dInicio) ? dInicio : ''
    }
    if (!dataConclusao) {
      const m = op.identificacao_d_dt_previsao?.match(/^(\d{4})-(\d{2})-(\d{2})/)
      dataConclusao = m ? `${m[3]}/${m[2]}/${m[1]}` : new Date().toLocaleDateString('pt-BR')
    }
    await concluirOrdemProducao(op.loja, op.identificacao_n_cod_op, dataConclusao, op.quantidade ?? 1, await carimboUsuario())

    // Marca conclusao localmente (coluna `concluida`) para a OP nao reaparecer
    // como pendente ate o proximo sync trazer cConcluida='S' do Omie. dataConclusao
    // vem DD/MM/AAAA -> grava dt_conclusao_real em YYYY-MM-DD.
    const mc = dataConclusao.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    await supabase
      .from('ordens_producao')
      .update({
        concluida: true,
        dt_conclusao_real: mc ? `${mc[3]}-${mc[2]}-${mc[1]}` : null,
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
