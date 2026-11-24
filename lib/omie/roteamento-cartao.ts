import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import {
  casarContaDoCartao, casarContaPix, casarTitulosDaNota, contasDeCartaoAtivas, decidirAlteracaoDoTitulo, decidirTaxaDoTitulo, ehPix, escolherPrazoDias,
  tipoDoTPag,
  type ContaCorrenteOmie, type TituloConsultado, type RegraConta, type ResultadoCasamento,
} from './roteamento-cartao-puro'
import type { IncluirNfcePayload } from './nota-fiscal-venda'

const MODEL = 'RoteamentoCartao [Norte Para Negócios]'
const CACHE_MS = 60 * 60 * 1000

const cacheContas = new Map<number, { em: number; contas: ContaCorrenteOmie[] }>()

/** Todas as contas correntes da loja (cache de 1 h em memoria). */
async function contasDaLoja(loja: LojaOmie): Promise<ContaCorrenteOmie[]> {
  const hit = cacheContas.get(loja.id)
  if (hit && Date.now() - hit.em < CACHE_MS) return hit.contas
  const contas: ContaCorrenteOmie[] = []
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await omieRequest<{ total_de_paginas?: number; ListarContasCorrentes?: ContaCorrenteOmie[] }>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      is_test: loja.is_test,
      endpoint: 'v1/geral/contacorrente',
      call: 'ListarContasCorrentes',
      data: { pagina, registros_por_pagina: 100, apenas_importado_api: 'N' },
    })
    contas.push(...(r?.ListarContasCorrentes ?? []))
    if (pagina >= Number(r?.total_de_paginas ?? 1)) break
  }
  cacheContas.set(loja.id, { em: Date.now(), contas })
  return contas
}

type ConfigLoja = { contaPix: number | null; regras: Map<number, RegraConta> }
const CACHE_CONFIG_MS = 10 * 60 * 1000
const cacheConfig = new Map<number, { em: number; cfg: ConfigLoja }>()

/**
 * Conta Pix (lojas.omie_conta_pix) e regras de prazo (omie_contas_regras) da loja, cache de 10 min.
 * Migration nao aplicada (coluna/tabela inexistente) ou erro: segue sem config (Pix nao mexe, prazo cai no pdv_dias_venc).
 */
async function configDaLoja(lojaId: number): Promise<ConfigLoja> {
  const hit = cacheConfig.get(lojaId)
  if (hit && Date.now() - hit.em < CACHE_CONFIG_MS) return hit.cfg
  const cfg: ConfigLoja = { contaPix: null, regras: new Map() }
  try {
    const supabase = createServiceClient({ semAutor: true })
    const [l, r] = await Promise.all([
      supabase.from('lojas').select('omie_conta_pix').eq('id', lojaId).maybeSingle(),
      supabase.from('omie_contas_regras').select('n_cod_cc, prazo_dias, taxa_percentual').eq('loja_id', lojaId),
    ])
    const pix = Number((l.data as { omie_conta_pix?: number | string | null } | null)?.omie_conta_pix)
    if (!l.error && Number.isFinite(pix) && pix > 0) cfg.contaPix = pix
    if (!r.error) {
      for (const x of (r.data ?? []) as Array<{ n_cod_cc: number | string; prazo_dias: number; taxa_percentual: number | string | null }>) {
        cfg.regras.set(Number(x.n_cod_cc), {
          prazo_dias: Number(x.prazo_dias),
          taxa_percentual: x.taxa_percentual == null ? null : Number(x.taxa_percentual),
        })
      }
    }
  } catch {
    /* sem config: comportamento anterior */
  }
  cacheConfig.set(lojaId, { em: Date.now(), cfg })
  return cfg
}

/**
 * Titulos importados pela API emitidos no dia da nota (AAAA-MM-DD). O ImportarNFCe grava todos os
 * titulos da nota com o mesmo codigo de integracao, entao a busca e pela lista do dia.
 */
async function titulosDoDia(loja: LojaOmie, dEmi: string): Promise<TituloConsultado[]> {
  const [a, m, d] = dEmi.split('-')
  const dia = `${d}/${m}/${a}`
  const out: TituloConsultado[] = []
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await omieRequest<{ total_de_paginas?: number; conta_receber_cadastro?: TituloConsultado[] }>({
      loja_id: loja.id,
      omie_app_key: loja.omie_app_key,
      omie_app_secret: loja.omie_app_secret,
      is_test: loja.is_test,
      endpoint: 'v1/financas/contareceber',
      call: 'ListarContasReceber',
      data: {
        pagina,
        registros_por_pagina: 500,
        apenas_importado_api: 'S',
        filtrar_por_emissao_de: dia,
        filtrar_por_emissao_ate: dia,
      },
    })
    out.push(...(r?.conta_receber_cadastro ?? []))
    if (pagina >= Number(r?.total_de_paginas ?? 1)) break
  }
  return out
}

async function log(loja: LojaOmie, chNFe: string, i: number, motivo: string, erro: boolean) {
  try {
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: MODEL,
      request: `chNFe=${chNFe} pagamento=${i + 1}`,
      response: erro ? undefined : motivo,
      code: erro ? undefined : '0',
      error: erro,
      error_message: erro ? motivo.slice(0, 1000) : undefined,
    })
  } catch {
    /* log e so diagnostico */
  }
}

