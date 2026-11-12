import Link from 'next/link'
import { CalendarDays, ChefHat } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { DataTable } from '@/components/ui-kit/DataTable'
import { CartaoResumo } from '@/components/faturamento/CartaoResumo'
import { FormEvento } from '@/components/custo-cardapio/eventos/FormEvento'
import { carregarBase } from '@/lib/custo-cardapio/carregar'
import { coberturaDosEventos, listarEventos } from '@/lib/custo-cardapio/eventos'
import { diasAte, formatarData, NOME_STATUS, STATUS_EVENTO, type StatusEvento } from '@/lib/custo-cardapio/eventos-puro'
import { brl, pct } from '@/lib/custo-cardapio/formato'

const COR_STATUS: Record<StatusEvento, string> = { orcamento: 'bg-text-muted/50', confirmado: 'bg-brand', realizado: 'bg-ok', cancelado: 'bg-err' }

// Norte Cozinha (módulo da loja), Eventos: orçamento por convidado, produção e compras.
export default async function EventosPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams
  const lojaId = await getCurrentLojaId()
  const base = await carregarBase(lojaId)
  if (!base) {
    return (
      <div className="space-y-4">
        <PageHeader title="Eventos" icon={CalendarDays} />
        <EmptyState icon={ChefHat} title="Esta loja não controla estoque" hint="O custo do evento sai das fichas técnicas e do custo dos insumos, que esta loja não tem." />
      </div>
    )
  }
  const { eventos, erro } = await listarEventos(base)
  const cobertura = await coberturaDosEventos(base, eventos)
  const meta = base.taxas.metaCmv
  const status = (STATUS_EVENTO as readonly string[]).includes(sp.status ?? '') ? (sp.status as StatusEvento) : null
  const lista = status ? eventos.filter((e) => e.status === status) : eventos.filter((e) => e.status !== 'cancelado')
  const proximos = eventos.filter((e) => (e.status === 'orcamento' || e.status === 'confirmado') && (diasAte(e.data_evento) ?? 0) >= 0)
  const confirmados = eventos.filter((e) => e.status === 'confirmado')
  const receitaConfirmada = confirmados.reduce((a, e) => a + (e.resumo.receita ?? 0), 0)
  const sobraConfirmada = confirmados.reduce((a, e) => a + (e.resumo.sobra ?? 0), 0)
  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chip = (ativo: boolean) => `${chipBase} ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`

  return (
    <div className="space-y-4">
      <PageHeader title="Eventos" icon={CalendarDays}
        description="Quanto custa cada convidado, quanto cobrar e o que produzir e comprar."
        actions={<FormEvento />} />

      {erro && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">Parte dos pratos não carregou: {erro}</p>}

      {eventos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <CartaoResumo titulo="Próximos eventos" valor={proximos.length} sub={`${proximos.reduce((a, e) => a + e.convidados, 0)} convidados`} />
          <CartaoResumo titulo="Receita confirmada" valor={brl(receitaConfirmada)} sub={`${confirmados.length} confirmado${confirmados.length === 1 ? '' : 's'}`} />
          <CartaoResumo titulo={sobraConfirmada < 0 ? 'Prejuízo previsto' : 'Lucro previsto'} valor={brl(sobraConfirmada)} sub="depois da comida, nos confirmados" />
        </div>
      )}

      {eventos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Link href="/cozinha/eventos" className={chip(!status)}>Em aberto e realizados</Link>
          {STATUS_EVENTO.map((s) => <Link key={s} href={`/cozinha/eventos?status=${s}`} className={chip(status === s)}>{NOME_STATUS[s]}</Link>)}
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState icon={CalendarDays} title={eventos.length ? 'Nenhum evento nesta situação' : 'Nenhum evento ainda'}
          hint={eventos.length ? undefined : 'Crie um evento, escolha os pratos e veja o custo por pessoa, a lista de produção e a de compras.'}>
          {!eventos.length && <FormEvento />}
        </EmptyState>
      ) : (
        <DataTable minLargura="max-2xl:min-w-[1080px]">
          <thead>
            <tr>
              <th className="w-[24%]">Evento</th>
              <th className="w-[11%]">Data</th>
              <th className="w-[8%] text-right">Convidados</th>
              <th className="w-[11%]">Situação</th>
              <th className="w-[14%]">Insumos</th>
              <th className="w-[10%] text-right">Custo/pessoa</th>
              <th className="w-[10%] text-right">Preço/pessoa</th>
              <th className="w-[12%] text-right">Lucro</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => {
              const dias = diasAte(e.data_evento)
              const acima = e.resumo.cmv != null && e.resumo.cmv > meta
              const cob = cobertura.get(e.id)
              const lucro = e.resumo.sobra
              return (
                <tr key={e.id}>
                  <td>
                    <Link href={`/cozinha/eventos/${e.id}`} className="block min-w-0 hover:text-brand">
                      <span className="block truncate font-medium text-text">{e.nome}</span>
                      <span className="block truncate text-[12px] text-text-muted">{e.itens.length} prato{e.itens.length === 1 ? '' : 's'}{e.obs ? ` · ${e.obs}` : ''}</span>
                    </Link>
                  </td>
                  <td>
                    <span className="num block">{formatarData(e.data_evento)}</span>
                    {dias != null && dias >= 0 && dias <= 30 && e.status !== 'realizado' && e.status !== 'cancelado' && (
                      <span className="block text-[12px] text-text-muted">{dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`}</span>
                    )}
                  </td>
                  <td className="num text-right">{e.convidados.toLocaleString('pt-BR')}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium">
                      <span className={`size-2 shrink-0 rounded-full ${COR_STATUS[e.status]}`} />{NOME_STATUS[e.status]}
                    </span>
                  </td>
                  <td className="text-[13px]">
                    {e.finalizado_em ? (
                      <span className="text-text-muted">{e.baixa_ref ? 'baixa feita' : 'falta dar baixa'}</span>
                    ) : !cob ? <span className="text-text-muted">—</span> : cob.conflitos > 0 ? (
                      <span className="font-semibold text-err">{cob.conflitos} disputado{cob.conflitos > 1 ? 's' : ''}</span>
                    ) : cob.faltam > 0 ? (
                      <span className="text-warn">comprar {cob.faltam} {cob.faltam === 1 ? 'item' : 'itens'}</span>
                    ) : cob.conferir > 0 ? (
                      <span className="text-text-muted">{cob.conferir} a conferir</span>
                    ) : <span className="text-ok">cobertos</span>}
                  </td>
                  <td className="num text-right">{e.itens.length ? brl(e.resumo.custoPorPessoa) : '—'}</td>
                  <td className="num text-right">
                    {e.preco_por_pessoa != null ? brl(e.preco_por_pessoa) : e.resumo.precoSugeridoPorPessoa > 0
                      ? <span className="text-text-muted" title="Preço sugerido para a meta">sugerido {brl(e.resumo.precoSugeridoPorPessoa)}</span> : '—'}
                  </td>
                  <td className="num text-right">
                    <span className={`block font-semibold ${lucro == null ? 'text-text-muted' : lucro < 0 ? 'text-err' : 'text-ok'}`}>{brl(lucro)}</span>
                    {e.resumo.margem != null && <span className={`block text-[12px] ${acima ? 'text-err' : 'text-text-muted'}`}>margem {pct(e.resumo.margem)}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </DataTable>
      )}
      <p className="text-[12px] text-text-muted">Lucro = receita − custo da comida (com a folga). Insumos = estoque menos o que outros eventos confirmados reservaram. Margem = (preço por pessoa − custo por pessoa) ÷ preço. Com a meta de CMV de {pct(meta, 0)}, a margem mínima é {pct(1 - meta, 0)}. Sugerido = custo por pessoa ÷ {pct(meta, 0)}, arredondado para ,90.</p>
    </div>
  )
}
