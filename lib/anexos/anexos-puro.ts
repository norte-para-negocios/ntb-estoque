// Anexos nos registros (Fase G [O2], migration 221). Regras puras (sem @/): node --test lib/anexos/anexos-puro.test.ts
// O tipo do arquivo é decidido pelo CONTEÚDO (assinatura dos primeiros bytes) e precisa bater com a extensão: um
// executável renomeado para .pdf é recusado. Zip só vale como .xlsx/.docx; texto (xml/csv/txt) não pode ter byte nulo.

export const ENTIDADES_ANEXO = ['produto', 'nota_entrada', 'pedido_compra', 'op'] as const
export type EntidadeAnexo = (typeof ENTIDADES_ANEXO)[number]
export const LIMITE_ANEXO_BYTES = 8 * 1024 * 1024 // o proxy do Next guarda até 10 MB do corpo; folga para o multipart
export const MAX_ANEXOS_POR_REGISTRO = 20

export type TipoAnexo = { ext: string; mime: string; inline: boolean }

const TIPOS: Record<string, TipoAnexo> = {
  pdf: { ext: 'pdf', mime: 'application/pdf', inline: true },
  png: { ext: 'png', mime: 'image/png', inline: true },
  jpg: { ext: 'jpg', mime: 'image/jpeg', inline: true },
  webp: { ext: 'webp', mime: 'image/webp', inline: true },
  xml: { ext: 'xml', mime: 'application/xml', inline: false },
  csv: { ext: 'csv', mime: 'text/csv', inline: false },
  txt: { ext: 'txt', mime: 'text/plain', inline: false },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false },
}
/** Lista para o bucket (allowed_mime_types) e para o accept do input. */
export const MIMES_ANEXO = [...new Set(Object.values(TIPOS).map((t) => t.mime))]
export const ACCEPT_ANEXO = '.pdf,.png,.jpg,.jpeg,.webp,.xml,.csv,.txt,.xlsx,.docx'

function extensao(nome: string): string {
  const m = nome.toLowerCase().match(/\.([a-z0-9]{1,5})$/)
  const e = m?.[1] ?? ''
  return e === 'jpeg' ? 'jpg' : e
}

const comeca = (b: Uint8Array, sig: number[], desde = 0) => sig.every((x, i) => b[desde + i] === x)

export function tipoPorConteudo(bytes: Uint8Array, nome: string): TipoAnexo | null {
  const ext = extensao(nome)
  let detectado: string | null = null
  if (comeca(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) detectado = 'pdf'
  else if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detectado = 'png'
  else if (comeca(bytes, [0xff, 0xd8, 0xff])) detectado = 'jpg'
  else if (comeca(bytes, [0x52, 0x49, 0x46, 0x46]) && comeca(bytes, [0x57, 0x45, 0x42, 0x50], 8)) detectado = 'webp'
  else if (comeca(bytes, [0x50, 0x4b, 0x03, 0x04])) detectado = ext === 'xlsx' || ext === 'docx' ? ext : null
  else if (ext === 'xml' || ext === 'csv' || ext === 'txt') {
    const amostra = bytes.subarray(0, 4096)
    if (!amostra.includes(0)) detectado = ext
  }
  if (!detectado || detectado !== ext) return null
  return TIPOS[detectado]
}

export function limparNome(nome: string): string {
  const base = (nome.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^\p{L}\p{N}._\- ()º°ª]/gu, '_').replace(/\s+/g, ' ').trim()
  if (!base || /^\.+$/.test(base)) return 'arquivo'
  if (base.length <= 120) return base
  const m = base.match(/(\.[^.]{1,5})$/)
  const ext = m ? m[1] : ''
  return base.slice(0, 120 - ext.length) + ext
}

export function validarAnexo(a: { nome: string; tamanho: number; bytes: Uint8Array; existentes: number }): { ok: true; tipo: TipoAnexo; nome: string } | { ok: false; erro: string } {
  if (a.existentes >= MAX_ANEXOS_POR_REGISTRO) return { ok: false, erro: `Este registro já tem ${MAX_ANEXOS_POR_REGISTRO} anexos (o máximo). Exclua algum antes de enviar outro.` }
  if (!(a.tamanho > 0) || a.bytes.length === 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (a.tamanho > LIMITE_ANEXO_BYTES) return { ok: false, erro: 'Arquivo muito grande: o limite é 8 MB.' }
  const tipo = tipoPorConteudo(a.bytes, a.nome)
  if (!tipo) return { ok: false, erro: 'Tipo de arquivo não aceito (ou o conteúdo não confere com a extensão). Aceitos: PDF, imagem (PNG, JPG, WEBP), XML, CSV, TXT, XLSX e DOCX.' }
  return { ok: true, tipo, nome: limparNome(a.nome) }
}

/** Caminho no bucket: pasta da loja primeiro (as políticas do Storage conferem por ela) e só caracteres ascii. */
export function caminhoAnexo(lojaId: number, entidade: EntidadeAnexo, entidadeId: string | number, uuid: string, ext: string): string {
  return `loja-${lojaId}/${entidade}/${entidadeId}/${uuid}.${ext}`
}

export function cabecalhoDownload(nome: string, inline: boolean): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

/** POST de envio só da própria origem (sem Origin = chamada sem navegador, a sessão ainda é exigida). */
export function origemAceita(origin: string | null, host: string | null): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Nesta fase os anexos ficam só no estoque próprio (no modo Omie nada muda além de leitura). */
export function anexosPermitidos(modo: string | null | undefined): boolean {
  return modo === 'proprio'
}
