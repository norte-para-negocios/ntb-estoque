import type { DetalheOPProprio as Detalhe } from '@/lib/estoque/op-proprio'
import { ReverterOPBotao } from '@/components/ordem-producao/ReverterOPBotao'

// Detalhe da OP do estoque próprio: tudo o que antes só existia no Omie. Receita usada (ficha e versão), cada execução com os insumos
// consumidos (bruto e custo), os movimentos gerados no ledger (e se já foram estornados) e a trilha completa de mudanças.

const th = 'px-3 py-2 text-left text-[13px] font-semibold text-text-muted'
const card = 'rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] bg-surface p-5'
const h2 = 'mb-3 text-[17px] font-semibold text-text'

const fq = (n: number | null | undefined, max = 6) => (n == null ? '-' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: max }))
const fr = (n: number | null | undefined, max = 4) => (n == null ? '-' : `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: max })}`)
const fd = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '-')

const EVENTO: Record<string, { rotulo: string; cor: string }> = {
  criada: { rotulo: 'OP criada', cor: 'bg-info' },
  alterada: { rotulo: 'OP alterada', cor: 'bg-warn' },
  concluida: { rotulo: 'OP concluída', cor: 'bg-ok' },
  revertida: { rotulo: 'Conclusão revertida', cor: 'bg-err' },
  excluida: { rotulo: 'OP excluída', cor: 'bg-err' },
}

function resumoDetalhes(evento: string, d: Record<string, unknown>): string {
  const v = (k: string) => d[k]
  if (evento === 'alterada') {
    const partes: string[] = []
    if (v('data_antes') !== v('data_depois')) partes.push(`data ${String(v('data_antes') ?? '-')} → ${String(v('data_depois') ?? '-')}`)
    if (Number(v('qtde_antes')) !== Number(v('qtde_depois'))) partes.push(`quantidade ${fq(Number(v('qtde_antes')))} → ${fq(Number(v('qtde_depois')))}`)
    return partes.join(' · ') || 'sem mudança de valores'
  }
  if (evento === 'concluida') return `custo ${fr(Number(v('custo_total')))} · unitário ${fr(Number(v('custo_unitario')), 6)}${v('ficha_versao') ? ` · ficha v${String(v('ficha_versao'))}` : ''}`
  if (evento === 'revertida') return `${String(v('estornados') ?? 0)} movimento(s) estornado(s)`
  if (evento === 'criada') return `${v('ficha_versao') ? `ficha v${String(v('ficha_versao'))}` : 'sem ficha técnica ainda'}${v('venda_ref') ? ` · venda ${String(v('venda_ref'))}` : ''}`
  return ''
}

