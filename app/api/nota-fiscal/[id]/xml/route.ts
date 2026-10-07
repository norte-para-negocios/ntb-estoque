import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { obterLinksDfe } from '@/lib/omie/dfe-docs'
import type { LojaOmie } from '@/lib/omie/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { id } = await params

  const supabase = await createClient()
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('n_id_receb, loja_id, origem, c_chave_nfe')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!nf) return NextResponse.json({ error: 'NF nao encontrada' }, { status: 404 })
  const serviceSupabase = createServiceClient()
  // Nota que veio da SEFAZ (ou de XML importado): o XML completo ja esta guardado aqui, sem Omie.
  if (nf.origem === 'sefaz' && nf.c_chave_nfe) {
    const { data: doc } = await serviceSupabase.from('sefaz_documentos').select('xml').eq('loja_id', lojaId).eq('chave', nf.c_chave_nfe).eq('tipo', 'procNFe').order('id', { ascending: false }).limit(1).maybeSingle()
    if (!doc?.xml) return NextResponse.json({ error: 'XML completo ainda nao disponivel para esta NF' }, { status: 404 })
    return new NextResponse(doc.xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="NFe-${nf.c_chave_nfe}.xml"` } })
  }
  if (!nf.n_id_receb) return NextResponse.json({ error: 'NF sem ID interno Omie' }, { status: 404 })

  const { data: loja } = await serviceSupabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()

  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integracao Omie' }, { status: 400 })
  }

  try {
    const links = await obterLinksDfe(loja, Number(nf.n_id_receb))
    if (!links.linkXML) {
      return NextResponse.json({ error: 'XML nao disponivel para esta NF' }, { status: 404 })
    }
    return NextResponse.redirect(links.linkXML, { status: 302 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao obter XML'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
