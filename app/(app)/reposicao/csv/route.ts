import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { linhaCsv, numeroCsv } from '@/lib/estoque/inventario-regras'
import { carregarReposicao, filtrarReposicao } from '../dados'

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio' || !(await requirePermissao(lojaId, 'Movimentacoes'))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }
  const u = new URL(request.url)
  const { linhas } = await carregarReposicao(lojaId)
  const itens = filtrarReposicao(linhas, { q: u.searchParams.get('q') ?? undefined, familia: u.searchParams.get('familia') ?? undefined, local: u.searchParams.get('local') ?? undefined })
  const corpo = [
    linhaCsv(['Família', 'Código', 'Produto', 'Local', 'Unidade', 'Saldo', 'Mínimo', 'Comprar', 'Último custo', 'Estimativa (R$)']),
    ...itens.map((l) => linhaCsv([l.familia, l.codigo, l.descricao, l.local, l.unidade, numeroCsv(l.saldo), numeroCsv(l.minimo), numeroCsv(l.falta), numeroCsv(l.ultimoCusto ?? l.cmc, 4), numeroCsv(l.valorEstimado, 2)])),
  ].join('\r\n')
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  // BOM para o Excel abrir acentos corretamente.
  return new NextResponse('﻿' + corpo, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="reposicao-${hoje}.csv"`, 'Cache-Control': 'no-store' },
  })
}
