import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { obterLinksDfe } from '@/lib/omie/dfe-docs'
import type { LojaOmie } from '@/lib/omie/client'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { DanfePDF } from '@/components/nfe-saida/DanfePDF'
import { dadosDanfe } from '@/lib/nfe-saida/danfe-puro'

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
  // Nota que veio da SEFAZ (loja de estoque próprio): o DANFE é montado do XML autorizado guardado, sem Omie
  // (pedido do Ramon 27/10/2026: ver o DANFE sem baixar o XML e abrir no site da SEFAZ).
  if (nf.origem === 'sefaz' && nf.c_chave_nfe) {
    const { data: doc } = await createServiceClient().from('sefaz_documentos').select('xml').eq('loja_id', lojaId).eq('chave', nf.c_chave_nfe).eq('tipo', 'procNFe').order('id', { ascending: false }).limit(1).maybeSingle()
    if (!doc?.xml) return NextResponse.json({ error: 'A SEFAZ ainda não entregou o XML completo desta nota: o DANFE aparece quando ele chegar.' }, { status: 404 })
    try {
      const buf = await renderToBuffer(createElement(DanfePDF, { d: dadosDanfe(doc.xml) }) as Parameters<typeof renderToBuffer>[0])
      return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="DANFE-${nf.c_chave_nfe}.pdf"` } })
    } catch (e) {
      console.error(`danfe nota ${id}:`, e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Não foi possível montar o DANFE desta nota.' }, { status: 500 })
    }
  }
  if (!nf.n_id_receb) return NextResponse.json({ error: 'NF sem ID interno Omie' }, { status: 404 })

  const serviceSupabase = createServiceClient()
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
    if (!links.linkPDF) {
      return NextResponse.json({ error: 'DANFE nao disponivel para esta NF' }, { status: 404 })
    }
    return NextResponse.redirect(links.linkPDF, { status: 302 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao obter DANFE'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
