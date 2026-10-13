import { NextResponse } from 'next/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { lerFiltrosKardex, paraCsv, rotuloOrigemKardex } from '@/lib/estoque/kardex-loja-puro'
import { buscarKardexLoja, type LinhaKardexLoja } from '../../dados-kardex'
import { fmtDataBR } from '../../dados-comum'

const PAGINA = 1000
const MAX_LINHAS = 20_000

/** CSV do kardex da loja com os mesmos filtros da tela (até 20.000 linhas). Só leitura. */
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'omie') return NextResponse.json({ error: 'Kardex do Omie só existe em loja Omie' }, { status: 400 })

  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const f = lerFiltrosKardex(sp, hojeBahiaISO())
  const linhas: LinhaKardexLoja[] = []
  let cortado = false
  for (let from = 0; ; from += PAGINA) {
    const r = await buscarKardexLoja(lojaId, f, { from, to: from + PAGINA - 1 }, false)
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 502 })
    linhas.push(...r.linhas)
    if (r.linhas.length < PAGINA) break
    if (linhas.length >= MAX_LINHAS) { cortado = true; break }
  }
  const corpo = linhas.slice(0, MAX_LINHAS).map((m) => [
    fmtDataBR(m.data_mov), m.codigo, m.produto, m.local, rotuloOrigemKardex(m.cod_origem, m.des_origem), m.cod_origem,
    m.quantidade, m.unidade, m.valor_unit, m.cmc_apos, m.saldo_apos, m.num_pedido ?? m.num_doc, m.autor, m.cancelado ? 'sim' : '', m.id_mov,
  ])
  if (cortado) corpo.push([`Arquivo cortado em ${MAX_LINHAS.toLocaleString('pt-BR')} linhas: diminua o período.`])
  const csv = paraCsv(
    ['Data', 'Código', 'Produto', 'Local', 'Origem', 'Código da origem', 'Quantidade', 'Unidade', 'Custo unit.', 'Custo médio após', 'Saldo após', 'Documento', 'Quem lançou', 'Cancelado', 'Id do movimento'],
    corpo,
  )
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kardex-loja-${lojaId}-${f.ini}-a-${f.fim}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
