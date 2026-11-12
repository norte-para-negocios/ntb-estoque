import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { carregarAcessos } from '@/lib/plataforma/assinaturas'
import { createClient } from '@/lib/supabase/server'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarEvento, listasDoEvento } from '@/lib/custo-cardapio/eventos'
import { formatarData, NOME_STATUS } from '@/lib/custo-cardapio/eventos-puro'
import { EventoPDF } from '@/components/custo-cardapio/eventos/EventoPDF'

// Evento em PDF (módulo Norte Cozinha): resumo, lista de produção e de compras.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if ((await carregarAcessos()).acessos.cozinha === 'vitrine') return new NextResponse('Não encontrado', { status: 404 })
  if (!(await getAtorGestao()).podeGerir) return new NextResponse('Sem permissão', { status: 403 })
  const id = Number((await params).id)
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  const e = base && Number.isSafeInteger(id) && id > 0 ? await carregarEvento(base, id) : null
  if (!base || !e) return new NextResponse('Evento não encontrado', { status: 404 })
  const listas = await listasDoEvento(base, e)
  const { data: loja } = await (await createClient()).from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const el = createElement(EventoPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '', nome: e.nome, obs: e.obs,
    sub: `${formatarData(e.data_evento)} · ${e.convidados} convidado${e.convidados === 1 ? '' : 's'} · ${NOME_STATUS[e.status]}`,
    resumo: e.resumo, meta: base.taxas.metaCmv, preco: e.preco_por_pessoa, pratos: listas.pratos, producao: listas.producao, compras: listas.compras,
  }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  const nomeArq = e.nome.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="evento-${nomeArq}.pdf"` },
  })
}