export function DetalheOPProprio({
  detalhe, opId, numOP, concluida, podeReverter, custoTotal, custoUnitario, unidade, criadaPor, criadaEm, concluidaPor, concluidaEm, revertidaPor, revertidaEm, vendaRef,
}: {
  detalhe: Detalhe | null
  opId: number
  numOP: string
  concluida: boolean
  podeReverter: boolean
  custoTotal: number | null
  custoUnitario: number | null
  unidade: string
  criadaPor: string | null
  criadaEm: string | null
  concluidaPor: string | null
  concluidaEm: string | null
  revertidaPor: string | null
  revertidaEm: string | null
  vendaRef: string | null
}) {
  if (!detalhe) return null
  const movimentos = detalhe.execucoes.flatMap((e) => (e.movimentos ?? []).map((m) => ({ ...m, execucao: e.n })))
  return (
    <>
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-text">Produção e custo</h2>
          {concluida && podeReverter && <ReverterOPBotao opId={opId} numOP={numOP} />}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[12px] text-text-muted">Custo total</dt><dd className="mt-0.5 text-[15px] text-text num">{concluida ? fr(custoTotal) : '-'}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Custo por {unidade || 'unidade'}</dt><dd className="mt-0.5 text-[15px] text-text num">{concluida ? fr(custoUnitario, 6) : '-'}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Ficha técnica usada</dt><dd className="mt-0.5 text-[15px] text-text">{detalhe.ficha ? `Versão ${detalhe.ficha.versao}${detalhe.ficha.ativa ? '' : ' (substituída)'}` : 'Sem ficha técnica'}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Venda de origem</dt><dd className="mt-0.5 text-[15px] text-text">{vendaRef || '-'}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Criada</dt><dd className="mt-0.5 text-[15px] text-text">{criadaPor || '-'} <span className="num text-text-muted">{fd(criadaEm)}</span></dd></div>
          <div><dt className="text-[12px] text-text-muted">Concluída</dt><dd className="mt-0.5 text-[15px] text-text">{concluida ? <>{concluidaPor || '-'} <span className="num text-text-muted">{fd(concluidaEm)}</span></> : '-'}</dd></div>
          <div><dt className="text-[12px] text-text-muted">Última reversão</dt><dd className="mt-0.5 text-[15px] text-text">{revertidaEm ? <>{revertidaPor || '-'} <span className="num text-text-muted">{fd(revertidaEm)}</span></> : '-'}</dd></div>
        </dl>
      </div>

      {detalhe.ficha && (
        <div className={card}>
          <h2 className={h2}>Receita usada <span className="text-[13px] font-normal text-text-muted">(ficha v{detalhe.ficha.versao}, rende {fq(detalhe.ficha.rendimento)} {unidade})</span></h2>
          <div className="overflow-x-auto rounded-[var(--r-md)] bg-surface-2/50">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr><th className={th}>Insumo</th><th className={`${th} text-right`}>Líquida</th><th className={`${th} text-right`}>FC</th><th className={`${th} text-right`}>Perda %</th><th className={`${th} text-right`}>Bruta</th><th className={th}>Un.</th></tr></thead>
              <tbody>
                {detalhe.ficha.itens.map((i) => (
                  <tr key={i.codigo_insumo} className="border-t border-border/60">
                    <td className="px-3 py-2"><div className="text-text">{i.descricao}</div><div className="num text-[12px] text-text-muted">{i.codigo}</div></td>
                    <td className="px-3 py-2 text-right num">{fq(i.quantidade_liquida)}</td>
                    <td className="px-3 py-2 text-right num text-text-muted">{fq(i.fator_correcao, 4)}</td>
                    <td className="px-3 py-2 text-right num text-text-muted">{fq(i.perda_pct, 3)}</td>
                    <td className="px-3 py-2 text-right num font-medium text-text">{fq(i.quantidade_bruta)}</td>
                    <td className="px-3 py-2 text-text-muted">{i.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detalhe.execucoes.map((e) => (
        <div key={e.ref} className={card}>
          <h2 className={h2}>
            Execução {e.n}{' '}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[12px] font-medium ${e.status === 'revertida' ? 'bg-err/10 text-err' : 'bg-ok/10 text-ok'}`}>{e.status === 'revertida' ? 'Revertida' : 'Concluída'}</span>
          </h2>
          <p className="mb-3 text-[13px] text-text-muted">
            {fq(e.quantidade)} {unidade} · custo {fr(e.custo_total)} ({fr(e.custo_unitario, 6)} por {unidade || 'unidade'}) · {fd(e.created_at)}{e.user_id ? ` · ${e.user_id}` : ''}
          </p>
          <div className="overflow-x-auto rounded-[var(--r-md)] bg-surface-2/50">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className={th}>Insumo consumido</th><th className={`${th} text-right`}>Qtde bruta</th><th className={th}>Un.</th><th className={`${th} text-right`}>Custo unit.</th><th className={`${th} text-right`}>Custo</th><th className={`${th} text-right`}>Mov.</th></tr></thead>
              <tbody>
                {(e.insumos ?? []).map((i) => (
                  <tr key={`${e.ref}-${i.codigo_insumo}`} className="border-t border-border/60">
                    <td className="px-3 py-2"><div className="text-text">{i.descricao}</div><div className="num text-[12px] text-text-muted">{i.codigo}</div></td>
                    <td className="px-3 py-2 text-right num font-medium text-text">{fq(i.quantidade_bruta)}</td>
                    <td className="px-3 py-2 text-text-muted">{i.unidade}</td>
                    <td className="px-3 py-2 text-right num text-text-muted">{fr(i.custo_unitario, 6)}</td>
                    <td className="px-3 py-2 text-right num">{fr(i.custo_total)}</td>
                    <td className="px-3 py-2 text-right num text-text-muted">#{i.movimento_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {movimentos.length > 0 && (
        <div className={card}>
          <h2 className={h2}>Movimentos do estoque gerados</h2>
          <div className="overflow-x-auto rounded-[var(--r-md)] bg-surface-2/50">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr><th className={th}>Mov.</th><th className={th}>Data</th><th className={th}>Produto</th><th className={th}>Local</th><th className={`${th} text-right`}>Qtde</th><th className={`${th} text-right`}>Custo unit.</th><th className={`${th} text-right`}>Saldo após</th><th className={th} /></tr></thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="px-3 py-2 num text-text-muted">#{m.id}</td>
                    <td className="px-3 py-2 num text-text-muted">{fd(m.created_at)}</td>
                    <td className="px-3 py-2"><div className="text-text">{m.descricao}</div><div className="num text-[12px] text-text-muted">{m.codigo}</div></td>
                    <td className="px-3 py-2 text-text-muted">{m.local}</td>
                    <td className={`px-3 py-2 text-right num font-medium ${m.quantidade < 0 ? 'text-err' : 'text-ok'}`}>{m.quantidade > 0 ? '+' : ''}{fq(m.quantidade)}</td>
                    <td className="px-3 py-2 text-right num text-text-muted">{fr(m.custo_unitario, 6)}</td>
                    <td className="px-3 py-2 text-right num">{fq(m.saldo_apos)}</td>
                    <td className="px-3 py-2">{m.estornado && <span className="rounded-full bg-surface px-2 py-0.5 text-[12px] text-text-muted">estornado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={card}>
        <h2 className={h2}>Histórico da OP</h2>
        {detalhe.historico.length === 0 ? (
          <p className="text-[13px] text-text-muted">Sem eventos registrados.</p>
        ) : (
          <ol className="space-y-3">
            {detalhe.historico.map((h) => (
              <li key={h.id} className="flex items-start gap-3">
                <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${EVENTO[h.evento]?.cor ?? 'bg-border'}`} />
                <div className="min-w-0 text-[14px]">
                  <div className="text-text"><span className="font-medium">{EVENTO[h.evento]?.rotulo ?? h.evento}</span>{h.user_nome ? ` · ${h.user_nome}` : ''} <span className="num text-[12px] text-text-muted">{fd(h.created_at)}</span></div>
                  <div className="text-[13px] text-text-muted">{resumoDetalhes(h.evento, h.detalhes)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  )
}
