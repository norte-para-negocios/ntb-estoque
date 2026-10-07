// Exporta (CSV ; com BOM) a lista da tela Validade no estoque próprio, com os mesmos filtros da tela.
import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { carregarValidadeProprio, type ParamsValidade } from '../dados-proprio'

const csv = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false })

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Validade'))) return new NextResponse('Sem permissão', { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'proprio') return new NextResponse('Disponível só para loja com estoque próprio', { status: 400 })
  const url = new URL(request.url)
  const sp = Object.fromEntries(url.searchParams.entries()) as ParamsValidade
  const hoje = hojeBahiaISO()
  const d = await carregarValidadeProprio(lojaId, sp, hoje)
  const cab = ['Produto', 'Código', 'Grupo', 'Família', 'Local', 'Lote', 'Validade', 'Dias até vencer', 'Quantidade', 'Unidade', 'Custo médio', 'Valor']
  const linhas = d.linhas.map((l) => {
    const dias = l.validade ? Math.round((new Date(`${l.validade}T00:00:00Z`).getTime() - new Date(`${hoje}T00:00:00Z`).getTime()) / 86400000) : ''
    return [l.produto, l.codigo, l.grupo, l.familia, l.local, l.lote, l.validade ? l.validade.split('-').reverse().join('/') : '', dias,
      num(l.saldo), l.unidade, num(l.cmc), num(l.valor)].map(csv).join(';')
  })
  const corpo = '﻿' + [cab.join(';'), ...linhas].join('\n')
  return new NextResponse(corpo, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="validade-${hoje}.csv"` },
  })
}
