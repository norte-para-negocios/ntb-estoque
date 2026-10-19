import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { registrarAuditoria } from '@/lib/auditoria'
import { lerParamsPacote } from '@/lib/contador/params-puro'
import { montarPacote } from '@/lib/contador/pacote'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Fase F: pacote do contador do mês (ZIP): XMLs das notas de entrada, livro de entradas (Excel e PDF) e Bloco H.
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Contador - Pacote'))) return new Response('Sem permissão', { status: 403 })
  const sp = new URL(request.url).searchParams
  const p = lerParamsPacote({ mes: sp.get('mes'), data: sp.get('data') }, hojeBahiaISO())
  if ('error' in p) return new Response(p.error, { status: 400 })
  const { zip, nome } = await montarPacote(lojaId, p.mes, p.data)
  await registrarAuditoria('criar', 'pacote do contador', p.mes, `Bloco H em ${p.data}`)
  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' },
  })
}
