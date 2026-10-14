// Central de correções: lança uma OP (preparo, prato ou item de cupom sem OP) e conclui com a data escolhida.
// Só servidor (sem 'use server'). Uma escrita no Omie por vez; idempotente por cCodIntOP determinístico:
//  - trava no banco: central_op_lancada (loja, cod_int_op) único — duplo clique / duas abas / refazer caem no 23505;
//  - o Omie recusa cCodIntOP repetido ("já cadastrada") → consulta e segue com a OP que já existe;
//  - retomada (tentativa anterior sem resposta) consulta o Omie pelo código ANTES de incluir de novo;
//  - cupom: confere de novo no servidor se a integração do PDV já cobriu o dia (coberturaAindaFalta).
// Loja 4 bloqueada e loja de teste simulada vêm de contextoEscritaOmie/omieRequest (is_test no select de lojas).
import { createServiceClient } from '@/lib/supabase/server'
import { getUser, carimboUsuario } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'
import { pegarTravaSync, soltarTravaSync } from '@/lib/omie/trava-sync'
import { concluirOrdemProducao, consultarOPPorCodInt, fetchOrdemProducao, incluirOrdemProducao } from '@/lib/omie/ordem-producao'
import { ehLimiteOmie, isoParaBR, mesDoAjusteFechado } from '@/lib/estoque/escrita-omie-puro'
import type { LojaEscrita } from '@/lib/estoque/contexto-escrita-omie'
import { buscarFatCupomDetalhe, buscarFatCupomItens, buscarFatCupons } from '@/lib/faturamento-frio'
import { decidirRetomadaOP } from './central-puro'
import { bloqueioMesFechadoOP, codIntOPCorrecao, codIntOPCupom, coberturaAindaFalta, ehOPdoPDV, lancadaContaComoCobertura, pareceOPJaExiste, precisaConferirCobertura, validarPedidoOP } from './cupons-sem-op-puro'

export type RespostaCentral = { ok: true; aviso: string; simulado?: boolean; jaExistia?: boolean } | { error: string; parar?: boolean; precisaConfirmarMesFechado?: boolean }
export type PedidoOP = { origem: 'cupom' | 'correcao'; codigoProduto: number; quantidade: number; dataISO: string; nIdCupom?: number | null; confirmarMesFechado?: boolean }

type Lancada = { id: number; status: string; atualizado_em: string; n_cod_op: number | null; quantidade: number; data_op: string; erro: string | null }
const msgDe = (e: unknown) => (e instanceof Error ? e.message : String(e))
const qtdTxt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/** OPs do caixa (integração do PDV ou CP- da Central) já lançadas para o produto no dia: banco + registro da Central. */
async function coberturaDoDia(lojaId: number, produto: number, dia: string, semCod: string): Promise<number> {
  const db = createServiceClient()
  const [{ data: ops, error }, { data: lanc }] = await Promise.all([
    db.from('ordens_producao').select('identificacao_c_cod_int_op, obs_omie, origem_op, identificacao_n_qtde')
      .eq('loja_id', lojaId).eq('identificacao_n_cod_produto', produto).eq('identificacao_d_dt_previsao', dia).limit(2000),
    db.from('central_op_lancada').select('cod_int_op, quantidade, status, erro').eq('loja_id', lojaId).eq('codigo_produto', produto).eq('data_op', dia).eq('origem', 'cupom').limit(2000),
  ])
  if (error) throw new Error(`Não foi possível conferir as OPs do dia: ${error.message}`)
  const doBanco = (ops ?? []).filter((o) => ehOPdoPDV({ cCodInt: o.identificacao_c_cod_int_op, obs: o.obs_omie, origem: o.origem_op }))
  const codsBanco = new Set(doBanco.map((o) => o.identificacao_c_cod_int_op))
  // Lançadas pela Central que ainda não chegaram em ordens_producao (loja de teste, ou sync pendente): contam também,
  // inclusive as de resultado desconhecido (timeout). A linha deste próprio pedido (semCod) fica de fora.
  const extras = (lanc ?? []).filter((l) => l.cod_int_op !== semCod && lancadaContaComoCobertura(l) && !codsBanco.has(l.cod_int_op))
  return doBanco.reduce((s, o) => s + Number(o.identificacao_n_qtde ?? 0), 0) + extras.reduce((s, l) => s + Number(l.quantidade), 0)
}

