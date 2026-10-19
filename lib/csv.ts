/**
 * Geração de CSV para exportação compatível com Excel pt-BR.
 * Usa separador ';' e prefixa BOM para que o Excel reconheça UTF-8.
 */

import { celulaCsv } from '@/lib/seguranca/regras'

const BOM = '﻿'

// Escapa aspas, ';' e quebra de linha e neutraliza fórmula (=, +, -, @) -- Fase H.
function escapaCampo(valor: unknown): string {
  return celulaCsv(valor)
}

/**
 * Gera o conteúdo CSV. Primeira linha são os labels das colunas; cada linha
 * seguinte mapeia os valores na ordem das colunas. Separador ';' (Excel pt-BR).
 */
export function toCsv(
  rows: Record<string, unknown>[],
  colunas: { key: string; label: string }[],
): string {
  const cabecalho = colunas.map((c) => escapaCampo(c.label)).join(';')
  const linhas = rows.map((row) =>
    colunas.map((c) => escapaCampo(row[c.key])).join(';'),
  )
  return BOM + [cabecalho, ...linhas].join('\r\n')
}

/**
 * Monta uma Response de download para o CSV gerado.
 */
export function csvResponse(nome: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}"`,
    },
  })
}
