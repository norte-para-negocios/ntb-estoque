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
  alterarOrdemProducao,
} from '@/lib/omie/ordem-producao'
import { consultarEstrutura, incluirEstrutura, excluirEstrutura } from '@/lib/omie/malha'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import type { LojaOmie } from '@/lib/omie/client'
import { registrarAuditoria } from '@/lib/auditoria'
import { hojeBahiaISO } from '@/lib/data-bahia'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Detecta o erro do Omie "existe item na estrutura com CMC (custo médio) zerado"
// ao concluir uma OP. É regra do próprio Omie no ConcluirOrdemProducao (calcula o
// custo da produção a partir do CMC dos insumos); não há parâmetro na API pra
// pular essa checagem por insumo.
function pareceErroCmc(msg: string): boolean {
  return /\bcmc\b|custo m.dio/i.test(msg)
}

/**
 * Decisão explícita (04/07, com o fundador ciente do risco): quando o Omie
 * recusa concluir por CMC zerado num insumo, ao invés de travar a OP inteira,
 * remove TEMPORARIAMENTE da ficha técnica (malha) do produto os insumos sem
 * custo, conclui sem eles, e RECOLOCA os insumos de volta na malha logo em
 * seguida (mesma quantidade/perda de antes) — pra não deixar a receita
 * incompleta pra próximas OPs. O insumo pulado NÃO é baixado do estoque nem
 * entra no custo do produto acabado NESTA produção.
 *
 * ATENÇÃO: mexe na malha (ficha técnica) global do produto, não só desta OP —
 * regra crítica de sessão anterior pede isso só "com o Ramon". Mantido restrito
 * a este fallback automático de CMC, sempre restaurando a malha ao final.
 */
async function tentarConcluirSemInsumosSemCmc(
  loja: LojaOmie,
  codigoProduto: number,
  codigoLocalEstoque: number | null,
  nCodOP: number,
  dataConclusao: string,
  qtdConcluir: number,
  obs: string,
  erroOriginal: string
): Promise<{ ok: true; insumosPulados: string[]; avisoRestaurar?: string } | { error: string }> {
  let estrutura
  try {
    estrutura = await consultarEstrutura(loja, codigoProduto)
  } catch {
    return { error: erroOriginal }
  }
  const itens = estrutura?.itens ?? []
  if (!itens.length) return { error: erroOriginal }

  // Sem local explícito da OP não dá pra checar CMC com confiança: um "local de
  // maior saldo" adivinhado pode ser DIFERENTE do local que o Omie realmente usa
  // pra consumir o insumo, gerando falso positivo (removeria um insumo que tem
  // custo certinho no local real). Mais vale não mexer na malha do que arriscar
  // isso — devolve o erro original pro usuário resolver manualmente no Omie.
  if (!codigoLocalEstoque) return { error: erroOriginal }

  const hojeBR = new Date().toLocaleDateString('pt-BR')
  const semCmc: { idMalha: number; idProdMalha: number; quant: number; perda: number; nome: string }[] = []

  for (const item of itens) {
    try {
      const posicao = await getPosicaoProduto(loja, codigoLocalEstoque, item.idProdMalha, hojeBR)
      if (!posicao || posicao.n_cmc <= 0) {
        semCmc.push({
          idMalha: item.idMalha,
          idProdMalha: item.idProdMalha,
          quant: item.quantProdMalha,
          perda: item.percPerdaProdMalha,
          nome: item.descrProdMalha,
        })
      }
    } catch {
      // Falha ao consultar posicao: nao arrisca mexer na malha por esse insumo.
    }
    await sleep(400)
  }

  if (!semCmc.length) return { error: erroOriginal }

  // Remove temporariamente da malha os insumos sem CMC.
  const removidos: typeof semCmc = []
  for (const it of semCmc) {
    try {
      await excluirEstrutura(loja, codigoProduto, it.idMalha)
      removidos.push(it)
      await sleep(800)
    } catch {
      // Nao conseguiu remover este: segue tentando os outros; a conclusao
      // pode falhar de novo por causa dele, mas nao mexemos no que nao mudou.
    }
  }

  if (!removidos.length) return { error: erroOriginal }

  // Tenta concluir sem os insumos removidos. SEMPRE restaura a malha depois,
  // sucesso ou falha, pra nao deixar a ficha tecnica incompleta.
  let resultadoConclusao: { ok: true } | { error: string }
  try {
    await concluirOrdemProducao(loja, nCodOP, dataConclusao, qtdConcluir, obs)
    resultadoConclusao = { ok: true }
  } catch (e) {
    resultadoConclusao = { error: e instanceof Error ? e.message : erroOriginal }
  }

  const falhasRestaurar: string[] = []
  for (const it of removidos) {
    try {
      await incluirEstrutura(loja, codigoProduto, {
        idProdMalha: it.idProdMalha,
        quantProdMalha: it.quant,
        percPerdaProdMalha: it.perda,
      })
      await sleep(800)
    } catch {
      falhasRestaurar.push(it.nome)
    }
  }

  if (falhasRestaurar.length) {
    // Nao pode ficar em silencio: a ficha tecnica do produto ficou incompleta.
    console.error(
      `[ordem-producao] FALHA AO RESTAURAR MALHA do produto ${codigoProduto} (loja ${loja.id}): ${falhasRestaurar.join(', ')} — corrigir manualmente no Omie.`
    )
  }

  if ('error' in resultadoConclusao) return resultadoConclusao

  return {
    ok: true,
    insumosPulados: removidos.map((r) => r.nome),
    avisoRestaurar: falhasRestaurar.length
      ? `Atenção: falha ao recolocar na ficha técnica: ${falhasRestaurar.join(', ')}. Corrija manualmente no Omie.`
      : undefined,
  }
}

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

