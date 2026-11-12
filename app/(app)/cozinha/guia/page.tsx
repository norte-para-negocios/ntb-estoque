import { BookOpen, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ListaGuia } from '@/components/custo-cardapio/guia/ListaGuia'
import { CartaoReceita } from '@/components/custo-cardapio/guia/CartaoReceita'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarGuia } from '@/lib/custo-cardapio/guia'

type Sp = { p?: string; ctx?: string; b?: string; passados?: string }

// Norte Cozinha (só dev), Guia de preparo: a ficha operacional da cozinha, sem nenhum valor em R$.
// ?p=<produto> receita aberta · ?ctx=e<id>|c<id> evento ou cardápio (escala) · ?b=<quantidade> base manual · ?passados=1
export default async function GuiaPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await exigirDev()
  const sp = await searchParams
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Guia de preparo" icon={BookOpen} />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O guia sai das fichas técnicas, que esta loja não tem." />
      </div>
    )
  }
  const produto = Number(sp.p)
  const b = Number(String(sp.b ?? '').replace(',', '.'))
  const dados = await carregarGuia(base, {
    ctx: sp.ctx ?? null,
    produto: Number.isSafeInteger(produto) && produto > 0 ? produto : null,
    base: sp.b && Number.isFinite(b) && b > 0 && b <= 100000 ? b : null,
    passados: sp.passados === '1',
  })
  const params = { ctx: dados.ativo?.chave ?? null, passados: sp.passados === '1' }

  return (
    <div className="space-y-4">
      <PageHeader title="Guia de preparo" icon={BookOpen}
        description={dados.ativo ? `${dados.ativo.tipo === 'evento' ? 'Evento' : 'Cardápio'} ${dados.ativo.nome}: quantidades para ${dados.ativo.detalhe}.` : 'Ingredientes, passos e observações de cada prato e preparação, do jeito que a cozinha usa.'} />
      {dados.contextoInvalido && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">Esse evento ou cardápio não foi encontrado nesta loja. Mostrando todas as receitas.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start">
        <ListaGuia itens={dados.itens} contextos={dados.contextos} ativo={dados.ativo} selecionado={dados.receita?.codigo ?? null} passados={params.passados} />
        {dados.receita
          ? <CartaoReceita key={`${dados.receita.codigo}-${dados.receita.quantidade}`} receita={dados.receita} ctx={params.ctx} passados={params.passados} contexto={dados.ativo?.nome ?? null} />
          : (
            <div className="rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
              <EmptyState icon={BookOpen} title={dados.itens.length ? 'Escolha uma receita' : 'Nenhuma receita aqui'}
                hint={dados.itens.length ? 'Toque num prato ou preparação da lista para ver a ficha da cozinha.' : dados.ativo ? 'Este evento ou cardápio ainda não tem pratos com ficha técnica.' : 'Monte a ficha técnica no cadastro do produto e ela aparece aqui.'} />
            </div>
          )}
      </div>
    </div>
  )
}
