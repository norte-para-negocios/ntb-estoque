'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
  concluirOrdemProducao,
  incluirOrdemProducao,
  fetchOrdemProducao,
  excluirOrdemProducao,
  reverterOrdemProducao,
  alterarDataOrdemProducao,
} from '@/lib/omie/ordem-producao'
import type { LojaOmie } from '@/lib/omie/client'
import { registrarAuditoria } from '@/lib/auditoria'

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
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Criar'))) {
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

    await registrarAuditoria('criar', 'ordem de produção', nCodOP, null)
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
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Criar'))) return { error: 'Sem permissão' }
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

  if (criadas > 0) await registrarAuditoria('criar', 'ordem de produção', null, `${criadas} OP(s)`)
  revalidatePath('/ordem-producao')
  return { ok: true, criadas, erros }
}

export async function setValidadeOP(opId: number, validade: string | null) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Editar'))) return { error: 'Sem permissão' }
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
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Editar'))) return { error: 'Sem permissão' }
  const supabase = createServiceClient()
  await supabase
    .from('ordens_producao')
    .update({ quantidade, updated_at: new Date().toISOString() })
    .eq('id', opId)
    .eq('loja_id', lojaId)
  revalidatePath('/ordem-producao')
}

/**
 * Troca a DATA (previsao) de uma OP ABERTA — escreve de verdade no Omie via
 * AlterarOrdemProducao e reflete no banco. Diferente da validade (so local), a data
 * da OP e a mesma do Omie. Bloqueia OP concluida: mudar data de OP concluida nao faz
 * sentido (e o Omie recusa) — reverter primeiro. `dataISO`: 'YYYY-MM-DD'.
 */
export async function setDataOP(opId: number, dataISO: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Editar'))) return { error: 'Sem permissão' }

  const dData = dataParaBR(dataISO)
  if (!dData) return { error: 'Data inválida' }

  const supabase = createServiceClient()
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_n_qtde, identificacao_codigo_local_estoque, concluida, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      identificacao_n_cod_produto: number | null
      identificacao_n_qtde: number | null
      identificacao_codigo_local_estoque: number | null
      concluida: boolean | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) return { error: 'Ordem de produção não encontrada' }
  if (op.concluida) return { error: 'Não dá para mudar a data de uma OP concluída. Reverta a conclusão primeiro.' }
  if (!op.identificacao_n_cod_produto) return { error: 'OP sem produto vinculado. Aguarde o próximo sync.' }

  try {
    await alterarDataOrdemProducao(op.loja, {
      nCodOP: op.identificacao_n_cod_op,
      nCodProduto: op.identificacao_n_cod_produto,
      dData,
      nQtde: op.identificacao_n_qtde ?? 1,
      codigoLocalEstoque: op.identificacao_codigo_local_estoque,
    })

    // Traz o estado canonico do Omie (data, num etc.) de volta pro banco.
    await fetchOrdemProducao(op.loja, op.identificacao_n_cod_op)
    await registrarAuditoria('editar', 'ordem de produção', op.identificacao_n_cod_op, `data → ${dData}`)
    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao alterar a data no Omie' }
  }
}

