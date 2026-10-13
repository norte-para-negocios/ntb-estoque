// Kardex da loja inteira (/estoque/kardex, "nosso Omie" Fase 2): filtros da URL, página e CSV. Puro, sem imports:
// node --test lib/estoque/kardex-loja-puro.test.ts.

export type FiltrosKardexLoja = {
  ini: string; fim: string; produto: number | null; q: string; local: number | null; origem: string; autor: string
  page: number; erro: string | null
}

export const MAX_DIAS_KARDEX = 366
/** Ordem total da paginação (todas decrescentes): sem o `id` no fim, OFFSET pode repetir ou pular linhas entre páginas. */
export const ORDEM_KARDEX = ['data_mov', 'id_mov', 'id'] as const

const ISO = /^\d{4}-\d{2}-\d{2}$/
function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const inteiro = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null)

export function lerFiltrosKardex(sp: Record<string, string | undefined>, hoje: string): FiltrosKardexLoja {
  let fim = sp.data_final && ISO.test(sp.data_final) ? sp.data_final : hoje
  let ini = sp.data_inicio && ISO.test(sp.data_inicio) ? sp.data_inicio : addDias(fim, -6)
  if (ini > fim) [ini, fim] = [fim, ini]
  let erro: string | null = null
  if (diasEntre(ini, fim) > MAX_DIAS_KARDEX - 1) {
    ini = addDias(fim, -(MAX_DIAS_KARDEX - 1))
    erro = `Período limitado a ${MAX_DIAS_KARDEX} dias: mostrando a partir de ${ini.split('-').reverse().join('/')}.`
  }
  const page = inteiro(sp.page)
  return {
    ini, fim, produto: inteiro(sp.produto), q: (sp.q ?? '').trim(), local: inteiro(sp.local), origem: (sp.origem ?? '').trim(),
    autor: (sp.autor ?? '').trim(), page: page && page > 0 ? page : 1, erro,
  }
}

export function paginaKardex(page: number, porPagina: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * porPagina
  return { from, to: from + porPagina - 1 }
}

function celula(v: string | number | null): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV para o Excel em português: BOM (acentos), separador ';', CRLF, número com vírgula decimal. */
export function paraCsv(cabecalho: string[], linhas: (string | number | null)[][]): string {
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n')
}

export function rotuloOrigemKardex(cod: string | null, des: string | null): string {
  return (des && des.trim()) || (cod && cod.trim()) || '-'
}
