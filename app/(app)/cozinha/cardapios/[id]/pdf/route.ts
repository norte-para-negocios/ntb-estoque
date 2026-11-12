import { NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { createClient } from '@/lib/supabase/server'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarCardapio } from '@/lib/custo-cardapio/cardapios'
import { NOME_CANAL } from '@/lib/custo-cardapio/cardapios-puro'
import { CardapioPDF } from '@/components/custo-cardapio/cardapios/CardapioPDF'

// Cardápio em PDF (só dev). ?interno=1 = com custo, CMV e preço sugerido.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) return new NextResponse('Sem permissão', { status: 403 })
  const id = Number((await params).id)
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  const c = base && Number.isSafeInteger(id) && id > 0 ? await carregarCardapio(base, id) : null
  if (!base || !c) return new NextResponse('Cardápio não encontrado', { status: 404 })
  const interno = new URL(request.url).searchParams.get('interno') === '1'
  const { data: loja } = await (await createClient()).from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const el = createElement(CardapioPDF, {
    loja: loja?.nome_fantasia || loja?.nome || '', nome: c.nome, canal: NOME_CANAL[c.canal], interno, meta: base.taxas.metaCmv,
    resumo: { cmvCardapio: c.resumo.cmvCardapio, acima: c.resumo.acima, semPreco: c.resumo.semPreco },
    linhas: c.itens.filter((i) => interno || !i.semFicha).map((i) => ({
      descricao: i.descricao, familia: i.familia, preco: i.conta.preco, custo: i.custo, porcoes: i.porcoes, participacao: i.participacao, cmv: i.conta.cmv, sugerido: i.conta.sugerido, acima: i.conta.situacao === 'acima',
    })),
  }) as Parameters<typeof renderToBuffer>[0]
  const buf = await renderToBuffer(el)
  const nomeArq = c.nome.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="cardapio-${nomeArq}${interno ? '-interno' : ''}.pdf"` },
  })
}
