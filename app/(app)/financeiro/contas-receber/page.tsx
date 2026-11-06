import Link from 'next/link'
import { HandCoins } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, chaveReceberVendas, listarContas, listarTitulosReceber, PERM, type FiltrosReceber } from '@/lib/financeiro/dados'
import { FORMAS_RECEBIMENTO, ROTULO_FORMA, ROTULO_SITUACAO_RECEBER, janelaGeracao, type SituacaoReceber } from '@/lib/financeiro/receber-vendas-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { FUNDO_CLASSE, type CorToken } from '@/lib/status-cor'
import { campo, dataBR } from '@/components/financeiro/comum'
import { BotaoReceber, EstornarRecebimento, GerarReceber, rotuloTituloReceber } from '@/components/financeiro/ContasReceberUI'

// Fase 4 passo 3 (migration 380): contas a receber geradas pelas vendas do Norte Vendas, uma por dia × forma de pagamento.
// Só desenvolvedor (rota-mãe /financeiro em ROTAS_SO_DEV), só loja de estoque próprio, permissão 'Financeiro - Contas a receber'.
const POR_PAGINA = 100
const SITUACOES = [
  { value: '', label: 'Todas (menos canceladas)' }, { value: 'em_aberto', label: 'A receber (inclui atrasadas)' },
  { value: 'atrasado', label: 'Atrasadas' }, { value: 'recebido', label: 'Recebidas' }, { value: 'configurar', label: 'Forma sem cadastro' },
  { value: 'cancelado', label: 'Canceladas' },
]
const COR: Record<SituacaoReceber, CorToken> = { aberto: 'info', atrasado: 'err', recebido: 'ok', cancelado: 'neutro' }

type Sp = { de?: string; ate?: string; forma?: string; situacao?: string; page?: string }

