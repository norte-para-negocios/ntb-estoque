import { createHmac, timingSafeEqual } from 'node:crypto'

// Fase 12 (velocidade, 06/11/2026): o proxy (proxy.ts) já confere a sessão no servidor de login (auth.getUser) em toda
// requisição, e a página fazia a MESMA ida de novo (lib/auth.ts). Medido no Contabo: cada ida ao /auth/v1/user leva de
// 0,3 a 1,4 s. Agora o proxy, depois de conferir, assina "este usuário, com este token de acesso" e passa a assinatura num
// cabeçalho interno da requisição; a página só pula a segunda ida se a assinatura bater com o token do cookie que ela
// mesma lê. Sem a chave, sem o cabeçalho ou com qualquer diferença: volta para auth.getUser(), como antes.
// Quem chama de fora não forja: a chave é a service role (só no servidor) e o proxy apaga o cabeçalho que vier de fora.

export const CABECALHO_SESSAO = 'x-ntb-sessao-verificada'

function hmac(chave: string, userId: string, accessToken: string): string {
  return createHmac('sha256', chave).update(`ntb-sessao-v1\n${userId}\n${accessToken}`).digest('base64url')
}

/** Valor do cabeçalho: "<id do usuário>.<assinatura>". */
export function assinarSessao(chave: string, userId: string, accessToken: string): string {
  return `${userId}.${hmac(chave, userId, accessToken)}`
}

/** Id do usuário se a assinatura for do proxy para ESTE token de acesso; senão null (a página confere no login). */
export function conferirSessao(chave: string | undefined, valor: string | null | undefined, accessToken: string | null | undefined): string | null {
  if (!chave || !valor || !accessToken) return null
  const ponto = valor.lastIndexOf('.')
  if (ponto <= 0) return null
  const userId = valor.slice(0, ponto)
  const recebida = Buffer.from(valor.slice(ponto + 1))
  const esperada = Buffer.from(hmac(chave, userId, accessToken))
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null
  return userId
}
