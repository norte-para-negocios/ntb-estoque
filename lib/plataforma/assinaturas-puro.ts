// Plataforma Norte: converte as linhas lidas de plataforma_assinaturas em estados gravados (PURO; node --test).
// Erro de leitura ou valor desconhecido = ignora (cai no padrão: loja sem configuração = tudo como hoje).
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { MODULOS, ESTADOS, type ModuloId, type Estado } from './modulos-puro.ts'

export function gravadosDe(rows: { modulo_id: string; estado: string }[] | null, error: unknown): Partial<Record<ModuloId, Estado>> {
  if (error || !rows) return {}
  const out: Partial<Record<ModuloId, Estado>> = {}
  for (const r of rows) {
    const modulo = MODULOS.find((m) => m.id === r.modulo_id)?.id
    const estado = ESTADOS.find((e) => e === r.estado)
    if (modulo && estado) out[modulo] = estado
  }
  return out
}
