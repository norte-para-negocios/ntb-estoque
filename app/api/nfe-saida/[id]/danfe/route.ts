import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { DanfePDF } from '@/components/nfe-saida/DanfePDF'
import { dadosDanfe } from '@/lib/nfe-saida/danfe-puro'

// DANFE (PDF) da NF-e de saída autorizada, montado do procNFe guardado (Fase F). Homologação/cancelada com tarja.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  const pode = (await requirePermissao(lojaId, 'Compras - Emitir NF-e')) || (await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor'))
    || (await requirePermissao(lojaId, 'Transferencias - Entre lojas'))
  if (!pode) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'NF-e inválida' }, { status: 400 })
  const { data: n } = await (await createClient()).from('nfe_saida').select('chave, status, xml_autorizado').eq('id', Number(id)).eq('loja_id', lojaId).maybeSingle()
  if (!n?.xml_autorizado) return NextResponse.json({ error: 'DANFE disponível só para NF-e autorizada' }, { status: 404 })
  const buf = await renderToBuffer(createElement(DanfePDF, { d: dadosDanfe(n.xml_autorizado), cancelada: n.status === 'cancelada' }) as Parameters<typeof renderToBuffer>[0])
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="DANFE-${n.chave}.pdf"` } })
}
