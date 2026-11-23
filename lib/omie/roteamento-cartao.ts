import { omieRequest, logIntegrationAttempt, type LojaOmie } from './client'
import {
  casarContaDoCartao, contasDeCartaoAtivas, decidirAlteracaoDoTitulo, tipoDoTPag, titulo,
  type ContaCorrenteOmie,
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
    .filter(({ p }) => p.acquirer && tipoDoTPag(p.tPag))
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

  for (const { p, i } of candidatos) {
    try {
      const casou = casarContaDoCartao(ativas, { acquirer: p.acquirer!, brand: p.brand, tPag: p.tPag })
      if (!casou.ok) { await log(loja, payload.chNFe, i, casou.motivo, true); continue }

      const codigoIntegracao = `nfce${payload.nNF}-${i + 1}`
      const consulta = await omieRequest<Record<string, unknown>>({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        is_test: loja.is_test,
        endpoint: 'v1/financas/contareceber',
        call: 'ConsultarContaReceber',
        data: { codigo_lancamento_integracao: codigoIntegracao },
      })
      const d = decidirAlteracaoDoTitulo({
        titulo: titulo(consulta),
        chNFe: payload.chNFe,
        vPag: p.vPag,
        contaDestino: casou.conta,
        contasPorId,
      })
      if (!d.alterar) { await log(loja, payload.chNFe, i, `${codigoIntegracao}: ${d.motivo}`, true); continue }

      await omieRequest({
        loja_id: loja.id,
        omie_app_key: loja.omie_app_key,
        omie_app_secret: loja.omie_app_secret,
        is_test: loja.is_test,
        endpoint: 'v1/financas/contareceber',
        call: 'AlterarContaReceber',
        data: d.payload,
      })
      await log(loja, payload.chNFe, i, `${codigoIntegracao} movido para "${casou.conta.descricao}" (${casou.conta.nCodCC})`, false)
    } catch (e) {
      await log(loja, payload.chNFe, i, e instanceof Error ? e.message : String(e), true)
    }
  }
}
