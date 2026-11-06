import Link from 'next/link'
import { BotaoImprimir } from '@/components/relatorios/BotaoImprimir'
import { Download, FileBarChart } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { acessoFinanceiro, vendasPorProdutoMes, PERM } from '@/lib/financeiro/dados'
import { carregarDre, MAX_MESES_DRE, okMes } from '@/lib/financeiro/dre-carregar'
import {
  fimDoMes, linhasVendasPorProduto, montarDre, origensDaLinha, ROTULO_LINHA, type CodigoFora, type CodigoLinha, type EntradaDre, type Mes,
} from '@/lib/financeiro/dre-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { campo, dataBR, mesBR } from '@/components/financeiro/comum'

// Fase 4 passo 5: DRE por competência, por loja e consolidada. Só desenvolvedor (rota-mãe /financeiro em ROTAS_SO_DEV),
// só loja de estoque próprio, permissão 'Financeiro - Contas correntes'. Todo número abre as linhas de origem (?linha=&mes=).
type Sp = { de?: string; ate?: string; escopo?: string; linha?: string; mes?: string }
const MAX_MESES = MAX_MESES_DRE
const FORA: CodigoFora[] = ['fora_compras_estoque', 'fora_investimento', 'fora_sem_categoria']

export default async function DrePage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const sp = await searchParams
  const { mesAtual, ate, de, meses, consolidada, lojas, ent, dre, erro, avisosLeitura } = await carregarDre(lojaId, sp)
  const totalReceita = dre.linhas.find((l) => l.codigo === 'receita_bruta')?.total ?? 0

  const base = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams()
    q.set('de', meses[0] ?? de); q.set('ate', ate)
    if (consolidada) q.set('escopo', 'consolidada')
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
    return `/financeiro/dre?${q}`
  }
  const linhaAberta = sp.linha && (sp.linha in ROTULO_LINHA) ? sp.linha : null
  const mesAberto = okMes(sp.mes) && meses.includes(sp.mes!) ? sp.mes! : null

  return (
    <div className="space-y-4">
      <PageHeader title="DRE" icon={FileBarChart}
        actions={<>{!erro ? <a href={`/financeiro/dre/export?${new URLSearchParams({ de: meses[0] ?? de, ate, ...(consolidada ? { escopo: 'consolidada' } : {}) })}`} className={btnClass('outline')}><Download className="size-4" /> Exportar Excel</a> : undefined}<BotaoImprimir /></>}
        description="Resultado por mês de competência: vendas e custo do estoque, deduções e as despesas lançadas no financeiro. Clique em qualquer número para ver de onde ele vem." />

      <p className="hidden text-[13px] text-text-muted print:block">Período: {mesBR(`${meses[0] ?? de}-01`)} a {mesBR(`${ate}-01`)}{consolidada ? ` · consolidada: ${lojas.map((l) => l.nome).join(', ')}` : ''}</p>
      <form method="get" className="print:hidden grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card sm:grid-cols-4">
        <label className="space-y-1"><span>De</span><input type="month" name="de" defaultValue={meses[0] ?? de} max={mesAtual} className={campo} /></label>
        <label className="space-y-1"><span>Até</span><input type="month" name="ate" defaultValue={ate} max={mesAtual} className={campo} /></label>
        <label className="space-y-1"><span>Lojas</span>
          <select name="escopo" defaultValue={consolidada ? 'consolidada' : ''} className={campo}>
            <option value="">Só esta loja</option>
            <option value="consolidada">Consolidada (todas as lojas próprias)</option>
          </select>
        </label>
        <div className="flex items-end gap-2"><button type="submit" className={btnClass('primary')}>Ver</button></div>
      </form>
      <p className="text-[12px] text-text-muted">
        {consolidada ? `Consolidada: ${lojas.map((l) => l.nome).join(', ') || 'nenhuma loja'}. ` : ''}
        Até {MAX_MESES} meses por vez. Receita e CMV são os mesmos do relatório de CMV.
      </p>

      {erro && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{erro}</p>}
      {!erro && [...dre.avisos, ...avisosLeitura].map((a) => (
        <p key={a} className="rounded-[var(--r-lg)] bg-warn/10 px-4 py-2.5 text-[13px] text-text">{a}</p>
      ))}

      {!erro && (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2.5 font-medium">Linha</th>
                {meses.map((m) => <th key={m} className="px-2 py-2.5 text-right font-medium">{mesBR(`${m}-01`)}</th>)}
                {meses.length > 1 && <th className="px-2 py-2.5 text-right font-medium">Total</th>}
                <th className="px-4 py-2.5 text-right font-medium">% da receita</th>
              </tr>
            </thead>
            <tbody>
              {dre.linhas.map((l) => {
                const forte = l.nivel !== 'base'
                const vazio = l.total === null
                return (
                  <tr key={l.codigo} className={`border-t border-[var(--border)] ${forte ? 'font-semibold' : ''} ${l.nivel === 'resultado' ? 'bg-surface-2' : ''}`}>
                    <td className="px-4 py-2">{l.rotulo}</td>
                    {meses.map((m) => (
                      <td key={m} className="px-2 py-2 text-right whitespace-nowrap">
                        {l.valores[m] === null ? <span className="text-text-muted">—</span>
                          : <Link href={base({ linha: l.codigo, mes: m })} className="hover:underline"><Money value={l.valores[m]!} /></Link>}
                      </td>
                    ))}
                    {meses.length > 1 && (
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {vazio ? <span className="text-text-muted">—</span> : <Link href={base({ linha: l.codigo })} className="hover:underline"><Money value={l.total!} /></Link>}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right text-text-muted">
                      {vazio || !totalReceita ? '—' : `${((l.total! / totalReceita) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
                    </td>
                  </tr>
                )
              })}
              {!dre.temDespesas && (
                <tr className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 text-text-muted" colSpan={meses.length + (meses.length > 1 ? 3 : 2)}>
                    Despesas: sem despesas lançadas no financeiro neste período. O resultado operacional e o líquido aparecem quando houver contas a pagar lançadas.
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-[var(--border)] text-text-muted">
                <td className="px-4 py-2 font-medium" colSpan={meses.length + (meses.length > 1 ? 3 : 2)}>Fora da DRE (para conferência)</td>
              </tr>
              {FORA.map((f) => {
                const tot = meses.reduce((s, m) => s + dre.fora[f][m], 0)
                return (
                  <tr key={f} className="border-t border-[var(--border)] text-text-muted">
                    <td className="px-4 py-2">{ROTULO_LINHA[f]}</td>
                    {meses.map((m) => (
                      <td key={m} className="px-2 py-2 text-right whitespace-nowrap">
                        {dre.fora[f][m] ? <Link href={base({ linha: f, mes: m })} className="hover:underline"><Money value={dre.fora[f][m]} /></Link> : <Money value={0} />}
                      </td>
                    ))}
                    {meses.length > 1 && <td className="px-2 py-2 text-right"><Money value={Math.round(tot * 100) / 100} /></td>}
                    <td className="px-4 py-2" />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!erro && linhaAberta && (
        <Origens ent={ent} dre={dre} linha={linhaAberta} mes={mesAberto} lojas={lojas} consolidada={consolidada} fechar={base({})} base={base} />
      )}
    </div>
  )
}

const SUBTOTAIS: Partial<Record<CodigoLinha, [CodigoLinha, '+' | '−'][]>> = {
  receita_liquida: [['receita_bruta', '+'], ['deducoes', '−']],
  lucro_bruto: [['receita_liquida', '+'], ['cmv', '−']],
  total_despesas: [['despesa_pessoal', '+'], ['despesa_ocupacao', '+'], ['despesa_operacional', '+'], ['despesa_administrativa', '+']],
  resultado_operacional: [['lucro_bruto', '+'], ['total_despesas', '−']],
  resultado_liquido: [['resultado_operacional', '+'], ['resultado_financeiro', '+'], ['outras', '+'], ['imposto_resultado', '−']],
}

async function Origens({ ent, dre, linha, mes, lojas, consolidada, fechar, base }: {
  ent: EntradaDre; dre: ReturnType<typeof montarDre>; linha: string; mes: Mes | null; lojas: { id: number; nome: string }[]
  consolidada: boolean; fechar: string; base: (e: Record<string, string | null>) => string
}) {
  const titulo = `${ROTULO_LINHA[linha as CodigoLinha]}${mes ? ` · ${mesBR(`${mes}-01`)}` : ' · período todo'}`
  const valorDa = (c: CodigoLinha) => {
    const l = dre.linhas.find((x) => x.codigo === c)
    return mes ? l?.valores[mes] ?? null : l?.total ?? null
  }
  const sub = SUBTOTAIS[linha as CodigoLinha]
  let corpo: React.ReactNode
  if (sub) {
    corpo = (
      <table className="w-full text-[13px]"><tbody>
        {sub.map(([c, s]) => (
          <tr key={c} className="border-t border-[var(--border)]">
            <td className="px-4 py-2">{s} <Link href={base({ linha: c, mes })} className="hover:underline">{ROTULO_LINHA[c]}</Link></td>
            <td className="px-4 py-2 text-right">{valorDa(c) === null ? '—' : <Money value={valorDa(c)!} />}</td>
          </tr>
        ))}
        <tr className="border-t border-[var(--border)] font-semibold"><td className="px-4 py-2">= {ROTULO_LINHA[linha as CodigoLinha]}</td>
          <td className="px-4 py-2 text-right">{valorDa(linha as CodigoLinha) === null ? '—' : <Money value={valorDa(linha as CodigoLinha)!} />}</td></tr>
      </tbody></table>
    )
  } else if ((linha === 'receita_bruta' || linha === 'cmv') && mes) {
    const campo = linha === 'cmv' ? 'cmv' : 'receita'
    const porLoja = await Promise.all(lojas.map(async (l) => {
      const total = ent.vendas.find((v) => v.loja_id === l.id && v.mes === mes)
      const rows = await vendasPorProdutoMes(l.id, mes)
      return { loja: l, total: total ? (campo === 'cmv' ? total.cmv : total.faturamento) : 0, ...linhasVendasPorProduto(rows, campo, total ? (campo === 'cmv' ? total.cmv : total.faturamento) : 0) }
    }))
    const lojaSessao = await getCurrentLojaId()
    corpo = porLoja.map((p) => (
      <div key={p.loja.id} className="space-y-2 px-4 py-3">
        <p className="text-[13px]">
          {consolidada && <strong>{p.loja.nome}: </strong>}
          {linha === 'cmv' ? 'Custo das baixas do estoque' : 'Vendas'} por produto, pela mesma função do relatório de CMV (lucro_proprio).
          {p.loja.id === lojaSessao && <> <Link href={`/relatorio-cmv?ini=${mes}-01&fim=${fimDoMes(mes)}`} className="text-accent hover:underline">Abrir no relatório de CMV</Link></>}
        </p>
        <table className="w-full text-[13px]"><tbody>
          {p.linhas.map((l) => (
            <tr key={l.rotulo} className="border-t border-[var(--border)]">
              <td className="py-1.5">{l.rotulo}</td>
              <td className="py-1.5 text-right text-text-muted">{l.quantidade.toLocaleString('pt-BR')}</td>
              <td className="py-1.5 text-right"><Money value={l.valor} /></td>
            </tr>
          ))}
          <tr className="border-t border-[var(--border)] font-semibold"><td className="py-1.5" colSpan={2}>Soma dos produtos</td><td className="py-1.5 text-right"><Money value={p.soma} /></td></tr>
          {p.diferenca !== 0 && <tr className="text-text-muted"><td className="py-1.5" colSpan={2}>Arredondamento (por produto × no mês)</td><td className="py-1.5 text-right"><Money value={p.diferenca} /></td></tr>}
        </tbody></table>
      </div>
    ))
  } else {
    const os = origensDaLinha(ent, linha, mes)
    const soma = Math.round(os.reduce((s, o) => s + o.valor * 100, 0)) / 100
    corpo = os.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-muted">Nenhuma linha de origem neste período.</p> : (
      <table className="w-full min-w-[640px] text-[13px]">
        <thead><tr className="text-left text-text-muted">
          <th className="px-4 py-2 font-medium">Data</th>{consolidada && <th className="px-2 py-2 font-medium">Loja</th>}
          <th className="px-2 py-2 font-medium">Origem</th><th className="px-2 py-2 font-medium">Categoria</th><th className="px-4 py-2 text-right font-medium">Valor</th>
        </tr></thead>
        <tbody>
          {os.map((o) => (
            <tr key={`${o.loja_id}:${o.ref}`} className="border-t border-[var(--border)]">
              <td className="px-4 py-2 whitespace-nowrap">{o.tipo === 'vendas' || o.tipo === 'cmv' ? mesBR(o.data) : dataBR(o.data)}</td>
              {consolidada && <td className="px-2 py-2">{ent.nomesLojas?.[o.loja_id]}</td>}
              <td className="px-2 py-2">
                {o.href ? <Link href={o.tipo === 'vendas' || o.tipo === 'cmv' ? base({ linha, mes: o.mes }) : o.href} className="hover:underline">{o.descricao}</Link> : o.descricao}
                {o.estimado && <span className="text-warn"> · estimada</span>}
              </td>
              <td className="px-2 py-2 text-text-muted">{o.categoria ?? (o.tipo === 'titulo_pagar' ? 'A definir' : '—')}</td>
              <td className="px-4 py-2 text-right"><Money value={o.valor} /></td>
            </tr>
          ))}
          <tr className="border-t border-[var(--border)] font-semibold">
            <td className="px-4 py-2" colSpan={consolidada ? 4 : 3}>Soma das origens</td><td className="px-4 py-2 text-right"><Money value={soma} /></td>
          </tr>
        </tbody>
      </table>
    )
  }
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-[15px] font-semibold">De onde vem: {titulo}</h2>
        <Link href={fechar} className={btnClass('outline')}>Fechar</Link>
      </div>
      {corpo}
    </div>
  )
}
