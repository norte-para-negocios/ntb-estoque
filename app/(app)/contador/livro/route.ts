import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { planilhaResponse } from '@/lib/excel'
import { lerParamsPacote } from '@/lib/contador/params-puro'
import { carregarLivroEntradas } from '@/lib/contador/livro-entradas-loader'
import { nomeDaLoja, pdfLivro, planilhaLivro } from '@/lib/contador/pacote'
import { exigirDev } from '@/lib/recursos-dev'

export const dynamic = 'force-dynamic'

// Fase F: livro de entradas do mês, em Excel (padrão) ou PDF (?formato=pdf).
export async function GET(request: Request) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Contador - Pacote'))) return new Response('Sem permissão', { status: 403 })
  const sp = new URL(request.url).searchParams
  const p = lerParamsPacote({ mes: sp.get('mes') }, hojeBahiaISO())
  if ('error' in p) return new Response(p.error, { status: 400 })
  const [livro, loja] = await Promise.all([carregarLivroEntradas(lojaId, p.mes), nomeDaLoja(lojaId)])
  if (sp.get('formato') === 'pdf') {
    const buf = await pdfLivro(livro, loja, p.mes)
    return new Response(new Uint8Array(buf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="livro-de-entradas-${p.mes}.pdf"` } })
  }
  return planilhaResponse(`livro-de-entradas-${p.mes}`, await planilhaLivro(livro, loja, p.mes))
}
