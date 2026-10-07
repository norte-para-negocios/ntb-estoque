import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { gerarPlanilha, planilhaResponse } from '@/lib/excel'
import { buscarKardex, periodoKardex, ROTULO_ORIGEM, ROTULO_TIPO, type ParamsKardex } from '@/lib/estoque/kardex'

const MAX_LINHAS = 20000

function campoCsv(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Exporta exatamente o que está filtrado na tela de Movimentações (loja de estoque próprio).
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'proprio') return NextResponse.json({ error: 'Exportação disponível só para estoque próprio' }, { status: 400 })

  const url = new URL(request.url)
  const sp: ParamsKardex = {}
  for (const k of ['produto', 'data_inicio', 'data_final', 'tm', 'og', 'local', 'familia', 'us', 'neg', 'est', 'ord', 'dir'] as const) {
    const v = url.searchParams.get(k)
    if (v) sp[k] = v
  }
  const formato = url.searchParams.get('formato') === 'csv' ? 'csv' : 'xlsx'
  const r = await buscarKardex(lojaId, sp, { limite: MAX_LINHAS, offset: 0 })
  const { ini, fim } = periodoKardex(sp)
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })

  const linhas = r.linhas.map((m) => ({
    data: quando(m.quando),
    tipo: ROTULO_TIPO[m.tipo] ?? m.tipo,
    origem: ROTULO_ORIGEM[m.origem] ?? m.origem,
    ref: m.ref,
    codigo: m.codigo ?? '',
    produto: m.descricao ?? '',
    unidade: m.unidade ?? '',
    local: m.local_nome ?? String(m.codigo_local),
    quantidade: m.quantidade,
    custo: m.custo ?? 0,
    valor: m.custo == null ? 0 : Math.abs(m.quantidade) * m.custo,
    saldo: m.saldo_apos,
    usuario: m.user_nome ?? m.user_id ?? '',
    obs: m.obs ?? '',
    estorno: m.estornado_por != null ? `estornado por #${m.estornado_por}` : m.reverses_id != null ? `estorno de #${m.reverses_id}` : '',
  }))

  if (formato === 'csv') {
    const cab = ['Data', 'Tipo', 'Origem', 'Referência', 'Código', 'Produto', 'Unidade', 'Local', 'Quantidade', 'Custo', 'Valor', 'Saldo após', 'Usuário', 'Observação', 'Estorno']
    const corpo = linhas.map((l) => [l.data, l.tipo, l.origem, l.ref, l.codigo, l.produto, l.unidade, l.local, String(l.quantidade).replace('.', ','), String(l.custo).replace('.', ','), String(l.valor).replace('.', ','), String(l.saldo).replace('.', ','), l.usuario, l.obs, l.estorno].map(campoCsv).join(';'))
    const csv = '﻿' + [cab.join(';'), ...corpo].join('\r\n')
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="movimentacoes.csv"' } })
  }

  const buffer = await gerarPlanilha(
    linhas,
    [
      { key: 'data', label: 'Data', tipo: 'texto', largura: 18 },
      { key: 'tipo', label: 'Tipo', tipo: 'texto', largura: 14 },
      { key: 'origem', label: 'Origem', tipo: 'texto', largura: 16 },
      { key: 'ref', label: 'Referência', tipo: 'texto', largura: 28 },
      { key: 'codigo', label: 'Código', tipo: 'texto', largura: 10 },
      { key: 'produto', label: 'Produto', tipo: 'texto', largura: 36 },
      { key: 'unidade', label: 'Un.', tipo: 'texto', largura: 6 },
      { key: 'local', label: 'Local', tipo: 'texto', largura: 18 },
      { key: 'quantidade', label: 'Quantidade', tipo: 'numero', largura: 14 },
      { key: 'custo', label: 'Custo unit.', tipo: 'moeda', largura: 14 },
      { key: 'valor', label: 'Valor', tipo: 'moeda', largura: 14 },
      { key: 'saldo', label: 'Saldo após', tipo: 'numero', largura: 14 },
      { key: 'usuario', label: 'Usuário', tipo: 'texto', largura: 22 },
      { key: 'obs', label: 'Observação', tipo: 'texto', largura: 30 },
      { key: 'estorno', label: 'Estorno', tipo: 'texto', largura: 18 },
    ],
    { titulo: 'Movimentações', subtitulo: `${ini} a ${fim} · ${r.total} movimentos${r.total > MAX_LINHAS ? ` (primeiros ${MAX_LINHAS})` : ''}`, autoFiltro: true },
  )
  return planilhaResponse('movimentacoes.xlsx', buffer)
}
