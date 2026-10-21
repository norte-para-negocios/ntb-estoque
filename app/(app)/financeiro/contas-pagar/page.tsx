import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, listarCategorias, listarContas, listarFornecedores, listarTitulos, PERM, type FiltrosTitulos } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { BotaoPagar, FormTitulo } from '@/components/financeiro/ContasPagarUI'
import { campo, dataBR, OPCOES_SITUACAO, SituacaoSelo } from '@/components/financeiro/comum'

// Finanças, etapa 1: contas a pagar (migrations 285/286). Só desenvolvedores, só loja de estoque próprio.
const POR_PAGINA = 50

type Sp = { de?: string; ate?: string; fornecedor?: string; categoria?: string; situacao?: string; q?: string; page?: string }

export default async function ContasPagarPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { lojaId, podePagar } = await acessoFinanceiro(PERM.contasPagar)
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const filtros: FiltrosTitulos = {
    venc_de: data(sp.de), venc_ate: data(sp.ate), fornecedor_id: Number(sp.fornecedor) || undefined,
    categoria_id: Number(sp.categoria) || undefined, situacao: OPCOES_SITUACAO.some((o) => o.value && o.value === sp.situacao) ? sp.situacao : undefined,
    q: sp.q?.trim().slice(0, 80) || undefined,
  }
  const page = Math.max(1, Number(sp.page) || 1)

  const [{ itens, totais, erro }, fornecedores, categorias, { contas }] = await Promise.all([
    listarTitulos(lojaId, filtros, hoje, POR_PAGINA, (page - 1) * POR_PAGINA),
    listarFornecedores(lojaId), listarCategorias(lojaId), listarContas(lojaId),
  ])
  const catDespesa = categorias.filter((c) => c.tipo === 'despesa' && c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  const contasAtivas = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome, saldo: c.saldo_atual }))
  const temProxima = page * POR_PAGINA < totais.quantidade

  const link = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') q.set(k, v)
    if (p > 1) q.set('page', String(p))
    const s = q.toString()
    return s ? `/financeiro/contas-pagar?${s}` : '/financeiro/contas-pagar'
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Contas a pagar" icon={Receipt}
        description="Títulos a pagar aos fornecedores. Registrar pagamento só anota a baixa e a saída no extrato da conta; não paga no banco."
        actions={<FormTitulo fornecedores={fornecedores} categorias={catDespesa} hoje={hoje}>Nova conta a pagar</FormTitulo>} />
      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Títulos no filtro', String(totais.quantidade), null],
          ['Falta pagar', null, totais.valor_restante],
          [`Atrasado (${totais.quantidade_atrasada})`, null, totais.valor_atrasado],
          ['Já pago', null, totais.valor_pago],
        ].map(([rot, txt, val]) => (
          <div key={String(rot)} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <p className="text-[13px] text-text-muted">{rot}</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-text">{txt ?? <Money value={val as number} />}</p>
          </div>
        ))}
      </div>

      <form method="get" className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card sm:grid-cols-2 lg:grid-cols-6">
        <label className="space-y-1"><span>Vence de</span><input type="date" name="de" defaultValue={sp.de} className={campo} /></label>
        <label className="space-y-1"><span>até</span><input type="date" name="ate" defaultValue={sp.ate} className={campo} /></label>
        <label className="space-y-1"><span>Fornecedor</span>
          <select name="fornecedor" defaultValue={sp.fornecedor ?? ''} className={campo}>
            <option value="">Todos</option>
            {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span>Categoria</span>
          <select name="categoria" defaultValue={sp.categoria ?? ''} className={campo}>
            <option value="">Todas</option>
            {categorias.filter((c) => c.tipo === 'despesa').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span>Situação</span>
          <select name="situacao" defaultValue={sp.situacao ?? ''} className={campo}>
            {OPCOES_SITUACAO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span>Buscar</span><input name="q" defaultValue={sp.q} placeholder="documento, nº, obs." className={campo} /></label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className={btnClass('primary')}>Filtrar</button>
          <Link href="/financeiro/contas-pagar" className={btnClass('outline')}>Limpar</Link>
        </div>
      </form>

      {itens.length === 0 && !erro ? (
        <EmptyState icon={Receipt} title="Nenhuma conta a pagar" hint="Use “Nova conta a pagar” ou ajuste os filtros." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2.5 font-medium">Vence</th>
                <th className="px-2 py-2.5 font-medium">Fornecedor</th>
                <th className="px-2 py-2.5 font-medium">Categoria</th>
                <th className="px-2 py-2.5 text-right font-medium">Valor</th>
                <th className="px-2 py-2.5 text-right font-medium">Falta pagar</th>
                <th className="px-2 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {itens.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{dataBR(t.data_vencimento)}</td>
                  <td className="px-2 py-2">
                    <Link href={`/financeiro/contas-pagar/${t.id}`} className="font-medium text-text hover:underline">{t.fornecedor_nome}</Link>
                    <p className="text-text-muted">Nº {t.numero}{t.documento ? ` · doc ${t.documento}` : ''}{t.total_parcelas > 1 ? ` · parc. ${t.parcela}/${t.total_parcelas}` : ''}</p>
                  </td>
                  <td className="px-2 py-2 text-text-muted">{t.categoria_nome ?? '—'}</td>
                  <td className="px-2 py-2 text-right"><Money value={t.valor} /></td>
                  <td className="px-2 py-2 text-right"><Money value={t.restante} /></td>
                  <td className="px-2 py-2"><SituacaoSelo situacao={t.situacao} /></td>
                  <td className="px-4 py-2 text-right">
                    {podePagar && (t.status === 'aberto' || t.status === 'parcial') && (
                      <BotaoPagar tituloId={t.id} rotuloTitulo={`${t.fornecedor_nome} · nº ${t.numero}`} restante={t.restante} contas={contasAtivas} hoje={hoje}>Pagar</BotaoPagar>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || temProxima) && (
        <div className="flex items-center justify-between text-[13px]">
          {page > 1 ? <Link className={btnClass('outline')} href={link(page - 1)}>Anterior</Link> : <span />}
          <span className="text-text-muted">Página {page} · {totais.quantidade} títulos</span>
          {temProxima ? <Link className={btnClass('outline')} href={link(page + 1)}>Próxima</Link> : <span />}
        </div>
      )}
    </div>
  )
}