// Saldo atual (soma de todos os locais) dos produtos informados, pra alertar
// antes de criar OP de produto que ja tem estoque -- achado da reuniao 09/07
// (#20). Le da posicao ja sincronizada (posicao_estoques), sem chamar o Omie
// ao vivo: mais rapido e sem gastar rate limit so pra um alerta informativo.
export async function saldoAtualProdutos(codigosProduto: number[]): Promise<Record<number, number>> {
  if (!codigosProduto.length) return {}
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: maxRow } = await supabase
    .from('posicao_estoques')
    .select('data_posicao')
    .eq('loja_id', lojaId)
    .order('data_posicao', { ascending: false })
    .limit(1)
    .maybeSingle<{ data_posicao: string }>()
  if (!maxRow) return {}
  const { data } = await supabase
    .from('posicao_estoques')
    .select('n_cod_prod, n_saldo, codigo_local_estoque')
    .eq('loja_id', lojaId)
    .eq('data_posicao', maxRow.data_posicao)
    .in('n_cod_prod', codigosProduto)
    .neq('codigo_local_estoque', 0) // local 0 = linha sentinela do minimo/custo, saldo sempre 0
  const saldos: Record<number, number> = {}
  for (const r of (data ?? []) as { n_cod_prod: number; n_saldo: number | null; codigo_local_estoque: number }[]) {
    saldos[r.n_cod_prod] = (saldos[r.n_cod_prod] ?? 0) + (Number(r.n_saldo) || 0)
  }
  return saldos
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
    await alterarOrdemProducao(op.loja, {
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

/**
 * Troca a QUANTIDADE PLANEJADA (identificacao_n_qtde, sincronizada do Omie) de uma OP
 * ABERTA — escreve de verdade no Omie via AlterarOrdemProducao, espelhando `setDataOP`
 * (reenvia a DATA atual sem mudar, so troca a quantidade). Nome deliberadamente
 * diferente de `setQuantidadeOP` (que e o campo local de etiqueta/impressao, sem
 * relacao com o Omie) pra nao confundir os dois na hora de mexer no arquivo. Bloqueia
 * OP concluida, igual a `setDataOP`.
 */
export async function setQtdPlanejadaOP(opId: number, novaQtd: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Editar'))) return { error: 'Sem permissão' }
  if (!novaQtd || !Number.isFinite(novaQtd) || novaQtd <= 0) return { error: 'Quantidade inválida' }

  const supabase = createServiceClient()
  const { data: op } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_codigo_local_estoque, concluida, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      identificacao_n_cod_op: number | null
      identificacao_n_cod_produto: number | null
      identificacao_d_dt_previsao: string | null
      identificacao_codigo_local_estoque: number | null
      concluida: boolean | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) return { error: 'Ordem de produção não encontrada' }
  if (op.concluida) return { error: 'Não dá para mudar a quantidade de uma OP concluída. Reverta a conclusão primeiro.' }
  if (!op.identificacao_n_cod_produto) return { error: 'OP sem produto vinculado. Aguarde o próximo sync.' }

  const dData = dataParaBR(op.identificacao_d_dt_previsao ?? '')
  if (!dData) return { error: 'Data da OP ainda não sincronizada. Aguarde o próximo sync.' }

  try {
    await alterarOrdemProducao(op.loja, {
      nCodOP: op.identificacao_n_cod_op,
      nCodProduto: op.identificacao_n_cod_produto,
      dData,
      nQtde: novaQtd,
      codigoLocalEstoque: op.identificacao_codigo_local_estoque,
    })

    await fetchOrdemProducao(op.loja, op.identificacao_n_cod_op)
    await registrarAuditoria('editar', 'ordem de produção', op.identificacao_n_cod_op, `qtde planejada → ${novaQtd}`)
    revalidatePath('/ordem-producao')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao alterar a quantidade no Omie' }
  }
}

type OPParaConcluir = {
  id: number
  loja_id: number
  identificacao_n_cod_op: number
  identificacao_d_dt_previsao: string | null
  identificacao_n_qtde: number | null
  identificacao_n_cod_produto: number | null
  identificacao_codigo_local_estoque: number | null
  conclusao_tentativas: number | null
  loja: LojaOmie
}

/**
 * Nucleo da conclusao de OP, SEM sessao (nao chama getCurrentLojaId/requirePermissao)
 * -- reusado por `finishOP` (clique unico, com sessao), `finishOPsEmLote` (lote, com
 * sessao) e `retryOPsPendentes` (cron/reenvio, sem sessao, varias lojas). Em falha,
 * grava `conclusao_status` pra a OP entrar no pool de reenvio (ver retryOPsPendentes);
 * em sucesso, limpa esse status. qtdeProduzida/dataEscolhidaISO: mesmo contrato de
 * antes (conclusao PARCIAL — concluir so parte da OP; sem vir, usa a quantidade
 * planejada da OP).
 */
async function executarConclusaoOP(
  op: OPParaConcluir,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
): Promise<{ ok: true; insumosPulados?: string[]; avisoRestaurar?: string; semEtiqueta?: boolean } | { error: string }> {
  const supabase = createServiceClient()

  // Quantidade a concluir: a escolhida (parcial OU maior que o previsto) se vier;
  // senao a quantidade PLANEJADA da OP (nao mais a etiqueta -- etiqueta e so
  // contagem de impressao, sem relacao com producao). Pedido do fundador (10/07):
  // produziu mais que o planejado (ex.: OP de 10kg, produziu 20kg) tem que poder
  // concluir assim mesmo, sem editar a OP antes. O Omie nao exige nQtdeProduzida
  // bater com o planejado -- essa trava era so do nosso app, removida.
  const qtdMaxima = op.identificacao_n_qtde ?? 1
  const qtdConcluir =
    qtdeProduzida != null && Number.isFinite(qtdeProduzida) && qtdeProduzida > 0
      ? qtdeProduzida
      : qtdMaxima

  // Data de conclusao: 1) a que o usuario ESCOLHEU (se veio); 2) a previsao do banco;
  // 3) hoje como ultimo fallback. NUNCA no futuro -- o Omie rejeita
  // ConcluirOrdemProducao com dDtConclusao > hoje ("A data de Conclusão da Produção
  // não pode ser maior que a data de hoje"), entao qualquer data escolhida/planejada
  // que caia no futuro (ex.: OP agendada pra amanha, concluida adiantada hoje) e
  // "clampada" pra hoje em vez de estourar erro (achado em teste real 2026-07-14).
  const hojeISO = hojeBahiaISO()
  let dataConclusaoISO = ''
  if (dataEscolhidaISO && /^\d{4}-\d{2}-\d{2}$/.test(dataEscolhidaISO)) {
    dataConclusaoISO = dataEscolhidaISO
  } else if (op.identificacao_d_dt_previsao) {
    dataConclusaoISO = op.identificacao_d_dt_previsao.slice(0, 10)
  } else {
    dataConclusaoISO = hojeISO
  }
  if (dataConclusaoISO > hojeISO) dataConclusaoISO = hojeISO
  const mc0 = dataConclusaoISO.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const dataConclusao = mc0 ? `${mc0[3]}/${mc0[2]}/${mc0[1]}` : new Date().toLocaleDateString('pt-BR')
  const obs = await carimboUsuario()

  // Marca conclusao localmente (coluna `concluida`) para a OP nao reaparecer como
  // pendente ate o proximo sync trazer cConcluida='S' do Omie. Reusado pelos dois
  // caminhos (conclusao direta e fallback sem insumo sem CMC). Tambem limpa o
  // `conclusao_status` -- essa OP sai do pool de reenvio.
  // NAO mexe em `quantidade` (etiqueta) -- e so contagem de impressao, sem relacao
  // com a produção; sobrescrever aqui corrompia a contagem de etiqueta a cada
  // conclusao (achado em teste real 2026-07-14). A quantidade PRODUZIDA de verdade
  // ja fica em identificacao_n_qtde (sincronizada do Omie).
  async function marcarConcluidaLocal() {
    const mc = dataConclusao.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    await supabase
      .from('ordens_producao')
      .update({
        concluida: true,
        dt_conclusao_real: mc ? `${mc[3]}-${mc[2]}-${mc[1]}` : null,
        conclusao_status: null,
        conclusao_erro_msg: null,
        conclusao_tentativas: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id)
      .eq('loja_id', op.loja_id)
    revalidatePath('/ordem-producao')
  }

  // Marca falha de conclusao -- entra no pool de reenvio (retryOPsPendentes). Guarda
  // os argumentos BRUTOS recebidos (nao os resolvidos/clampados), pra um reenvio
  // futuro recalcular "hoje"/quantidade planejada do zero em vez de reusar um valor
  // velho. 'Sem CMC' quando o erro bate com pareceErroCmc (ficha tecnica com insumo
  // sem custo medio, mesmo depois do fallback tentar); qualquer outro erro vira
  // 'Erro' generico (conexao, Omie fora do ar, etc.).
  async function marcarFalhaConclusao(msg: string) {
    await supabase
      .from('ordens_producao')
      .update({
        conclusao_status: pareceErroCmc(msg) ? 'Sem CMC' : 'Erro',
        conclusao_erro_msg: msg,
        conclusao_qtde_desejada: qtdeProduzida ?? null,
        conclusao_data_desejada: dataEscolhidaISO ?? null,
        conclusao_tentativas: (op.conclusao_tentativas ?? 0) + 1,
        conclusao_ultima_tentativa_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id)
      .eq('loja_id', op.loja_id)
    revalidatePath('/ordem-producao')
  }

  // Nenhuma etiqueta impressa pra esta OP ainda? So um lembrete (nao bloqueia a
  // conclusao) -- achado do video da reuniao 09/07 (91 producoes, 0 etiquetas
  // impressas num dia). Falha ao checar nao impede a conclusao (aditivo).
  async function semEtiquetaImpressa(): Promise<boolean> {
    try {
      const { count } = await supabase
        .from('impressao_etiquetas')
        .select('id', { count: 'exact', head: true })
        .eq('loja_id', op.loja_id)
        .eq('origem', 'OP')
        .eq('referencia_id', op.id)
      return !count
    } catch {
      return false
    }
  }

  try {
    await concluirOrdemProducao(op.loja, op.identificacao_n_cod_op, dataConclusao, qtdConcluir, obs)
    await marcarConcluidaLocal()
    return { ok: true, semEtiqueta: await semEtiquetaImpressa() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao concluir no Omie'
    if (!pareceErroCmc(msg) || !op.identificacao_n_cod_produto) {
      await marcarFalhaConclusao(msg)
      return { error: msg }
    }
    const fallback = await tentarConcluirSemInsumosSemCmc(
      op.loja,
      op.identificacao_n_cod_produto,
      op.identificacao_codigo_local_estoque,
      op.identificacao_n_cod_op,
      dataConclusao,
      qtdConcluir,
      obs,
      msg
    )
    if ('error' in fallback) {
      await marcarFalhaConclusao(fallback.error)
      return fallback
    }
    await marcarConcluidaLocal()
    return { ...fallback, semEtiqueta: await semEtiquetaImpressa() }
  }
}

/**
 * Conclui uma OP (clique unico do usuario, com sessao). qtdeProduzida (opcional):
 * conclusao PARCIAL -- concluir so parte da OP. Ex.: OP de 10 kg, concluir 4 kg. Vai
 * como nQtdeProduzida pro Omie. Se nao vier (ou <=0), usa a quantidade planejada da
 * OP (identificacao_n_qtde).
 */
export async function finishOP(
  opId: number,
  dataEscolhidaISO?: string | null,
  qtdeProduzida?: number | null,
): Promise<{ ok: true; insumosPulados?: string[]; avisoRestaurar?: string; semEtiqueta?: boolean } | { error: string }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) return { error: 'Sem permissão' }
  const supabase = createServiceClient()

  const { data: op } = await supabase
    .from('ordens_producao')
    .select(
      'id, identificacao_n_cod_op, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_n_cod_produto, identificacao_codigo_local_estoque, conclusao_tentativas, loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', opId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      identificacao_n_cod_op: number | null
      identificacao_d_dt_previsao: string | null
      identificacao_n_qtde: number | null
      identificacao_n_cod_produto: number | null
      identificacao_codigo_local_estoque: number | null
      conclusao_tentativas: number | null
      loja: LojaOmie
    }>()

  if (!op?.identificacao_n_cod_op || !op.loja) {
    return { error: 'Ordem de produção não encontrada' }
  }

  return executarConclusaoOP(
    { ...op, identificacao_n_cod_op: op.identificacao_n_cod_op, loja_id: lojaId },
    dataEscolhidaISO,
    qtdeProduzida
  )
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

type OPRetryRow = {
  id: number
  identificacao_n_cod_op: number | null
  identificacao_d_dt_previsao: string | null
  identificacao_n_qtde: number | null
  identificacao_n_cod_produto: number | null
  identificacao_codigo_local_estoque: number | null
  conclusao_tentativas: number | null
  conclusao_qtde_desejada: number | null
  conclusao_data_desejada: string | null
}

const COLUNAS_OP_RETRY =
  'id, identificacao_n_cod_op, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_n_cod_produto, identificacao_codigo_local_estoque, conclusao_tentativas, conclusao_qtde_desejada, conclusao_data_desejada'

// 'Sem CMC' ja mexeu na ficha tecnica (malha) do produto uma vez (fallback restrito,
// "so com o Ramon") -- nao martela de 10 em 10 min pra sempre: so reconsidera 1x por
// hora e desiste apos um teto de tentativas, mas continua aparecendo pro reenvio
// MANUAL pra sempre (o botao da tela inicial nao aplica esse throttle).
const SEM_CMC_STALE_HORAS = 1
const SEM_CMC_MAX_TENTATIVAS = 20

/**
 * Varre OPs pendentes de conclusao (concluida=false AND conclusao_status IS NOT NULL)
 * das lojas informadas e tenta concluir de novo, reusando o nucleo `executarConclusaoOP`
 * (sem sessao -- serve tanto o cron de 10 em 10 min quanto o botao manual "reenviar
 * pendentes"). `incluirSemCmc`: se false, so reenvia erro generico (conexao/Omie);
 * se true, tambem tenta 'Sem CMC', respeitando o throttle acima -- `semCmcStaleHoras`
 * permite o clique manual pular esse throttle (usuario decidiu agora, presumivelmente
 * ja corrigiu o CMC no Omie), passando 0.
 */
export async function retryOPsPendentes(
  lojas: LojaOmie[],
  opts: { incluirSemCmc?: boolean; limitePorLoja?: number; semCmcStaleHoras?: number } = {}
): Promise<{ loja_id: number; tentadas: number; sucesso: number; falhas: number }[]> {
  const { incluirSemCmc = false, limitePorLoja = 30, semCmcStaleHoras = SEM_CMC_STALE_HORAS } = opts
  const supabase = createServiceClient()
  const resultados: { loja_id: number; tentadas: number; sucesso: number; falhas: number }[] = []

  for (const loja of lojas) {
    const { data: errosGenericos } = await supabase
      .from('ordens_producao')
      .select(COLUNAS_OP_RETRY)
      .eq('loja_id', loja.id)
      .eq('concluida', false)
      .eq('conclusao_status', 'Erro')
      .order('conclusao_ultima_tentativa_em', { ascending: true, nullsFirst: true })
      .limit(limitePorLoja)

    let pendentes = (errosGenericos ?? []) as OPRetryRow[]

    if (incluirSemCmc) {
      const limiteStale = new Date(Date.now() - semCmcStaleHoras * 3600_000).toISOString()
      const { data: semCmc } = await supabase
        .from('ordens_producao')
        .select(COLUNAS_OP_RETRY)
        .eq('loja_id', loja.id)
        .eq('concluida', false)
        .eq('conclusao_status', 'Sem CMC')
        .lt('conclusao_tentativas', SEM_CMC_MAX_TENTATIVAS)
        .or(`conclusao_ultima_tentativa_em.is.null,conclusao_ultima_tentativa_em.lt.${limiteStale}`)
        .order('conclusao_ultima_tentativa_em', { ascending: true, nullsFirst: true })
        .limit(limitePorLoja)
      pendentes = [...pendentes, ...((semCmc ?? []) as OPRetryRow[])].slice(0, limitePorLoja)
    }

    let sucesso = 0
    let falhas = 0
    for (const row of pendentes) {
      if (!row.identificacao_n_cod_op) continue
      const res = await executarConclusaoOP(
        {
          ...row,
          identificacao_n_cod_op: row.identificacao_n_cod_op,
          loja_id: loja.id,
          loja,
        },
        row.conclusao_data_desejada,
        row.conclusao_qtde_desejada
      )
      if ('error' in res) falhas++
      else sucesso++
    }
    resultados.push({ loja_id: loja.id, tentadas: pendentes.length, sucesso, falhas })
  }

  return resultados
}

/**
 * Conclui varias OPs de uma vez (selecao multipla na lista). Reconfere no servidor
 * quem ainda esta com `concluida=false` antes de tentar (ignora selecao desatualizada
 * -- ex.: outra aba ja concluiu essa OP nesse meio tempo). Cada falha ja cai
 * automaticamente no pool de reenvio via `executarConclusaoOP`.
 */
export async function finishOPsEmLote(
  opIds: number[]
): Promise<{ sucesso: number; falhas: { id: number; error: string }[] }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Concluir'))) {
    return { sucesso: 0, falhas: opIds.map((id) => ({ id, error: 'Sem permissão' })) }
  }
  if (!opIds.length) return { sucesso: 0, falhas: [] }
  const supabase = createServiceClient()

  const { data: linhas } = await supabase
    .from('ordens_producao')
    .select(
      `id, identificacao_n_cod_op, identificacao_d_dt_previsao, identificacao_n_qtde, identificacao_n_cod_produto, identificacao_codigo_local_estoque, conclusao_tentativas, loja:lojas(id, omie_app_key, omie_app_secret)`
    )
    .eq('loja_id', lojaId)
    .eq('concluida', false)
    .in('id', opIds)

  let sucesso = 0
  const falhas: { id: number; error: string }[] = []
  for (const op of (linhas ?? []) as unknown as (Omit<OPRetryRow, 'conclusao_qtde_desejada' | 'conclusao_data_desejada'> & {
    loja: LojaOmie
  })[]) {
    if (!op.identificacao_n_cod_op || !op.loja) {
      falhas.push({ id: op.id, error: 'OP sem código Omie ou loja inválida (aguarde o próximo sync)' })
      continue
    }
    const res = await executarConclusaoOP(
      { ...op, identificacao_n_cod_op: op.identificacao_n_cod_op, loja_id: lojaId },
      null,
      null
    )
    if ('error' in res) falhas.push({ id: op.id, error: res.error })
    else sucesso++
  }

  if (sucesso > 0) await registrarAuditoria('concluir', 'ordem de produção', null, `${sucesso} OP(s) em lote`)
  revalidatePath('/ordem-producao')
  return { sucesso, falhas }
}

/**
 * Reverte varias OPs concluidas de uma vez (selecao multipla). Reconfere no servidor
 * quem ainda esta com `concluida=true` antes de tentar.
 */
export async function reverterOPsEmLote(
  opIds: number[]
): Promise<{ sucesso: number; falhas: { id: number; error: string }[] }> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Reverter'))) {
    return { sucesso: 0, falhas: opIds.map((id) => ({ id, error: 'Sem permissão' })) }
  }
  if (!opIds.length) return { sucesso: 0, falhas: [] }
  const supabase = createServiceClient()

  const { data: linhas } = await supabase
    .from('ordens_producao')
    .select('id, identificacao_n_cod_op, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('loja_id', lojaId)
    .eq('concluida', true)
    .in('id', opIds)

  let sucesso = 0
  const falhas: { id: number; error: string }[] = []
  for (const op of (linhas ?? []) as unknown as { id: number; identificacao_n_cod_op: number | null; loja: LojaOmie }[]) {
    if (!op.identificacao_n_cod_op || !op.loja) {
      falhas.push({ id: op.id, error: 'OP sem código Omie ou loja inválida' })
      continue
    }
    try {
      await reverterOrdemProducao(op.loja, op.identificacao_n_cod_op)
      await supabase
        .from('ordens_producao')
        .update({ concluida: false, dt_conclusao_real: null, updated_at: new Date().toISOString() })
        .eq('id', op.id)
        .eq('loja_id', lojaId)
      sucesso++
    } catch (e) {
      falhas.push({ id: op.id, error: e instanceof Error ? e.message : 'Falha ao reverter no Omie' })
    }
  }

  if (sucesso > 0) await registrarAuditoria('reverter', 'ordem de produção', null, `${sucesso} OP(s) em lote`)
  revalidatePath('/ordem-producao')
  return { sucesso, falhas }
}
