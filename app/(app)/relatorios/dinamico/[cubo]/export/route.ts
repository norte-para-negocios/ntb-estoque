import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { carregarCubo } from '@/lib/relatorios/carregar-cubo'
import { CUBOS, type IdCubo } from '@/lib/relatorios/catalogo'
import { chaveMedida, pivotar, type Layout, type No } from '@/lib/relatorios/pivot'
import { gerarPlanilhaMulti, planilhaResponse, type ColunaExcel } from '@/lib/excel'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { createClient } from '@/lib/supabase/server'

const LIMITE_DETALHE = 20_000
const dataBR = (iso: string) => iso.split('-').reverse().join('/')

/** Excel do relatório como está na tela (tudo aberto, com totais) + aba "Detalhe" com as linhas do cubo. */
export async function POST(req: Request, { params }: { params: Promise<{ cubo: string }> }) {
  await exigirDev()
  const { cubo } = await params
  if (!(cubo in CUBOS)) return NextResponse.json({ erro: 'Relatório desconhecido.' }, { status: 404 })
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) return NextResponse.json({ erro: 'Sem permissão.' }, { status: 403 })

  const corpo = (await req.json().catch(() => null)) as { ini?: string; fim?: string; layout?: Layout } | null
  const layout = corpo?.layout
  if (!layout || !Array.isArray(layout.linhas) || !Array.isArray(layout.colunas) || !Array.isArray(layout.medidas)) return NextResponse.json({ erro: 'Layout inválido.' }, { status: 400 })
  const def = CUBOS[cubo as IdCubo]
  const tipoDe = new Map(def.campos.map((c) => [c.id, c.tipo]))
  const usados = [...layout.linhas, ...layout.colunas, ...layout.medidas.map((m) => m.campo), ...Object.keys(layout.filtros ?? {}), ...Object.keys(layout.exceto ?? {})]
  const desconhecido = usados.find((c) => !tipoDe.has(c))
  if (desconhecido) return NextResponse.json({ erro: `Campo desconhecido: ${desconhecido}` }, { status: 400 })

  const p = lerPeriodo({ ini: corpo?.ini, fim: corpo?.fim }, hojeBahiaISO(), 3660)
  const dados = await carregarCubo(cubo as IdCubo, lojaId, p.ini, p.fim)
  const r = pivotar(dados.linhas, { ...layout, filtros: layout.filtros ?? {} })

  // Aba "Relatório": uma coluna por nível de linha + uma por (coluna x valor) + totais.
  const cols: ColunaExcel[] = layout.linhas.map((c, i) => ({ key: `n${i}`, label: c, tipo: 'texto', largura: 28 }))
  if (!cols.length) cols.push({ key: 'n0', label: 'Total', tipo: 'texto', largura: 20 })
  const grupos = layout.colunas.length ? [...r.colunas, ''] : ['']
  for (const g of grupos) {
    for (const m of layout.medidas) {
      const moeda = tipoDe.get(m.campo) === 'moeda' && m.agg !== 'contagem' && m.agg !== 'contagem_distinta'
      cols.push({ key: `v|${g}|${chaveMedida(m)}`, label: `${g ? `${g} · ` : layout.colunas.length ? 'Total · ' : ''}${m.campo}${m.agg === 'soma' ? '' : ` (${m.agg})`}`, tipo: moeda ? 'moeda' : 'numero', largura: 16 })
    }
  }
  const linhas: Record<string, unknown>[] = []
  const preencher = (valores: Record<string, number>, linha: Record<string, unknown>) => {
    for (const g of grupos) for (const m of layout.medidas) linha[`v|${g}|${chaveMedida(m)}`] = g ? valores[`${g}|${chaveMedida(m)}`] : valores[chaveMedida(m)]
  }
  const visitar = (n: No, nivel: number) => {
    const linha: Record<string, unknown> = { [`n${nivel}`]: n.rotulo }
    preencher(n.valores, linha)
    linhas.push(linha)
    n.filhos.forEach((f) => visitar(f, nivel + 1))
  }
  r.raizLinhas.filhos.forEach((f) => visitar(f, 0))
  const total: Record<string, unknown> = { n0: 'Total' }
  preencher(r.raizLinhas.valores, total)
  linhas.push(total)

  // Aba "Detalhe": todas as linhas do cubo no período (sem agrupar), para quem quer fatiar à mão no Excel.
  const supabase = await createClient()
  const { data: loja } = await supabase.from('lojas').select('nome').eq('id', lojaId).maybeSingle()
  const colunasDetalhe: ColunaExcel[] = def.campos.map((c) => ({ key: c.id, label: c.id, tipo: c.tipo, largura: c.tipo === 'texto' ? 26 : 16 }))
  const detalhe = dados.linhas.slice(0, LIMITE_DETALHE)
  const avisos = [dados.falhou ? 'ATENÇÃO: parte dos dados não carregou' : '', dados.truncado ? 'período com mais de 50.000 linhas: só as primeiras entraram' : '', dados.linhas.length > LIMITE_DETALHE ? `aba Detalhe limitada às primeiras ${LIMITE_DETALHE} linhas` : ''].filter(Boolean)
  const subtitulo = [loja?.nome, `${dataBR(p.ini)} a ${dataBR(p.fim)}`, ...avisos].filter(Boolean).join(' · ')

  const buffer = await gerarPlanilhaMulti([
    { rows: linhas, colunas: cols, opts: { titulo: def.titulo, subtitulo }, nome: 'Relatório' },
    { rows: detalhe, colunas: colunasDetalhe, opts: { titulo: `${def.titulo} — detalhe`, subtitulo, autoFiltro: true }, nome: 'Detalhe' },
  ])
  return planilhaResponse(`${cubo}_${p.ini}_${p.fim}`, buffer)
}