/**
 * Depois de um ImportarNFCe com titulo: move cada titulo de cartao para a conta
 * da maquininha escolhida no caixa. Nunca lanca: falhas vao para integration_attempts.
 */
export async function rotearTitulosDeCartao(loja: LojaOmie, payload: IncluirNfcePayload): Promise<void> {
  const candidatos = payload.pagamentos
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => (p.acquirer && tipoDoTPag(p.tPag)) || ehPix(p.tPag))
  if (!candidatos.length) return

  let contas: ContaCorrenteOmie[]
  try {
    contas = await contasDaLoja(loja)
  } catch (e) {
    for (const { i } of candidatos) await log(loja, payload.chNFe, i, `ListarContasCorrentes falhou: ${e instanceof Error ? e.message : String(e)}`, true)
    return
  }
  const contasPorId = new Map(contas.map((c) => [Number(c.nCodCC), c]))
  const ativas = contasDeCartaoAtivas(contas)
  const cfg = await configDaLoja(loja.id)

  let titulosDaNota: Array<TituloConsultado | null>
  try {
    titulosDaNota = casarTitulosDaNota(await titulosDoDia(loja, payload.dEmi), payload.chNFe, payload.pagamentos)
  } catch (e) {
    for (const { i } of candidatos) await log(loja, payload.chNFe, i, `ListarContasReceber falhou: ${e instanceof Error ? e.message : String(e)}`, true)
    return
  }

  for (const { p, i } of candidatos) {
    try {
      if (ehPix(p.tPag) && !cfg.contaPix) continue // loja sem Pix configurado: nao mexe, sem log
      const casou: ResultadoCasamento = ehPix(p.tPag)
        ? casarContaPix(contas, cfg.contaPix)
        : casarContaDoCartao(ativas, { acquirer: p.acquirer!, brand: p.brand, tPag: p.tPag })
      if (!casou.ok) { await log(loja, payload.chNFe, i, casou.motivo, true); continue }

      const codigoIntegracao = `nfce${payload.nNF}-${payload.serie} pagamento ${i + 1}`
      const t = titulosDaNota[i]
      if (!t) { await log(loja, payload.chNFe, i, `${codigoIntegracao}: titulo da nota com valor ${p.vPag} nao encontrado no Omie`, true); continue }
      const d = decidirAlteracaoDoTitulo({
        titulo: t,
        chNFe: payload.chNFe,
        vPag: p.vPag,
        contaDestino: casou.conta,
        contasPorId,
        prazoDias: escolherPrazoDias(casou.conta, cfg.regras),
      })
      const jaNaConta = !d.alterar && Number(t.id_conta_corrente) === casou.conta.nCodCC
      if (!d.alterar && !jaNaConta) { await log(loja, payload.chNFe, i, `${codigoIntegracao}: ${d.motivo}`, true); continue }
      if (d.alterar) {
        await omieRequest({
          loja_id: loja.id,
          omie_app_key: loja.omie_app_key,
          omie_app_secret: loja.omie_app_secret,
          is_test: loja.is_test,
          endpoint: 'v1/financas/contareceber',
          call: 'AlterarContaReceber',
          data: d.payload,
        })
        await log(loja, payload.chNFe, i, `${codigoIntegracao} movido para "${casou.conta.descricao}" (${casou.conta.nCodCC}), vencimento ${d.vencimentoNovo ?? 'mantido'}`, false)
      }

      // Taxa da maquininha: baixa com valor 0 e desconto = taxa (como o PDV antigo). Idempotente pelo
      // codigo_baixa_integracao e pela situacao do titulo (so lanca se ainda nao tem baixa).
      const taxa = decidirTaxaDoTitulo({
        codigoLancamento: t.codigo_lancamento_omie,
        statusTitulo: t.status_titulo,
        dataEmissao: t.data_emissao,
        vPag: p.vPag,
        taxaPercentual: cfg.regras.get(casou.conta.nCodCC)?.taxa_percentual,
        contaDestino: casou.conta.nCodCC,
        codigoBaixaIntegracao: `tx${payload.nNF}-${i + 1}`,
      })
      if (!taxa.lancar) {
        if (taxa.motivo !== 'conta sem taxa cadastrada') await log(loja, payload.chNFe, i, `${codigoIntegracao}: ${taxa.motivo}`, true)
        continue
      }
      try {
        await omieRequest({
          loja_id: loja.id,
          omie_app_key: loja.omie_app_key,
          omie_app_secret: loja.omie_app_secret,
          is_test: loja.is_test,
          endpoint: 'v1/financas/contareceber',
          call: 'LancarRecebimento',
          data: taxa.payload,
        })
        await log(loja, payload.chNFe, i, `${codigoIntegracao} taxa R$ ${taxa.valorTaxa.toFixed(2)} lancada`, false)
      } catch (e) {
        await log(loja, payload.chNFe, i, `${codigoIntegracao} taxa nao lancada: ${e instanceof Error ? e.message : String(e)}`, true)
      }
    } catch (e) {
      await log(loja, payload.chNFe, i, e instanceof Error ? e.message : String(e), true)
    }
  }
}