// qtdeProduzida (opcional): conclusao PARCIAL — concluir so parte da OP. Ex.: OP de
// 10 kg, concluir 4 kg. Vai como nQtdeProduzida pro Omie. Se nao vier (ou <=0), usa
// a quantidade cheia da OP (op.quantidade ?? identificacao_n_qtde ?? 1).
export async function finishOP(
  opId: number,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) return { error: 'Sem permissão' }
  const supabase = createServiceClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, identificacao_d_dt_previsao, identificacao_n_qtde, quantidade, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      identificacao_d_dt_previsao: string | null
      identificacao_n_qtde: number | null
      quantidade: number | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) {
    return { error: 'Ordem de produção não encontrada' }
  }

  // Quantidade a concluir: a escolhida (parcial) se valida; senao a cheia da OP.
  const qtdConcluir =
    qtdeProduzida != null && Number.isFinite(qtdeProduzida) && qtdeProduzida > 0
      ? qtdeProduzida
      : op.quantidade ?? op.identificacao_n_qtde ?? 1

  try {
    // Data de conclusao: 1) a que o usuario ESCOLHEU (se veio); 2) a previsao do banco;
    // 3) hoje como ultimo fallback.
    let dataConclusao = ''
    if (dataEscolhidaISO) {
      const me = dataEscolhidaISO.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (me) dataConclusao = `${me[3]}/${me[2]}/${me[1]}`
    }
    if (!dataConclusao) {
      const m = op.identificacao_d_dt_previsao?.match(/^(\d{4})-(\d{2})-(\d{2})/)
      dataConclusao = m ? `${m[3]}/${m[2]}/${m[1]}` : new Date().toLocaleDateString('pt-BR')
    }
    await concluirOrdemProducao(op.loja, op.identificacao_n_cod_op, dataConclusao, qtdConcluir, await carimboUsuario())

    // Marca conclusao localmente (coluna `concluida`) para a OP nao reaparecer
    // como pendente ate o proximo sync trazer cConcluida='S' do Omie. dataConclusao
    // vem DD/MM/AAAA -> grava dt_conclusao_real em YYYY-MM-DD. Reflete tambem a
    // quantidade efetivamente concluida (parcial) na coluna `quantidade`.
    const mc = dataConclusao.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    await supabase
      .from('ordens_producao')
      .update({
        concluida: true,
        quantidade: qtdConcluir,
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

// Busca a OP + a loja (chaves Omie) garantindo o escopo da loja atual. Comum a
// excluir/reverter. A permissao exigida varia por acao (Excluir/Reverter).
async function carregarOPdaLoja(opId: number, permissao: string) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, permissao))) {
    return { error: 'Sem permissão' }
  }
  const supabase = createServiceClient()
  const { data: op, error: dbError } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, concluida, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      concluida: boolean | null
      loja: LojaOmie
    }>()
  // Distingue entre: (a) registro nao existe / fora do escopo da loja, (b) DB error,
  // (c) registro existe mas identificacao_n_cod_op e null (OP nao sincronizada ainda),
  // (d) loja ausente no join (dado inconsistente). Cada caso recebe mensagem propria.
  if (dbError) {
    return { error: `Erro ao buscar OP id=${opId}: ${dbError.message}` }
  }
  if (!op) {
    return { error: `Ordem de producao nao encontrada (id=${opId}, loja=${lojaId})` }
  }
  if (!op.identificacao_n_cod_op) {
    return {
      error: `OP id=${opId} existe no banco mas ainda nao tem codigo Omie (identificacao_n_cod_op nulo). Aguarde o proximo sync.`,
    }
  }
  if (!op.loja) {
    return { error: `Loja da OP id=${opId} nao encontrada (dado inconsistente).` }
  }
  return { lojaId, supabase, op }
}

/**
 * Exclui uma OP no Omie e remove do banco. Decisao do fundador (20/06): excluir
 * OP concluida DIRETO — revertendo a conclusao no Omie automaticamente antes de
 * excluir (o Omie nao deixa excluir uma OP concluida sem antes estornar a
 * producao). A pendente exclui direto, como antes.
 */
export async function excluirOP(opId: number) {
  const ctx = await carregarOPdaLoja(opId, 'Ordens de Producao - Excluir')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, op } = ctx
  try {
    // Concluida: reverte (estorna a producao) antes de excluir.
    if (op.concluida) {
      await reverterOrdemProducao(op.loja, op.identificacao_n_cod_op!)
    }
    await excluirOrdemProducao(op.loja, op.identificacao_n_cod_op!)
    await supabase.from('ordens_producao').delete().eq('id', opId).eq('loja_id', lojaId)
    await registrarAuditoria('excluir', 'ordem de produção', op.identificacao_n_cod_op, null)
    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao excluir no Omie' }
  }
}

/**
 * Reverte no Omie a CONCLUSAO de uma OP concluida e volta o status local para
 * nao-concluido. Regra do fundador: a concluida permite reverter. Bloqueia se a
 * OP nao estiver concluida (nao ha o que reverter).
 */
export async function reverterOP(opId: number) {
  const ctx = await carregarOPdaLoja(opId, 'Ordens de Producao - Reverter')
  if ('error' in ctx) return { error: ctx.error }
  const { lojaId, supabase, op } = ctx
  if (!op.concluida) {
    return { error: 'Só dá para reverter uma OP concluída.' }
  }
  try {
    await reverterOrdemProducao(op.loja, op.identificacao_n_cod_op!)
    await supabase
      .from('ordens_producao')
      .update({ concluida: false, dt_conclusao_real: null, updated_at: new Date().toISOString() })
      .eq('id', opId)
      .eq('loja_id', lojaId)
    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao reverter no Omie' }
  }
}
