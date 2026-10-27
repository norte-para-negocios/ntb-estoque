import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { carregarCubo } from '@/lib/relatorios/carregar-cubo'
import { CUBOS, type IdCubo } from '@/lib/relatorios/catalogo'
import { pivotar, VAZIO, type Layout } from '@/lib/relatorios/pivot'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerPeriodo } from '@/lib/faturamento-periodo'

const MAX_OPCOES = 500

type Corpo = { ini?: string; fim?: string; layout?: Layout; opcoesDe?: string[] }

/** Agrega o cubo no servidor e devolve só a árvore pronta (e os valores possíveis dos campos pedidos para os filtros). */
export async function POST(req: Request, { params }: { params: Promise<{ cubo: string }> }) {
  await exigirDev()
  const { cubo } = await params
  if (!(cubo in CUBOS)) return NextResponse.json({ erro: 'Relatório desconhecido.' }, { status: 404 })
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) return NextResponse.json({ erro: 'Sem permissão.' }, { status: 403 })

  const corpo = (await req.json().catch(() => null)) as Corpo | null
  const layout = corpo?.layout
  if (!layout || !Array.isArray(layout.linhas) || !Array.isArray(layout.colunas) || !Array.isArray(layout.medidas)) {
    return NextResponse.json({ erro: 'Layout inválido.' }, { status: 400 })
  }
  const def = CUBOS[cubo as IdCubo]
  const ids = new Set(def.campos.map((c) => c.id))
  const usados = [...layout.linhas, ...layout.colunas, ...layout.medidas.map((m) => m.campo), ...Object.keys(layout.filtros ?? {}), ...Object.keys(layout.exceto ?? {}), ...(corpo?.opcoesDe ?? [])]
  const desconhecido = usados.find((c) => !ids.has(c))
  if (desconhecido) return NextResponse.json({ erro: `Campo desconhecido: ${desconhecido}` }, { status: 400 })

  const hoje = hojeBahiaISO()
  const p = lerPeriodo({ ini: corpo?.ini, fim: corpo?.fim }, hoje, 3660)
  const dados = await carregarCubo(cubo as IdCubo, lojaId, p.ini, p.fim)

  const r = pivotar(dados.linhas, { ...layout, filtros: layout.filtros ?? {} })
  const opcoes: Record<string, string[]> = {}
  for (const campo of corpo?.opcoesDe ?? []) {
    const vistos = new Set<string>()
    for (const l of dados.linhas) vistos.add(l[campo] == null || l[campo] === '' ? VAZIO : String(l[campo]))
    opcoes[campo] = [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).slice(0, MAX_OPCOES)
  }
  return NextResponse.json({ periodo: { ini: p.ini, fim: p.fim, cortado: p.cortado }, totalLinhas: dados.linhas.length, truncado: dados.truncado, falhou: dados.falhou, raiz: r.raizLinhas, colunas: r.colunas, total: r.total, opcoes })
}
