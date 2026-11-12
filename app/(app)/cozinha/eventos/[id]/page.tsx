import { notFound } from 'next/navigation'
import { CalendarDays, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { EditorEvento } from '@/components/custo-cardapio/eventos/EditorEvento'
import { ListasEvento } from '@/components/custo-cardapio/eventos/ListasEvento'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarEvento, listasDoEvento, opcoesDoEvento } from '@/lib/custo-cardapio/eventos'
import { formatarData, NOME_STATUS, textoWhatsApp } from '@/lib/custo-cardapio/eventos-puro'

export default async function EventoPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Evento" icon={CalendarDays} voltarHref="/cozinha/eventos" />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" />
      </div>
    )
  }
  const e = await carregarEvento(base, id)
  if (!e) notFound()
  const listas = await listasDoEvento(base, e)
  const texto = textoWhatsApp({ nome: e.nome, data: e.data_evento, convidados: e.convidados }, listas.pratos, listas.producao, listas.compras)
  const opcoes = opcoesDoEvento(base).map((l) => ({
    codigo: l.codigo, codigoTexto: l.codigoTexto, descricao: l.descricao, familia: l.familia, tipo: l.tipo, custo: l.custo, preco: l.preco,
    detalhe: l.tipo === 'preparacao' ? `por ${(base.produtos.get(l.codigo)?.unidade ?? 'un').toLowerCase()}` : undefined,
  }))
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PageHeader title={e.nome} icon={CalendarDays} voltarHref="/cozinha/eventos"
          description={`${formatarData(e.data_evento)} · ${e.convidados} convidado${e.convidados === 1 ? '' : 's'} · ${NOME_STATUS[e.status]}`} />
        <EditorEvento metaCmv={base.taxas.metaCmv} opcoes={opcoes}
          evento={{ id: e.id, nome: e.nome, dataEvento: e.data_evento, convidados: e.convidados, status: e.status, precoPorPessoa: e.preco_por_pessoa, obs: e.obs }}
          itens={e.itens.map((i) => ({
            itemId: i.itemId, codigo: i.codigo, descricao: i.descricao, tipo: i.tipo, unidade: i.unidade, porcoesPorConvidado: i.porcoesPorConvidado,
            custoPorPorcao: i.custoPorPorcao, semCusto: i.semCusto, semFicha: i.semFicha,
          }))} />
      </div>
      <ListasEvento eventoId={e.id} listas={listas} texto={texto} modo={base.modo} />
    </div>
  )
}
