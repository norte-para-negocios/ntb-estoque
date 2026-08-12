import { createServiceClient } from '@/lib/supabase/server'

const OMIE_BASE_URL = 'https://app.omie.com.br/api/'

export type LojaOmie = {
  id: number
  omie_app_key: string
  omie_app_secret: string
  is_test: boolean
}

export interface OmieRequestParams {
  loja_id: number
  omie_app_key: string
  omie_app_secret: string
  is_test: boolean
  endpoint: string // ex: 'v1/geral/produtos'
  call: string // ex: 'ListarProdutos'
  data: Record<string, unknown>
}

export class OmieError extends Error {
  constructor(
    message: string,
    public readonly faultCode?: string,
    public readonly httpStatus?: number
  ) {
    super(message)
    this.name = 'OmieError'
  }
}

// Convenção Omie 100% consistente (confirmada em toda a base hoje, sem
// exceção): calls de escrita sempre começam com um destes verbos.
function ehChamadaDeEscrita(call: string): boolean {
  return /^(Incluir|Alterar|Excluir|Concluir|Reverter)/.test(call)
}

// omieRequest<T> já faz um cast (json as T), não valida shape em
// runtime -- um objeto "shotgun" só com os nomes de campo de ID usados
// de verdade no código evita ter que mapear call -> campo
// individualmente (cada função de escrita só lê o campo que espera, o
// resto é ignorado).
// Contador de processo -- garante ids distintos mesmo quando várias
// chamadas simuladas acontecem no mesmo milissegundo (ex: laço de
// transferência/ajuste em lote, que na loja de teste roda sem a
// latência de rede real da Omie). Sem isso, ids repetidos batiam em
// índices únicos reais (ex: movimentos(loja_id, id_ajuste)).
let contadorSimulado = 0

function respostaSimulada(): Record<string, unknown> {
  contadorSimulado = (contadorSimulado + 1) % 1_000_000
  const idFicticio = -(Date.now() * 1000 + contadorSimulado)
  return {
    nCodOP: idFicticio,
    cCodIntOP: `TESTE-${idFicticio}`,
    cNumOP: String(idFicticio),
    nCodProduto: idFicticio,
    nCodFamilia: idFicticio,
    nCodLocalEstoque: idFicticio,
    nCodCli: idFicticio,
    nCodEstrutura: idFicticio,
    codigo: idFicticio,
    codigo_cliente_omie: idFicticio,
    codigo_produto: idFicticio,
    codigo_status: '0',
    descricao_status: 'Simulado (loja de teste, nenhuma chamada real feita)',
    id_ajuste: idFicticio,
    id_movest: idFicticio,
  }
}

/**
 * Chamada generica ao Omie com retry/backoff e tratamento de rate limit (425/429).
 * Mantem a politica do sistema Laravel: aguarda ~60s ao tomar rate limit, ate 3 tentativas.
 *
 * Lojas de teste (is_test=true): calls de ESCRITA nunca saem de
 * verdade -- retorna uma resposta simulada e loga em
 * integration_attempts com o model prefixado "[SIMULADO]". Calls de
 * LEITURA sempre passam normal, usando a credencial real (mesma da
 * loja de origem, pra trazer dado real).
 */
export async function omieRequest<T = unknown>({
  loja_id,
  omie_app_key,
  omie_app_secret,
  is_test,
  endpoint,
  call,
  data,
}: OmieRequestParams): Promise<T> {
  if (is_test && ehChamadaDeEscrita(call)) {
    const simulada = respostaSimulada()
    await logIntegrationAttempt({
      loja_id,
      model: `[SIMULADO] ${call}`,
      request: JSON.stringify(data),
      response: JSON.stringify(simulada),
      code: '0',
    })
    return simulada as T
  }

  const body = JSON.stringify({
    app_key: omie_app_key,
    app_secret: omie_app_secret,
    call,
    param: [data],
  })

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${OMIE_BASE_URL}${endpoint}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      // Rate limit do Omie
      if (res.status === 429 || res.status === 425) {
        await sleep(60_000)
        continue
      }

      const json = (await res.json().catch(() => null)) as
        | (T & { faultstring?: string; faultcode?: string })
        | null

      if (!res.ok || (json && 'faultstring' in json && json.faultstring)) {
        const faultCode = json?.faultcode
        const msg = json?.faultstring || `Omie HTTP ${res.status}`
        // "Nao existem registros para a pagina [N]" nao e erro: e fim/lista vazia.
        // O Laravel tratava como objeto vazio. Retornamos {} para o sync encerrar limpo.
        if (/n.o existem registros/i.test(msg)) {
          return {} as T
        }
        // Limite de concorrencia / consumo redundante do Omie: vem como faultstring,
        // nao HTTP 429. Aguarda (honrando "Aguarde N segundos" quando informado) e retenta.
        if (/j. existe uma requisi|consumo redundante|too many requests|aguarde/i.test(msg)) {
          if (attempt < 2) {
            const pedido = msg.match(/aguarde\s+(\d+)\s*segundos/i)
            const espera = pedido ? Math.min(Number(pedido[1]) + 2, 60) * 1000 : 5000 * (attempt + 1)
            await sleep(espera)
            continue
          }
        }
        throw new OmieError(msg, faultCode, res.status)
      }

      return json as T
    } catch (e) {
      lastError = e as Error
      // erro de rede: backoff progressivo; faltas de negocio Omie nao retentam
      if (e instanceof OmieError) throw e
      if (attempt < 2) await sleep(2000 * (attempt + 1))
    }
  }

  throw lastError ?? new Error('Falha desconhecida na chamada Omie')
}

export async function logIntegrationAttempt(params: {
  loja_id: number
  model: string
  request: string
  response?: string
  code?: string
  error?: boolean
  error_message?: string
}) {
  const supabase = createServiceClient()
  await supabase.from('integration_attempts').insert({
    loja_id: params.loja_id,
    model: params.model,
    request: params.request,
    response: params.response ?? null,
    code: params.code ?? null,
    error: params.error ?? false,
    error_message: params.error_message ?? null,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