export default async function ContasReceberPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { lojaId, podePagar: podeReceber } = await acessoFinanceiro(PERM.contasReceber)
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const filtros: FiltrosReceber = {
    venda_de: data(sp.de), venda_ate: data(sp.ate),
    forma: (FORMAS_RECEBIMENTO as readonly string[]).includes(sp.forma ?? '') ? sp.forma : undefined,
    situacao: SITUACOES.some((s) => s.value && s.value === sp.situacao) ? sp.situacao : undefined,
  }
  const page = Math.max(1, Number(sp.page) || 1)
  const [{ itens, totais, erro }, { contas }, chave] = await Promise.all([
    listarTitulosReceber(lojaId, filtros, hoje, POR_PAGINA, (page - 1) * POR_PAGINA), listarContas(lojaId), chaveReceberVendas(lojaId),
  ])
  const contasAtivas = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  const janela = janelaGeracao(hoje, 7)
  const link = (p: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') q.set(k, v)
    if (p > 1) q.set('page', String(p))
    return `/financeiro/contas-receber${q.toString() ? `?${q}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Contas a receber" icon={HandCoins}
        description="O que as vendas do Norte Vendas têm para cair na conta: uma linha por dia e forma de pagamento, já sem a taxa da adquirente. Dar baixa só registra o que caiu."
        actions={<Link href="/financeiro/formas-recebimento" className={btnClass('outline')}>Taxas e prazos</Link>} />
      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}
      {chave.semMigration ? null : <GerarReceber de={janela.de} ate={hoje} ligada={chave.ligada} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ['Vendido no filtro', totais.bruto, `${totais.quantidade} contas · taxas `, totais.taxa],
          ['A receber', totais.a_receber, 'atrasado ', totais.atrasado],
          ['Já recebido', totais.recebido, 'diferença ', totais.diferenca],
          ['Líquido previsto', totais.liquido, totais.configurar ? `${totais.configurar} sem cadastro de taxa` : 'todas com taxa cadastrada', null],
        ] as [string, number, string, number | null][]).map(([rot, val, sub, subVal]) => (
          <div key={rot} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <p className="text-[13px] text-text-muted">{rot}</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-text"><Money value={val} /></p>
            <p className="text-[12px] text-text-muted">{sub}{subVal !== null && <Money value={subVal} />}</p>
          </div>
        ))}
      </div>

      <form method="get" className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1"><span>Vendas de</span><input type="date" name="de" defaultValue={sp.de} className={campo} /></label>
        <label className="space-y-1"><span>até</span><input type="date" name="ate" defaultValue={sp.ate} className={campo} /></label>
        <label className="space-y-1"><span>Forma</span>
          <select name="forma" defaultValue={sp.forma ?? ''} className={campo}>
            <option value="">Todas</option>
            {FORMAS_RECEBIMENTO.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span>Situação</span>
          <select name="situacao" defaultValue={sp.situacao ?? ''} className={campo}>
            {SITUACOES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnClass('primary')}>Filtrar</button>
          <Link href="/financeiro/contas-receber" className={btnClass('outline')}>Limpar</Link>
        </div>
      </form>

      {itens.length === 0 && !erro ? (
        <EmptyState icon={HandCoins} title="Nenhuma conta a receber"
          hint={chave.ligada ? 'As contas aparecem quando o Norte Vendas manda as vendas fechadas desta loja.' : 'A geração pelas vendas está desligada nesta loja.'} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2.5 font-medium">Vendas de</th>
                <th className="px-2 py-2.5 font-medium">Forma</th>
                <th className="px-2 py-2.5 text-right font-medium">Vendido</th>
                <th className="px-2 py-2.5 text-right font-medium">Taxa</th>
                <th className="px-2 py-2.5 text-right font-medium">A receber</th>
                <th className="px-2 py-2.5 font-medium">Previsto para</th>
                <th className="px-2 py-2.5 font-medium">Situação</th>
                <th className="px-2 py-2.5 text-right font-medium">Recebido</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {itens.map((t) => (
                <tr key={t.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-2 num">{dataBR(t.data_venda)}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium text-text">{ROTULO_FORMA[t.forma]}</span>
                    <p className="text-text-muted">{t.adquirente ?? (t.configurar ? <Link href="/financeiro/formas-recebimento" className="text-warn hover:underline">Configurar taxa e prazo</Link> : '—')} · {t.quantidade} pgto{t.quantidade === 1 ? '' : 's'}</p>
                  </td>
                  <td className="num px-2 py-2 text-right"><Money value={t.valor_bruto} /></td>
                  <td className="num px-2 py-2 text-right text-text-muted"><Money value={t.valor_taxa} /></td>
                  <td className="num px-2 py-2 text-right font-medium"><Money value={t.valor_liquido} /></td>
                  <td className="px-2 py-2 num">{dataBR(t.data_prevista)}{t.conta_nome && <p className="text-text-muted">{t.conta_nome}</p>}</td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-text">
                      <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[COR[t.situacao]]}`} />{ROTULO_SITUACAO_RECEBER[t.situacao]}
                    </span>
                    {t.status === 'cancelado' && t.motivo_cancelamento && <p className="text-text-muted">{t.motivo_cancelamento}</p>}
                  </td>
                  <td className="num px-2 py-2 text-right">
                    {t.valor_recebido !== null ? <><Money value={t.valor_recebido} /><p className="text-text-muted">{dataBR(t.data_recebimento)}{t.diferenca ? <> · dif. <Money value={t.diferenca} /></> : null}</p></> : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {podeReceber && t.status === 'aberto' && <BotaoReceber tituloId={t.id} rotuloTitulo={rotuloTituloReceber(t.data_venda, t.forma)} previsto={t.valor_liquido} contaPadrao={t.conta_id} contas={contasAtivas} hoje={hoje} />}
                    {podeReceber && t.status === 'recebido' && t.recebimento_id && <EstornarRecebimento recebimentoId={t.recebimento_id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(page > 1 || page * POR_PAGINA < totais.quantidade) && (
        <div className="flex gap-2">
          {page > 1 && <Link href={link(page - 1)} className={btnClass('outline')}>Anterior</Link>}
          {page * POR_PAGINA < totais.quantidade && <Link href={link(page + 1)} className={btnClass('outline')}>Próxima</Link>}
        </div>
      )}
    </div>
  )
}