/** Local da OP: o da última OP do caixa do produto, senão a cozinha mapeada da loja, senão o padrão do Omie. */
async function localDaOP(lojaId: number, produto: number): Promise<number | null> {
  const db = createServiceClient()
  const { data } = await db.from('ordens_producao').select('identificacao_c_cod_int_op, obs_omie, origem_op, identificacao_codigo_local_estoque')
    .eq('loja_id', lojaId).eq('identificacao_n_cod_produto', produto).not('identificacao_codigo_local_estoque', 'is', null).order('id', { ascending: false }).limit(30)
  const pdv = (data ?? []).find((o) => ehOPdoPDV({ cCodInt: o.identificacao_c_cod_int_op, obs: o.obs_omie, origem: o.origem_op }))
  if (pdv?.identificacao_codigo_local_estoque) return Number(pdv.identificacao_codigo_local_estoque)
  const { data: l } = await db.from('lojas').select('id, local_estoque_cozinha_codigo').eq('id', lojaId).maybeSingle()
  return l?.local_estoque_cozinha_codigo ? Number(l.local_estoque_cozinha_codigo) : null
}

export async function lancarOPCentral(ctx: { lojaId: number; loja: LojaEscrita }, ped: PedidoOP): Promise<RespostaCentral> {
  const db = createServiceClient()
  const hoje = hojeBahiaISO()
  const { lojaId, loja } = ctx
  const { data: prod } = await db.from('produtos').select('codigo_produto, descricao, tipo_item, unidade, inativo').eq('loja_id', lojaId).eq('codigo_produto', ped.codigoProduto).maybeSingle()
  if (!prod || prod.inativo === true) return { error: 'Produto não encontrado (ou inativo) nesta loja.' }

  // Cupom: quantidade e data saem do próprio cupom (Contabo), nunca da tela.
  let quantidade = ped.quantidade
  let dataISO = ped.dataISO
  let rotuloCupom = ''
  if (ped.origem === 'cupom') {
    if (!ped.nIdCupom) return { error: 'Cupom não informado.' }
    const det = await buscarFatCupomDetalhe(lojaId, ped.nIdCupom, 8000)
    if (!det.cupom) return { error: 'Cupom não encontrado no histórico de vendas.' }
    if (det.cupom.cancelado) return { error: 'Cupom cancelado: não precisa de OP.' }
    quantidade = det.itens.filter((i) => Number(i.id_produto) === ped.codigoProduto).reduce((s, i) => s + Number(i.quant), 0)
    dataISO = String(det.cupom.data).slice(0, 10)
    rotuloCupom = det.cupom.num ?? String(ped.nIdCupom)
    if (!(quantidade > 0)) return { error: 'Este prato não está no cupom.' }
  }
  const invalido = validarPedidoOP({ quantidade, dataISO, tipo: prod.tipo_item }, hoje)
  if (invalido) return { error: invalido }
  const mesFechado = bloqueioMesFechadoOP({ dataISO, fechado: mesDoAjusteFechado(dataISO, hoje, process.env.ESTOQUE_MES_FECHADO_ATE ?? null), confirmado: ped.confirmarMesFechado === true })
  if (mesFechado) return { error: mesFechado, precisaConfirmarMesFechado: true }
  const cod = ped.origem === 'cupom' ? codIntOPCupom(ped.nIdCupom!, ped.codigoProduto) : codIntOPCorrecao(lojaId, ped.codigoProduto, dataISO, quantidade)
  const nome = prod.descricao ?? String(ped.codigoProduto)

  // 1. Já existe no banco (sync trouxe)?
  const { data: existente } = await db.from('ordens_producao').select('id, identificacao_n_cod_op, concluida').eq('loja_id', lojaId).eq('identificacao_c_cod_int_op', cod).maybeSingle()
  if (existente?.concluida) return { ok: true, jaExistia: true, aviso: `A OP desta correção já existe e está concluída (${cod}). Nada foi lançado de novo.` }

  // 2. Trava no banco (único por loja + código).
  const user = await getUser()
  const { data: perfil } = user ? await db.from('profiles').select('name').eq('id', user.id).maybeSingle() : { data: null }
  const ins = await db.from('central_op_lancada').insert({
    loja_id: lojaId, cod_int_op: cod, origem: ped.origem, codigo_produto: ped.codigoProduto, quantidade, data_op: dataISO,
    n_id_cupom: ped.nIdCupom ?? null, n_cod_op: existente?.identificacao_n_cod_op ?? null, status: 'incluindo', simulado: loja.is_test,
    user_id: user?.id ?? null, user_nome: perfil?.name ?? null,
  }).select('id, status, atualizado_em, n_cod_op, quantidade, data_op, erro').single<Lancada>()
  let reg: Lancada
  let retomando = false
  if (ins.error) {
    if (ins.error.code === '42P01' || (ins.error.code !== '23505' && /does not exist|n.o existe/i.test(ins.error.message))) {
      return { error: 'A Central ainda não foi ativada neste banco (migration 171): nada foi lançado.' }
    }
    if (ins.error.code !== '23505') return { error: `Não foi possível registrar a OP: ${ins.error.message}` }
    const { data: atual } = await db.from('central_op_lancada').select('id, status, atualizado_em, n_cod_op, quantidade, data_op, erro').eq('loja_id', lojaId).eq('cod_int_op', cod).single<Lancada>()
    if (!atual) return { error: 'Não foi possível ler o registro da OP.' }
    const d = decidirRetomadaOP({ status: atual.status, atualizadoEm: atual.atualizado_em }, Date.now())
    if (d === 'feito') return { ok: true, jaExistia: true, aviso: `Esta OP já foi lançada e concluída (${cod}). Nada foi lançado de novo.`, simulado: loja.is_test }
    if (d === 'em_andamento') return { error: 'Esta OP está sendo lançada agora (outra aba ou pessoa). Espere um pouco e atualize.' }
    // Reivindica a linha: só um retomador vence (update condicional pelo atualizado_em lido).
    const { data: claim } = await db.from('central_op_lancada').update({ status: 'incluindo', erro: null, atualizado_em: new Date().toISOString() })
      .eq('id', atual.id).eq('atualizado_em', atual.atualizado_em).select('id, status, atualizado_em, n_cod_op, quantidade, data_op, erro').maybeSingle<Lancada>()
    if (!claim) return { error: 'Esta OP está sendo lançada agora (outra aba ou pessoa). Espere um pouco e atualize.' }
    reg = claim
    retomando = true
  } else reg = ins.data

  // Cupom: a trava é por produto + dia (duas abas em cupons diferentes do mesmo prato não conferem a cobertura juntas).
  const trava = ped.origem === 'cupom' ? `op-cupom:${ped.codigoProduto}:${dataISO}` : `op-central:${cod}`
  if (!(await pegarTravaSync(lojaId, trava, 150))) {
    // Nada foi ao Omie: a linha nova sai (o próximo clique começa do zero); a retomada volta a 'erro'.
    if (retomando) await db.from('central_op_lancada').update({ status: 'erro', erro: 'trava ocupada', atualizado_em: new Date().toISOString() }).eq('id', reg.id)
    else await db.from('central_op_lancada').delete().eq('id', reg.id)
    return { error: 'Esta OP está sendo lançada agora (outra aba ou pessoa). Espere um pouco e atualize.' }
  }
  const marcar = (campos: Record<string, unknown>) => db.from('central_op_lancada').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', reg.id)
  try {
    // 4. nCodOP: do banco, do registro, ou procurando no Omie (retomada) antes de incluir.
    let nCodOP: number | null = existente?.identificacao_n_cod_op ? Number(existente.identificacao_n_cod_op) : reg.n_cod_op ? Number(reg.n_cod_op) : null
    let concluidaNoOmie = false
    if (!nCodOP && retomando && !loja.is_test) {
      const achada = await consultarOPPorCodInt(loja, cod)
      if (achada) { nCodOP = achada.nCodOP; concluidaNoOmie = achada.concluida }
    }
    // 5. Cupom: a integração do PDV pode ter reprocessado depois que a tela carregou (ou entre um erro e a retomada).
    //    Confere sempre que a OP ainda não existe (achado C1 da revisão final).
    if (precisaConferirCobertura({ origem: ped.origem, nCodOPConhecido: !!nCodOP })) {
      const [coberto, vendidoDia] = await Promise.all([
        coberturaDoDia(lojaId, ped.codigoProduto, dataISO, cod),
        vendidoNoDia(lojaId, ped.codigoProduto, dataISO),
      ])
      if (vendidoDia == null) { await marcar({ status: 'erro', erro: 'vendas do dia indisponíveis' }); return { error: 'Não foi possível conferir as vendas do dia no histórico (Contabo). Nada foi lançado; tente de novo.' } }
      if (!coberturaAindaFalta(vendidoDia, coberto, quantidade)) {
        await db.from('central_op_lancada').delete().eq('id', reg.id)
        return { error: `As OPs do caixa deste dia já cobrem ${nome} (vendido ${qtdTxt(vendidoDia)}, com OP ${qtdTxt(coberto)}). A integração do PDV pode ter reprocessado: nada foi lançado.` }
      }
    }
    // A obs começa com "Cupom N" (como a da integração do PDV): a Central e as telas reconhecem a OP do cupom.
    const obs = `${rotuloCupom ? `Cupom ${rotuloCupom} · ` : ''}Central de correções · ${await carimboUsuario()}`
    const dData = isoParaBR(dataISO)
    if (!nCodOP) {
      try {
        const res = await incluirOrdemProducao(loja, { cCodIntOP: cod, nCodProduto: ped.codigoProduto, dData, nQtde: quantidade, codigoLocalEstoque: await localDaOP(lojaId, ped.codigoProduto), obs })
        nCodOP = res?.nCodOP ? Number(res.nCodOP) : null
        if (!nCodOP) { await marcar({ status: 'erro', erro: 'Omie não devolveu o código da OP' }); return { error: 'O Omie não devolveu a OP criada. Confira no Omie antes de tentar de novo (o código é ' + cod + ').' } }
      } catch (e) {
        const msg = msgDe(e)
        if (pareceOPJaExiste(msg) && !loja.is_test) {
          const achada = await consultarOPPorCodInt(loja, cod)
          if (!achada) { await marcar({ status: 'erro', erro: msg }); return { error: `O Omie diz que a OP ${cod} já existe, mas não a encontrou. Confira no Omie.` } }
          nCodOP = achada.nCodOP
          concluidaNoOmie = achada.concluida
        } else {
          await marcar({ status: 'erro', erro: msg })
          return { error: `Não foi possível criar a OP de ${nome} no Omie: ${msg}`, parar: ehLimiteOmie(msg) }
        }
      }
      await marcar({ status: 'incluida', n_cod_op: nCodOP })
    }

    // 5. Concluir com a data escolhida.
    if (!concluidaNoOmie) {
      try {
        await concluirOrdemProducao(loja, nCodOP, dData, quantidade, obs)
      } catch (e) {
        const msg = msgDe(e)
        await marcar({ status: 'incluida', n_cod_op: nCodOP, erro: msg })
        if (!loja.is_test) await fetchOrdemProducao(loja, nCodOP).catch(() => {})
        return { error: `A OP de ${nome} foi criada no Omie, mas não concluiu: ${msg}. Ela fica aberta; corrija a causa e use "Concluir" na OP (não lance outra).`, parar: ehLimiteOmie(msg) }
      }
    }
    await marcar({ status: 'concluida', n_cod_op: nCodOP, erro: null })
    if (!loja.is_test) {
      await fetchOrdemProducao(loja, nCodOP).catch((e) => console.error('central: releitura da OP falhou', msgDe(e)))
      await db.from('ordens_producao').update({ concluida: true, dt_conclusao_real: dataISO, aberta_omie: false, updated_at: new Date().toISOString() })
        .eq('loja_id', lojaId).eq('identificacao_n_cod_op', nCodOP)
    }
    await registrarAuditoria('criar', 'ordem de produção', nCodOP, `Central de correções: OP ${cod} de ${qtdTxt(quantidade)} ${nome} concluída em ${dData}${rotuloCupom ? ` (cupom ${rotuloCupom})` : ''}`)
    return {
      ok: true, simulado: loja.is_test,
      aviso: loja.is_test ? `Loja de teste: OP de ${qtdTxt(quantidade)} ${nome} simulada, nada foi enviado ao Omie.` : `OP de ${qtdTxt(quantidade)} ${nome} criada e concluída no Omie (${dData}).`,
    }
  } catch (e) {
    const msg = msgDe(e)
    await marcar({ status: 'erro', erro: msg })
    return { error: msg, parar: ehLimiteOmie(msg) }
  } finally {
    await soltarTravaSync(lojaId, trava)
  }
}

/** Quanto do produto foi vendido no dia (cupons não cancelados, Contabo). null = histórico indisponível. */
async function vendidoNoDia(lojaId: number, produto: number, dia: string): Promise<number | null> {
  let falhou = false
  const [cupons, itens] = await Promise.all([
    buscarFatCupons({ lojaId, dataInicio: dia, dataFinal: dia, onTruncado: () => { falhou = true }, timeoutMs: 8000, tentativas: 1 }),
    buscarFatCupomItens({ lojaId, dataInicio: dia, dataFinal: dia, onTruncado: () => { falhou = true }, timeoutMs: 8000, tentativas: 1 }),
  ])
  if (falhou) return null
  const validos = new Set(cupons.filter((c) => !c.cancelado).map((c) => Number(c.n_id_cupom)))
  return itens.filter((i) => Number(i.id_produto) === produto && validos.has(Number(i.n_id_cupom))).reduce((s, i) => s + Number(i.quant), 0)
}
