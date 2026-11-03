// Leituras que decidem o caminho de uma escrita no estoque próprio (Fase 1, 03/11/2026). Regra: erro de leitura NUNCA vira
// "lista vazia". Ex.: se a leitura de fichas_tecnicas falha e vira [], a venda baixa o próprio prato em vez dos insumos e o
// ledger fica errado sem aviso (a chave idempotente já gravou, o retry não corrige). Puro: sem import de valor.
import type { ResultadoItemProprio } from './plano-baixa.ts'

export type RespostaLeitura<T> = { data: T | null; error: { message: string } | null }

/** Devolve as linhas da consulta; com erro, lança `Falha ao ler <oQue>: <mensagem>`. `data` nulo sem erro vira []. */
export function exigirLeitura<T>(r: RespostaLeitura<T>, oQue: string): T {
  if (r.error) throw new Error(`Falha ao ler ${oQue}: ${r.error.message}`)
  return (r.data ?? []) as T
}

/** Resposta da venda inteira quando nada pode ser gravado: todos os itens retentáveis (nada foi gravado). */
export function todosPulados(itens: { codigo?: string | null }[], erro: string): ResultadoItemProprio[] {
  return itens.map((i) => ({ codigo: i?.codigo || '?', ok: false, op: 'pulada', baixa: 'pulada', erro }))
}

/** Erro da migration 308 (PF002): mesma chave de idempotência já gravada com outro tipo/quantidade. Não é retentável. */
export function ehConflitoIdempotencia(mensagem: string): boolean {
  return /conflito de idempot[eê]ncia/i.test(mensagem)
}
