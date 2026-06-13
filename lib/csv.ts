/**
 * Geração de CSV para exportação compatível com Excel pt-BR.
 * Usa separador ';' e prefixa BOM para que o Excel reconheça UTF-8.
 */

const BOM = '﻿'

function escapaCampo(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  // Escapa se contiver aspas, separador ';' ou quebra de linha.
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
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
