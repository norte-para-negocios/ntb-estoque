// Transporte dos argumentos e do resultado de uma server action entre o app desktop e o servidor.
// Server actions recebem FormData/File/Date; aqui tudo vira JSON e volta igual do outro lado.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const LIMITE_ARQUIVO = 15 * 1024 * 1024

async function paraJson(v: unknown): Promise<Json> {
  if (v === undefined) return { __indef: true }
  if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Date) return { __data: v.toISOString() }
  if (typeof Blob !== 'undefined' && v instanceof Blob) {
    if (v.size > LIMITE_ARQUIVO) throw new Error('Arquivo grande demais para enviar pelo app (máx. 15 MB).')
    const b64 = Buffer.from(await v.arrayBuffer()).toString('base64')
    const nome = (v as File).name ?? 'arquivo'
    return { __arq: { nome, tipo: v.type, b64 } }
  }
  if (typeof FormData !== 'undefined' && v instanceof FormData) {
    const pares: Json[] = []
    for (const [k, val] of v.entries()) pares.push([k, await paraJson(val)])
    return { __fd: pares }
  }
  if (Array.isArray(v)) return Promise.all(v.map(paraJson))
  if (typeof v === 'object') {
    const o: { [k: string]: Json } = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = await paraJson(val)
    return o
  }
  throw new Error(`Tipo de argumento não suportado: ${typeof v}`)
}

function deJson(v: Json): unknown {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(deJson)
  if ('__indef' in v) return undefined
  if ('__data' in v && typeof v.__data === 'string') return new Date(v.__data)
  if ('__arq' in v && v.__arq && typeof v.__arq === 'object' && !Array.isArray(v.__arq)) {
    const a = v.__arq as { nome: string; tipo: string; b64: string }
    return new File([Buffer.from(a.b64, 'base64')], a.nome, { type: a.tipo })
  }
  if ('__fd' in v && Array.isArray(v.__fd)) {
    const fd = new FormData()
    for (const par of v.__fd as Json[][]) {
      const val = deJson(par[1])
      fd.append(String(par[0]), val instanceof Blob ? val : String(val))
    }
    return fd
  }
  const o: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) o[k] = deJson(val)
  return o
}

export async function serializarArgs(args: ArrayLike<unknown>): Promise<Json> {
  return Promise.all(Array.from(args).map(paraJson))
}

export function desserializarArgs(json: Json): unknown[] {
  if (!Array.isArray(json)) throw new Error('args inválidos')
  return json.map(deJson)
}

export async function serializarValor(v: unknown): Promise<Json> {
  return paraJson(v)
}

export function desserializarValor(v: Json): unknown {
  return deJson(v)
}

export type Interrupcao = { tipo: 'redirect'; url: string; modo: 'push' | 'replace'; status: number } | { tipo: 'notfound' }

/** Lê o erro especial que redirect()/notFound() lançam (digest NEXT_REDIRECT;modo;url;status;). */
export function lerDigest(err: unknown): Interrupcao | null {
  const d = (err as { digest?: unknown } | null)?.digest
  if (typeof d !== 'string') return null
  if (d.startsWith('NEXT_REDIRECT;')) {
    const partes = d.split(';')
    const modo = partes[1] === 'push' ? 'push' : 'replace'
    // a URL pode conter ';' -- tudo entre o modo e o status
    const status = Number(partes[partes.length - 2]) || 307
    const url = partes.slice(2, partes.length - 2).join(';')
    return { tipo: 'redirect', url, modo, status }
  }
  if (d.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')) return { tipo: 'notfound' }
  return null
}
