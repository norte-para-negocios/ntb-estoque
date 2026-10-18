// Decisões da entrada da nota do estoque próprio (revisão final da Fase B): confirmar com avisos, lançar na gravação
// (SEFAZ / upload do XML), resultado do lancar_compra e as refs do ledger de cada ciclo (entrada desfeita = compra
// reaberta, a nova entrada usa <ref>#<n>, migration 185). Puro: `node --test lib/estoque/nf-entrada.test.ts`.
// @ts-ignore: o import com extensão .ts é exigido pelo node --test (type stripping); o tsc do Next não o aceita
import { decidirConferencia } from './nf-item-regras.ts'
import type { AlertaItem } from './nf-item-regras'

type AlertasPorLinha = { linha: number; alertas: AlertaItem[] }[]

/** Avisos que só passam com "Conferi os avisos" (mesma lista de decidirConferencia). */
const SEGURAM = new Set<AlertaItem['tipo']>(['fator_suspeito', 'custo_fora', 'valor_zero'])

/** "Confirmar entrada": item com aviso de fator/custo/valor zero só entra com "Conferi os avisos" agora, ou com a nota
 *  conferida depois da última mudança de item (configurar/vincular/CT-e zeram conferida_em; a conferência exigiu o aceite). */
export function decidirConfirmacaoEntrada(alertas: AlertasPorLinha, e: { conferida: boolean; aceitarAvisos: boolean }): { ok: true; aceitos: { linha: number; tipo: AlertaItem['tipo'] }[] } | { error: string } {
  if (e.conferida) return { ok: true, aceitos: [] }
  return decidirConferencia(alertas, e.aceitarAvisos)
}

/** Na gravação da nota (SEFAZ ou upload do XML): lança só sem aviso que segura o item e nunca a compra reaberta
 *  (entrada desfeita: volta só pelo "Confirmar entrada"). */
export function decidirLancamentoNaGravacao(e: {
  automatico: boolean; lancarParcial: boolean; casados: number; alertasItens: AlertasPorLinha; statusCompra: string; reaberta: boolean; temLocal: boolean
}): { lancar: boolean; retida: 'avisos' | 'reaberta' | null } {
  const quer = e.automatico || (e.lancarParcial && e.casados > 0)
  if (!quer || !e.temLocal || !(e.statusCompra === 'pendente' || e.statusCompra === 'parcial')) return { lancar: false, retida: null }
  if (e.reaberta) return { lancar: false, retida: 'reaberta' }
  if (e.alertasItens.some((a) => a.alertas.some((x) => SEGURAM.has(x.tipo)))) return { lancar: false, retida: 'avisos' }
  return { lancar: true, retida: null }
}

/** Retorno do lancar_compra para a tela: recusada (manifestação negativa) e cancelada (SEFAZ) são erro. */
export function resultadoLancamento(r: { ok?: boolean; status: string; lancados: number; pendentes: number; motivo?: string }): { ok: true; status: string; lancados: number; pendentes: number } | { error: string } {
  if (r.status === 'cancelada') return { error: 'Nota cancelada na SEFAZ: não entra no estoque.' }
  if (r.status === 'recusada') return { error: 'A operação foi recusada na SEFAZ (desconhecimento ou operação não realizada): a nota não entra no estoque.' }
  if (r.ok === false) return { error: `A entrada não foi feita: ${r.motivo ?? r.status}.` }
  return { ok: true, status: r.status, lancados: Number(r.lancados) || 0, pendentes: Number(r.pendentes) || 0 }
}

/** Refs do ledger (estoque_movimentos.ref, origem COMPRA) de todas as entradas desta compra: 1ª = chave (ou compra:<id>),
 *  depois de cada entrada desfeita <ref>#2, #3… */
export function refsDaEntrada(chave: string | null, compraId: number | null, estornos: number): string[] {
  const bases = [chave, compraId != null ? `compra:${compraId}` : null].filter((x): x is string => !!x)
  const out = [...bases]
  for (let n = 2; n <= Math.max(0, estornos) + 1; n++) out.push(...bases.map((b) => `${b}#${n}`))
  return out
}

/** Ref sem o número do ciclo (para achar a compra a partir do movimento). */
export function refBaseDaEntrada(ref: string): string {
  return ref.replace(/#\d+$/, '')
}
