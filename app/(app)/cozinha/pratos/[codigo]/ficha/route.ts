import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { createClient } from '@/lib/supabase/server'
import { arvoreDoPrato, carregarBase, ehPreparacao } from '@/lib/custo-cardapio/carregar'
import { FichaPDF } from '@/components/custo-cardapio/FichaPDF'
import { bytesDaFoto, carregarInfoReceita } from '@/lib/custo-cardapio/receita-info'
import { formatarTempo, passosDoTexto } from '@/lib/custo-cardapio/guia-puro'

// Ficha técnica em PDF (só dev). ?cozinha=1 = sem valores em R$.
export async function GET(request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) return new NextResponse('Sem permissão', { status: 403 })
  const codigo = Number((await params).codigo)
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  const arvore = base && Number.isFinite(codigo) ? arvoreDoPrato(base, codigo) : null
  if (!base || !arvore) return new NextResponse('Produto sem ficha técnica', { status: 404 })
  const cozinha = new URL(request.url).searchParams.get('cozinha') === '1'
  const p = base.produtos.get(codigo)
  const { data: loja } = await (await createClient()).from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const prep = ehPreparacao(p)
  const info = await carregarInfoReceita(lojaId, codigo)
  const foto = await bytesDaFoto(info?.fotoPath ?? null)
  const el = createElement(FichaPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '',
    nome: p?.descricao ?? `Produto ${codigo}`,
    sub: `${p?.codigoTexto ?? codigo}${p?.familia ? ` · ${p.familia}` : ''} · quantidades para 1 ${(p?.unidade ?? 'unidade').toLowerCase()}`,
    itens: arvore.filhos, cozinha, custo: arvore.total, preco: prep ? null : p?.preco ?? null, meta: base.taxas.metaCmv,
    foto, passos: passosDoTexto(info?.modoPreparo), observacoes: info?.observacoes ?? null,
    tempo: formatarTempo(info?.tempoPreparoMin), rendimento: info?.rendimentoTexto ?? null,
  }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  const nomeArq = (p?.descricao ?? String(codigo)).normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="ficha-${nomeArq}${cozinha ? '-cozinha' : ''}.pdf"` },
  })
}
