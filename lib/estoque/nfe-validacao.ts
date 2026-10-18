// Validação do XML de NF-e importado (upload ou SEFAZ) para a loja de estoque próprio (R11 do plano da Fase B).
// Puro e testável com `node --test`. Erros bloqueiam a entrada; avisos deixam a nota "divergente" para a pessoa conferir.
// A conferência criptográfica da assinatura é feita fora (nfe-assinatura.ts, servidor) e chega pronta em `assinaturaConfere`.
import type { NfeLida } from './nfe-xml'

export const TAMANHO_MAX_XML_BYTES = 1_000_000

/** Erros antes de ler o XML: tamanho em bytes (UTF-8) e DOCTYPE/ENTITY (XML de NF-e nunca tem). */
export function validarXmlBruto(xml: string): string[] {
  const erros: string[] = []
  if (new TextEncoder().encode(xml).length > TAMANHO_MAX_XML_BYTES) erros.push('O arquivo passa de 1 MB.')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) erros.push('O XML tem DOCTYPE/ENTITY: não é uma NF-e válida.')
  return erros
}

export type ContextoValidacao = { cnpjLoja: string | null; assinaturaConfere: boolean | null }

const dig = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '')

export function validarNfeImportada(nfe: NfeLida, ctx: ContextoValidacao): { erros: string[]; avisos: string[] } {
  const erros: string[] = []
  const avisos: string[] = []
  const loja = dig(ctx.cnpjLoja)
  const emitente = dig(nfe.fornecedor.cnpj)
  const p = nfe.protocolo
  if (!p) erros.push('Este XML não tem o protocolo de autorização da SEFAZ (baixe o XML autorizado, procNFe).')
  else {
    if (p.cStat !== '100' && p.cStat !== '150') erros.push(`A SEFAZ não autorizou esta nota (situação ${p.cStat || 'sem código'}).`)
    if (p.chave && p.chave !== nfe.chave) erros.push('O protocolo é de outra chave de acesso.')
  }
  if (nfe.ambiente === '2' || p?.tpAmb === '2') erros.push('Nota de homologação (teste): não entra no estoque.')
  if (!nfe.assinatura.presente) erros.push('O XML não tem a assinatura digital do emitente.')
  if (loja && emitente === loja) erros.push('Esta nota foi emitida pela própria loja.')
  if (nfe.chave.slice(6, 20) !== emitente) erros.push('A chave de acesso não é do CNPJ do emitente.')
  const modelo = nfe.modelo ?? nfe.chave.slice(20, 22)
  if (modelo !== '55') erros.push(`Não é NF-e (modelo ${modelo}): só notas modelo 55 entram aqui.`)

  if (ctx.assinaturaConfere === false) avisos.push('A assinatura digital não confere com o conteúdo do XML.')
  const dest = dig(nfe.destinatario?.cnpj)
  if (loja && dest !== loja) avisos.push('O destinatário da nota não é o CNPJ desta loja.')
  return { erros, avisos }
}
