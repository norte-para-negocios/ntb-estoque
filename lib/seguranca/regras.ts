// Regras puras de segurança (Fase H, 19/10/2026). Sem imports: testável com `node --test lib/seguranca/regras.test.ts`.
// Quem usa: crons (cronAutorizado), canal do desktop e login (ipDoCliente, criarLimitador), exportações CSV
// (celulaCsv), next.config (cabecalhosSeguranca), webhook do Omie (webhookTokenOk), canal /api/offline/acao
// (acaoSoDoServidor) e cadastro de loja (camposChavesOmie).

/** Comparação de texto em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres bateram). */
export function iguaisTempoConstante(a: string, b: string): boolean {
  let dif = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return dif === 0
}

/**
 * Header Authorization de um cron. Sem segredo configurado (env vazia) NUNCA autoriza: antes, com CRON_SECRET
 * ausente, o header "Bearer undefined" passava.
 */
export function cronAutorizado(authorization: string | null | undefined, segredo: string | null | undefined): boolean {
  if (!segredo || segredo.length < 16) return false
  if (!authorization?.startsWith('Bearer ')) return false
  return iguaisTempoConstante(authorization.slice(7), segredo)
}

/**
 * IP do cliente atrás do nginx do Contabo. O nginx grava `X-Real-IP $remote_addr` (o IP de verdade) e
 * `X-Forwarded-For $proxy_add_x_forwarded_for` (o que o cliente mandou + o IP real no FIM). Pegar o primeiro
 * item do X-Forwarded-For deixava qualquer um trocar de "IP" a cada tentativa e furar o limite de login.
 */
export function ipDoCliente(get: (nome: string) => string | null): string {
  const real = get('x-real-ip')?.trim()
  if (real) return real
  const xff = (get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return xff.length ? xff[xff.length - 1] : 'desconhecido'
}

/** Limite de tentativas por chave numa janela (memória do processo). `agora` injetável para teste. */
export function criarLimitador(max: number, janelaMs: number, tetoChaves = 5000) {
  const tentativas = new Map<string, number[]>()
  return function excedeu(chave: string, agora: number = Date.now()): boolean {
    const lista = (tentativas.get(chave) ?? []).filter((t) => agora - t < janelaMs)
    lista.push(agora)
    tentativas.set(chave, lista)
    if (tentativas.size > tetoChaves) {
      // Poda só as chaves sem tentativa recente (limpar tudo de uma vez zerava o limite de quem está atacando).
      for (const [k, v] of tentativas) if (!v.some((t) => agora - t < janelaMs)) tentativas.delete(k)
    }
    return lista.length > max
  }
}

const NUMERO = /^[-+]?\d[\d.,]*$/

/**
 * Campo de CSV para Excel pt-BR (separador ';'). Texto que começa com = + - @ (ou TAB/CR) vira fórmula no Excel
 * ("injeção de fórmula": uma descrição de produto vinda da nota do fornecedor como =HYPERLINK(...) roda ao abrir).
 * Prefixa com apóstrofo, que o Excel mostra como texto. Número (inclusive negativo, "-12,5") passa intacto.
 */
export function celulaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  let s = String(valor)
  if (/^[=+\-@\t\r]/.test(s) && !(typeof valor === 'number' || NUMERO.test(s))) s = `'${s}`
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Cabeçalhos HTTP de segurança do app web. No app desktop (127.0.0.1, http) não manda HSTS. */
export function cabecalhosSeguranca(opts: { desktop: boolean }): { key: string; value: string }[] {
  const lista = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'" },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Câmera fica liberada para a própria origem (leitor de código de barras, html5-qrcode).
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  ]
  if (!opts.desktop) lista.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' })
  return lista
}

/**
 * Webhook do Omie: o Omie não assina o aviso. Com OMIE_WEBHOOK_TOKEN configurado, o endereço cadastrado no Omie
 * passa a ser `/api/webhook?t=<token>` e aviso sem o token é ignorado. Sem a env, nada muda (compatível com o
 * endereço já cadastrado nos apps do Omie).
 */
export function webhookTokenOk(tokenRecebido: string | null, esperado: string | null | undefined): boolean {
  if (!esperado) return true
  return !!tokenRecebido && iguaisTempoConstante(tokenRecebido, esperado)
}

/**
 * Funções exportadas de arquivos 'use server' que são de CRON (recebem a lista de lojas, com as chaves do Omie,
 * como argumento e rodam para todas). Pelo canal do desktop qualquer usuário logado conseguia chamá-las com
 * qualquer loja (inclusive marcando a loja como teste para "simular" envios pendentes reais).
 */
const SO_DO_SERVIDOR = new Set([
  'inventario#retryAjustesInventarioPendentes',
  'movimentacoes#retryMovimentosManuaisPendentes',
  'ordem-producao#retryOPsPendentes',
  'transferencia#retryMovimentosTransferenciaPendentes',
])
export function acaoSoDoServidor(nome: string): boolean {
  return SO_DO_SERVIDOR.has(nome) || /#retry[A-Z]/.test(nome)
}

/**
 * Chaves do Omie no salvar da loja. A tela não recebe mais as chaves (só se existem e os 4 últimos caracteres):
 * campo em branco = manter a que está gravada. Fora do modo omie as chaves são apagadas (regra de sempre).
 */
export function camposChavesOmie(
  modo: string,
  appKey: string | null | undefined,
  appSecret: string | null | undefined,
): { omie_app_key?: string | null; omie_app_secret?: string | null } {
  if (modo !== 'omie') return { omie_app_key: null, omie_app_secret: null }
  const out: { omie_app_key?: string; omie_app_secret?: string } = {}
  const k = (appKey ?? '').trim()
  const s = (appSecret ?? '').trim()
  if (k) out.omie_app_key = k
  if (s) out.omie_app_secret = s
  return out
}

/** Os 4 últimos caracteres de um segredo, mascarados (para a tela mostrar qual chave está gravada). */
export function finalSegredo(v: string | null | undefined): string | null {
  if (!v) return null
  return v.length <= 4 ? '****' : `****${v.slice(-4)}`
}
