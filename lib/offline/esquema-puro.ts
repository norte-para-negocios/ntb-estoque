// Hash do esquema do app desktop (desktop/schema/*.sql) e decisão do servidor sobre /api/offline/*.
import { createHash } from 'node:crypto'

export type ArquivoEsquema = { nome: string; texto: string }

/** Hash curto estável: arquivos ordenados por nome, nome + conteúdo. */
export function hashDoEsquema(arquivos: ArquivoEsquema[]): string {
  const h = createHash('sha256')
  for (const a of [...arquivos].sort((x, y) => (x.nome < y.nome ? -1 : x.nome > y.nome ? 1 : 0))) {
    h.update(a.nome).update('\0').update(a.texto).update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

export type DecisaoEsquema = { ok: true } | { ok: false; status: 426; mensagem: string }

/**
 * App que manda hash diferente do atual (e fora da lista de aceitos) é recusado com 426.
 * App sem hash (1.0.3/1.0.4) passa, a menos que `exigirHash`: a recusa dele é pela versão mínima.
 */
export function decidirEsquema(p: { hashApp: string | null; hashAtual: string; aceitos?: string[]; exigirHash?: boolean }): DecisaoEsquema {
  const recusa: DecisaoEsquema = { ok: false, status: 426, mensagem: 'Atualize o Norte Estoque para continuar' }
  if (!p.hashApp) return p.exigirHash ? recusa : { ok: true }
  if (p.hashApp === p.hashAtual || (p.aceitos ?? []).includes(p.hashApp)) return { ok: true }
  return recusa
}
