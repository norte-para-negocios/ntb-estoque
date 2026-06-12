import { createServiceClient } from '@/lib/supabase/server'

const OMIE_BASE_URL = 'https://app.omie.com.br/api/'

export type LojaOmie = {
  id: number
  omie_app_key: string
  omie_app_secret: string
}

export interface OmieRequestParams {
  loja_id: number
  omie_app_key: string
  omie_app_secret: string
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

/**
 * Chamada generica ao Omie com retry/backoff e tratamento de rate limit (425/429).
 * Mantem a politica do sistema Laravel: aguarda ~60s ao tomar rate limit, ate 3 tentativas.
 */
export async function omieRequest<T = unknown>({
  omie_app_key,
  omie_app_secret,
  endpoint,
  call,
  data,
}: OmieRequestParams): Promise<T> {
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
