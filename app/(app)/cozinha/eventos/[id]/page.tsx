import { notFound } from 'next/navigation'
import { CalendarDays, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { EditorEvento } from '@/components/custo-cardapio/eventos/EditorEvento'
import { ListasEvento } from '@/components/custo-cardapio/eventos/ListasEvento'
import { ProximoPasso } from '@/components/custo-cardapio/eventos/ProximoPasso'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { carregarEvento, linhasDeConsumo, listasDoEvento, locaisDeBaixa, opcoesDoEvento } from '@/lib/custo-cardapio/eventos'
import { diasAte, formatarData, NOME_STATUS, proximoPasso, textoConsumo, textoWhatsApp } from '@/lib/custo-cardapio/eventos-puro'
import { hojeBahiaISO } from '@/lib/data-bahia'

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
  const finalizado = !!e.finalizado_em
  const precisaLocal = finalizado && !e.baixa_ref && base.modo === 'proprio'
  const { locais, padrao } = precisaLocal ? await locaisDeBaixa(lojaId) : { locais: [], padrao: null }
  const hoje = hojeBahiaISO()
  const [ha, hm, hd] = hoje.split('-').map(Number)
  const passo = proximoPasso({
    status: e.status, finalizado, baixaFeita: !!e.baixa_ref, pratos: e.itens.filter((i) => !i.semFicha).length,
    temPreco: e.preco_por_pessoa != null && e.preco_por_pessoa > 0, dias: diasAte(e.data_evento, new Date(ha, hm - 1, hd)),
    faltam: listas.cobertura.faltam, conflitos: listas.cobertura.conflitos, modo: base.modo,
  })
  const consumo = linhasDeConsumo(base, e, listas.compras)
  const texto = textoWhatsApp({ nome: e.nome, data: e.data_evento, convidados: e.convidados }, listas.pratos, listas.producao, listas.compras)
  const opcoes = opcoesDoEvento(base).map((l) => ({
    codigo: l.codigo, codigoTexto: l.codigoTexto, descricao: l.descricao, familia: l.familia, tipo: l.tipo, custo: l.custo, preco: l.preco,
    detalhe: l.tipo === 'preparacao' ? `por ${(base.produtos.get(l.codigo)?.unidade ?? 'un').toLowerCase()}` : undefined,
  }))
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <PageHeader title={e.nome} icon={CalendarDays} voltarHref="/cozinha/eventos"
          description={`${formatarData(e.data_evento)} · ${e.convidados} convidado${e.convidados === 1 ? '' : 's'} · ${NOME_STATUS[e.status]}${e.folga_pct > 0 ? ` · folga de ${e.folga_pct.toLocaleString('pt-BR')}%` : ''}`} />
        <ProximoPasso eventoId={e.id} passo={passo} modo={base.modo} consumo={consumo} finalizadoEm={e.finalizado_em} finalizadoPor={e.finalizado_por}
          baixaRef={e.baixa_ref} locais={locais} localPadrao={padrao} textoConsumo={textoConsumo({ nome: e.nome, data: e.data_evento }, consumo)} />
        <EditorEvento metaCmv={base.taxas.metaCmv} opcoes={opcoes}
          evento={{ id: e.id, nome: e.nome, dataEvento: e.data_evento, convidados: e.convidados, status: e.status, precoPorPessoa: e.preco_por_pessoa, obs: e.obs, folgaPct: e.folga_pct, finalizado }}
          itens={e.itens.map((i) => ({
            itemId: i.itemId, codigo: i.codigo, descricao: i.descricao, tipo: i.tipo, unidade: i.unidade, porcoesPorConvidado: i.porcoesPorConvidado,
            custoPorPorcao: i.custoPorPorcao, semCusto: i.semCusto, semFicha: i.semFicha,
          }))} />
      </div>
      <ListasEvento eventoId={e.id} listas={listas} texto={texto} modo={base.modo} />
    </div>
  )
}
