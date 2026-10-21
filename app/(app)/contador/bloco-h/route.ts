import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { planilhaResponse } from '@/lib/excel'
import { lerParamsPacote } from '@/lib/contador/params-puro'
import { carregarBlocoH } from '@/lib/contador/bloco-h-loader'
import { nomeDaLoja, planilhaBlocoH } from '@/lib/contador/pacote'
import { exigirDev } from '@/lib/recursos-dev'

export const dynamic = 'force-dynamic'

// Fase F: inventário tipo Bloco H numa data (?data=YYYY-MM-DD; padrão = último dia do mês passado).
export async function GET(request: Request) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Contador - Pacote'))) return new Response('Sem permissão', { status: 403 })
  const sp = new URL(request.url).searchParams
  const p = lerParamsPacote({ mes: sp.get('mes'), data: sp.get('data') }, hojeBahiaISO())
  if ('error' in p) return new Response(p.error, { status: 400 })
  const [bloco, loja] = await Promise.all([carregarBlocoH(lojaId, p.data), nomeDaLoja(lojaId)])
  if (!bloco.linhas.length && !bloco.dataFoto) return new Response(`Sem posição de estoque até ${p.data.split('-').reverse().join('/')}`, { status: 404 })
  return planilhaResponse(`inventario-bloco-h-${p.data}`, await planilhaBlocoH(bloco, loja))
}
