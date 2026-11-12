import { notFound } from 'next/navigation'
import { BookOpen, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { AcoesCardapio } from '@/components/custo-cardapio/cardapios/AcoesCardapio'
import { EditorCardapio } from '@/components/custo-cardapio/cardapios/EditorCardapio'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarCardapio, pratosDisponiveis } from '@/lib/custo-cardapio/cardapios'
import { NOME_CANAL } from '@/lib/custo-cardapio/cardapios-puro'

export default async function CardapioPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cardápio" icon={BookOpen} voltarHref="/cozinha/cardapios" />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" />
      </div>
    )
  }
  const c = await carregarCardapio(base, id)
  if (!c) notFound()
  const opcoes = pratosDisponiveis(base).map((l) => ({
    codigo: l.codigo, codigoTexto: l.codigoTexto, descricao: l.descricao, familia: l.familia, tipo: l.tipo, custo: l.custo, preco: l.preco,
  }))
  return (
    <div className="space-y-4">
      <PageHeader title={c.nome} icon={BookOpen} voltarHref="/cozinha/cardapios"
        description={`${NOME_CANAL[c.canal]}${c.ativo ? '' : ' · arquivado'} · ${c.itens.length} prato${c.itens.length === 1 ? '' : 's'}`}
        actions={<AcoesCardapio cardapio={{ id: c.id, nome: c.nome, canal: c.canal, ativo: c.ativo }} />} />
      {!c.ativo && <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-[13px] text-text-muted">Este cardápio está arquivado. Dá para editar normalmente; ele só não aparece na lista dos ativos.</p>}
      <EditorCardapio cardapioId={c.id} canal={c.canal} taxas={base.taxas} opcoes={opcoes}
        itens={c.itens.map((i) => ({
          itemId: i.itemId, codigo: i.codigo, codigoTexto: i.codigoTexto, descricao: i.descricao, familia: i.familia, custo: i.custo,
          semCusto: i.semCusto, suspeitos: i.suspeitos, semFicha: i.semFicha, precoCadastro: i.precoCadastro, precoProprio: i.precoProprio, porcoes: i.porcoes,
        }))} />
    </div>
  )
}
