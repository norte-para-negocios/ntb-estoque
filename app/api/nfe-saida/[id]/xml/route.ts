import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'

// XML da NF-e de saída (Fase F): ?tipo=nfe (padrão, procNFe autorizado), cancelamento ou cce (procEventoNFe).
// Lido pela sessão (RLS por loja). Quem emite, devolve ou transfere pode baixar.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  const pode = (await requirePermissao(lojaId, 'Compras - Emitir NF-e')) || (await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor'))
    || (await requirePermissao(lojaId, 'Transferencias - Entre lojas'))
  if (!pode) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  const { id } = await params
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'NF-e inválida' }, { status: 400 })
  const tipo = new URL(req.url).searchParams.get('tipo') ?? 'nfe'
  const { data: n } = await (await createClient()).from('nfe_saida').select('chave, tp_amb, xml_autorizado, cancel_xml, cce_xml, cce_seq')
    .eq('id', Number(id)).eq('loja_id', lojaId).maybeSingle()
  if (!n) return NextResponse.json({ error: 'NF-e não encontrada' }, { status: 404 })
  const xml = tipo === 'cancelamento' ? n.cancel_xml : tipo === 'cce' ? n.cce_xml : n.xml_autorizado
  if (!xml) return NextResponse.json({ error: 'XML ainda não disponível (a NF-e precisa estar autorizada)' }, { status: 404 })
  const sufixo = tipo === 'cancelamento' ? '-cancelamento' : tipo === 'cce' ? `-cce${n.cce_seq}` : ''
  const nome = `${n.tp_amb === 2 ? 'HOMOLOGACAO-' : ''}NFe${n.chave}${sufixo}.xml`
  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` } })
}
