import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, entradaFluxo, PERM } from '@/lib/financeiro/dados'
import { montarFluxo, origensDoPeriodo, rotuloPeriodo, type Agrupar, type Fluxo } from '@/lib/financeiro/fluxo-caixa-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { campo, dataBR } from '@/components/financeiro/comum'

// Fase 4 passo 5: fluxo de caixa realizado (extrato) + previsto (a pagar, a receber das vendas, recorrentes) e saldo
// projetado por conta corrente. Só desenvolvedor (rota-mãe /financeiro em ROTAS_SO_DEV), só loja de estoque próprio,
// permissão 'Financeiro - Contas correntes'. Cada célula abre os lançamentos/contas que a formam (?periodo=&tipo=).
type Sp = { de?: string; ate?: string; por?: string; periodo?: string; tipo?: string }
const LIMITE: Record<Agrupar, number> = { dia: 92, semana: 400, mes: 731 }

const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export default async function FluxoCaixaPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const por: Agrupar = sp.por === 'dia' || sp.por === 'mes' ? sp.por : 'semana'
  const de = data(sp.de) ?? `${hoje.slice(0, 7)}-01`
  let ate = data(sp.ate) ?? somaDias(hoje, 30)
  let cortado = false
  if (ate < de) ate = de
  if (diasEntre(de, ate) > LIMITE[por]) { ate = somaDias(de, LIMITE[por]); cortado = true }

  let erro: string | null = null
  let fluxo: Fluxo | null = null
  let avisos: string[] = []
  const inicio = Date.now()
  try {
    const r = await entradaFluxo(lojaId, de, ate, hoje, por)
    fluxo = montarFluxo(r.entrada)
    avisos = [...r.avisos, ...fluxo.avisos]
  } catch (e) {
    erro = e instanceof Error ? e.message : 'Não foi possível montar o fluxo de caixa.'
  }
  console.info(`financeiro/fluxo-caixa: loja ${lojaId} ${de}..${ate} por ${por} em ${Date.now() - inicio} ms`)

  const link = (extra: Record<string, string>) => `/financeiro/fluxo-caixa?${new URLSearchParams({ de, ate, por, ...extra })}`
  const celula = (v: number, periodo: string, tipo: 'realizado' | 'previsto') =>
    v ? <Link href={link({ periodo, tipo })} className="hover:underline"><Money value={v} /></Link> : <span className="text-text-muted">—</span>
  const aberto = fluxo && sp.periodo && (sp.tipo === 'realizado' || sp.tipo === 'previsto') ? origensDoPeriodo(fluxo, sp.periodo, sp.tipo) : null

  return (
    <div className="space-y-4">
      <PageHeader title="Fluxo de caixa" icon={TrendingUp}
        description="O que entrou e saiu das contas até hoje e o que está previsto daqui para frente: contas a pagar, vendas a receber e contas recorrentes. Clique num valor para ver o que o forma." />

      <form method="get" className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card sm:grid-cols-4">
        <label className="space-y-1"><span>De</span><input type="date" name="de" defaultValue={de} className={campo} /></label>
        <label className="space-y-1"><span>Até</span><input type="date" name="ate" defaultValue={ate} className={campo} /></label>
        <label className="space-y-1"><span>Ver por</span>
          <select name="por" defaultValue={por} className={campo}>
            <option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnClass('primary')}>Ver</button>
          <Link href="/financeiro/fluxo-caixa" className={btnClass('outline')}>Limpar</Link>
        </div>
      </form>
      {cortado && <p className="text-[12px] text-text-muted">Período cortado em {LIMITE[por]} dias para a visão por {por}.</p>}
      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}
      {avisos.map((a) => <p key={a} className="rounded-[var(--r-lg)] bg-warn/10 px-4 py-2.5 text-[13px] text-text">{a}</p>)}

      {fluxo && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {([
              [`Saldo em ${dataBR(de)} (início)`, fluxo.saldoInicial],
              ['Saldo hoje', fluxo.contas.reduce((s, c) => s + Math.round(c.saldoAtual * 100), 0) / 100],
              [`Saldo projetado em ${dataBR(ate)}`, fluxo.saldoFinalProjetado],
            ] as [string, number][]).map(([rot, val]) => (
              <div key={rot} className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
                <p className="text-[13px] text-text-muted">{rot}</p>
                <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-text"><Money value={val} /></p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Período</th>
                  <th className="px-2 py-2.5 text-right font-medium">Entrou</th>
                  <th className="px-2 py-2.5 text-right font-medium">Saiu</th>
                  <th className="px-2 py-2.5 text-right font-medium">A entrar (previsto)</th>
                  <th className="px-2 py-2.5 text-right font-medium">A sair (previsto)</th>
                  <th className="px-4 py-2.5 text-right font-medium">Saldo no fim</th>
                </tr>
              </thead>
              <tbody>
                {fluxo.periodos.map((p) => (
                  <tr key={p.chave} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2 whitespace-nowrap">{p.rotulo}{p.transferencias ? <span className="text-text-muted"> · transferências <Money value={p.transferencias} /></span> : null}</td>
                    <td className="px-2 py-2 text-right">{celula(p.realizadoEntradas, p.chave, 'realizado')}</td>
                    <td className="px-2 py-2 text-right">{celula(p.realizadoSaidas, p.chave, 'realizado')}</td>
                    <td className="px-2 py-2 text-right">{celula(p.previstoEntradas, p.chave, 'previsto')}</td>
                    <td className="px-2 py-2 text-right">{celula(p.previstoSaidas, p.chave, 'previsto')}</td>
                    <td className={`px-4 py-2 text-right font-medium ${p.saldoFinal < 0 ? 'text-err' : ''}`}><Money value={p.saldoFinal} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {aberto && (
            <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
              <div className="flex items-center justify-between px-4 pt-3">
                <h2 className="text-[15px] font-semibold">{sp.tipo === 'realizado' ? 'Lançamentos' : 'Previsto'} · {rotuloPeriodo(sp.periodo!, por)}</h2>
                <Link href={link({})} className={btnClass('outline')}>Fechar</Link>
              </div>
              {aberto.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-muted">Nada neste período.</p> : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {aberto.map((o) => (
                      <tr key={o.ref} className="border-t border-[var(--border)]">
                        <td className="px-4 py-2 whitespace-nowrap">{dataBR(o.data)}{o.atrasado && <span className="text-err"> · vencida em {dataBR(o.dataOriginal)}</span>}</td>
                        <td className="px-2 py-2">
                          {o.href ? <Link href={o.href} className="hover:underline">{o.descricao}</Link> : o.descricao}
                          {o.transferencia && <span className="text-text-muted"> · transferência</span>}
                          {o.estimado && <span className="text-warn"> · valor estimado</span>}
                        </td>
                        <td className="px-2 py-2 text-text-muted">{o.conta ?? 'Sem conta definida'}</td>
                        <td className="px-4 py-2 text-right"><Money value={o.valor} /></td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--border)] font-semibold">
                      <td className="px-4 py-2" colSpan={3}>Soma</td>
                      <td className="px-4 py-2 text-right"><Money value={Math.round(aberto.reduce((s, o) => s + o.valor * 100, 0)) / 100} /></td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
            <h2 className="px-4 pt-3 text-[15px] font-semibold">Saldo projetado por conta em {dataBR(ate)}</h2>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Conta</th>
                  <th className="px-2 py-2.5 text-right font-medium">Saldo hoje</th>
                  <th className="px-2 py-2.5 text-right font-medium">A entrar</th>
                  <th className="px-2 py-2.5 text-right font-medium">A sair</th>
                  <th className="px-4 py-2.5 text-right font-medium">Projetado</th>
                </tr>
              </thead>
              <tbody>
                {fluxo.contas.map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2"><Link href={`/financeiro/extrato?conta=${c.id}`} className="hover:underline">{c.nome}</Link></td>
                    <td className="px-2 py-2 text-right"><Money value={c.saldoAtual} /></td>
                    <td className="px-2 py-2 text-right"><Money value={c.entradasPrevistas} /></td>
                    <td className="px-2 py-2 text-right"><Money value={c.saidasPrevistas} /></td>
                    <td className={`px-4 py-2 text-right font-medium ${c.saldoProjetado < 0 ? 'text-err' : ''}`}><Money value={c.saldoProjetado} /></td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--border)] text-text-muted">
                  <td className="px-4 py-2">Sem conta definida (contas a pagar e recorrentes)</td>
                  <td className="px-2 py-2 text-right">—</td>
                  <td className="px-2 py-2 text-right"><Money value={fluxo.semConta.entradas} /></td>
                  <td className="px-2 py-2 text-right"><Money value={fluxo.semConta.saidas} /></td>
                  <td className="px-4 py-2 text-right"><Money value={Math.round((fluxo.semConta.entradas - fluxo.semConta.saidas) * 100) / 100} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
