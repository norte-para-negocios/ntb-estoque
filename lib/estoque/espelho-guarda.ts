// D5 (20/10/2026): guarda dos crons do espelho completo quando ele roda em várias lojas (2, 3, 6...).
// O Omie bloqueia por 30 min (HTTP 425) na 10ª requisição com erro no mesmo IP + App Key + método, e as lojas
// dividem o mesmo IP do servidor. Um bloqueio na chave de uma loja pode parar a integração de vendas dela
// (o nosso disjuntor trava a chave inteira quando um 2º método bloqueia). Regras:
//  - erro de limite/bloqueio (ou recusa do nosso disjuntor) em qualquer frente → a loja inteira sai do espelho por
//    PAUSA_LOJA_MIN (mais que os 30 min do Omie), em todas as frentes;
//  - outro erro do Omie → só aquela frente espera 10, 20, 40, 80 min...; na TETO_FALHAS-ésima falha seguida para por
//    PAUSA_TETO_H horas (no máximo ~5 erros por dia por frente, longe dos 10 do bloqueio);
//  - leitura boa zera a contagem.
// Rodízio: a cada ciclo de 10 min a ordem das lojas gira, para o orçamento de tempo não ficar sempre com a 1ª.
// Puro, sem imports: node --test lib/estoque/espelho-guarda.test.ts.

export type GuardaFrente = { falhas: number; pausado_ate: string | null; ultimo_erro: string | null }
export type GuardaLoja = { pausado_ate: string | null; motivo: string | null }

export const PAUSA_LOJA_MIN = 60
export const TETO_FALHAS = 5
export const PAUSA_TETO_H = 24
/** Janela em que um `[BLOQUEIO OMIE]` gravado em integration_attempts tira a loja do espelho (bloqueio = 30 min). */
export const JANELA_BLOQUEIO_LOG_MIN = 35

export function guardaVazia(): GuardaFrente {
  return { falhas: 0, pausado_ate: null, ultimo_erro: null }
}

export function lerGuardaFrente(bruto: unknown): GuardaFrente {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const falhas = Number(b.falhas)
  return {
    falhas: Number.isFinite(falhas) && falhas > 0 ? Math.floor(falhas) : 0,
    pausado_ate: typeof b.pausado_ate === 'string' ? b.pausado_ate : null,
    ultimo_erro: typeof b.ultimo_erro === 'string' ? b.ultimo_erro : null,
  }
}

export function lerGuardaLoja(bruto: unknown): GuardaLoja {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  return {
    pausado_ate: typeof b.pausado_ate === 'string' ? b.pausado_ate : null,
    motivo: typeof b.motivo === 'string' ? b.motivo : null,
  }
}

export function pausadoAgora(pausadoAte: string | null, agoraMs: number): boolean {
  return !!pausadoAte && Date.parse(pausadoAte) > agoraMs
}

/** Minutos de espera depois da n-ésima falha seguida (n ≥ 1): 10, 20, 40, 80; no teto, PAUSA_TETO_H horas. */
export function minutosDePausa(falhas: number): number {
  if (falhas >= TETO_FALHAS) return PAUSA_TETO_H * 60
  return 10 * 2 ** Math.max(0, falhas - 1)
}

/** ok = ciclo terminou sem erro (zera a contagem); neutro = não chegou a ler (trava, intervalo, orçamento): não zera. */
export type ParadaFrente = 'ok' | 'neutro' | 'limite' | 'erro'

/**
 * Como a frente terminou, pelo `parouPor` que os crons já devolvem: "limite do Omie: ..." / "erro do Omie: ..." vêm
 * da leitura do Omie, "erro interno: ..." de exceção (banco, rede); trava, intervalo, orçamento e "filtro de data
 * ignorado" não contam.
 */
export function classificarParada(parouPor: string | null | undefined): ParadaFrente {
  if (!parouPor) return 'ok'
  if (/^limite do Omie/i.test(parouPor)) return 'limite'
  if (/^(erro do Omie|erro interno)/i.test(parouPor)) return 'erro'
  // Revisão I1 (20/10): "intervalo de 30 min"/"trava" NÃO são sucesso. Antes zeravam a contagem e, nas OPs abertas
  // (trava de 30 min depois de cada passada), o erro de ConsultarOrdemProducao nunca passava de 1 falha: ~34 erros/dia.
  return 'neutro'
}

/** Estado novo da frente e, se for o caso, até quando a loja inteira fica fora do espelho. */
export function aposFrente(
  g: GuardaFrente, parada: ParadaFrente, motivo: string | null, agoraMs: number
): { guarda: GuardaFrente; mudou: boolean; pausaLojaAte: string | null } {
  if (parada === 'neutro') return { guarda: g, mudou: false, pausaLojaAte: null }
  if (parada === 'ok') {
    const mudou = g.falhas > 0 || g.pausado_ate != null
    return { guarda: mudou ? guardaVazia() : g, mudou, pausaLojaAte: null }
  }
  const falhas = g.falhas + 1
  const pausado_ate = new Date(agoraMs + minutosDePausa(falhas) * 60_000).toISOString()
  const guarda: GuardaFrente = { falhas, pausado_ate, ultimo_erro: (motivo ?? '').slice(0, 500) || null }
  const pausaLojaAte = parada === 'limite' ? new Date(agoraMs + PAUSA_LOJA_MIN * 60_000).toISOString() : null
  return { guarda, mudou: true, pausaLojaAte }
}

/** Ordem das lojas neste ciclo de `cicloMs`: gira uma posição por ciclo. */
export function ordemRodizio<T>(lojas: T[], agoraMs: number, cicloMs = 600_000): T[] {
  if (lojas.length < 2) return [...lojas]
  const k = Math.floor(agoraMs / cicloMs) % lojas.length
  return [...lojas.slice(k), ...lojas.slice(0, k)]
}
