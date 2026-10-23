import type { ResumoSaldoConferir } from '@/lib/relatorios/posicao-estoque-puro'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Saldos do Omie que precisam de conferência (migration 296, posicao_saldo_a_conferir). O total NÃO muda (é o saldo do
// Omie, como o relatório do Omie); o aviso diz quanto do total depende desses saldos para o dono conferir.
export function AvisoSaldoConferir({ resumo, total, limite = 30 }: { resumo: ResumoSaldoConferir; total: number; limite?: number }) {
  const { acumulados, inativos } = resumo
  if (!acumulados.length && !inativos.length) return null
  const pct = total > 0 ? Math.round((resumo.valorAcumulados / total) * 100) : null
  return (
    <div className="space-y-2">
      {acumulados.length > 0 && (
        <details className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">
          <summary className="cursor-pointer">
            {brl(resumo.valorAcumulados)} do total{pct != null ? ` (${pct}%)` : ''} {acumulados.length === 1 ? 'está em 1 produto' : `está em ${acumulados.length} produtos`} com saldo maior do que tudo o que entrou nos últimos 12 meses (notas, produção e ajustes): falta de baixa no Omie (consumo, perda ou produção que não foi lançada). O total soma esses saldos como o Omie; confira com um inventário.
          </summary>
          <div className="mt-2 overflow-x-auto text-text">
            <table className="w-full min-w-[520px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Saldo no Omie</th>
                  <th className="px-2 py-1 text-right">Entrou em 12 meses</th><th className="px-2 py-1 text-right">Valor no total</th>
                </tr>
              </thead>
              <tbody>
                {acumulados.slice(0, limite).map((l) => (
                  <tr key={l.codProduto} className="border-t border-border/60">
                    <td className="px-2 py-1"><span className="num text-text-muted">{l.codigo}</span> {l.descricao}</td>
                    <td className="num px-2 py-1 text-right">{qtd(l.saldo)} {l.unidade}</td>
                    <td className="num px-2 py-1 text-right">{l.comprado12m == null ? '—' : `${qtd(l.comprado12m)} ${l.unidade}`}</td>
                    <td className="num px-2 py-1 text-right">{brl(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {acumulados.length > limite && <p className="mt-1 text-text-muted">Mostrando {limite} de {acumulados.length}.</p>}
          </div>
        </details>
      )}
      {inativos.length > 0 && (
        <details className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">
          <summary className="cursor-pointer">
            {inativos.length === 1 ? '1 produto inativo ainda tem' : `${inativos.length} produtos inativos ainda têm`} saldo no Omie ({brl(resumo.valorInativos)} no total). Muitos foram criados sozinhos na entrada de nota (sem família, tipo &quot;Outras&quot;): passe o saldo para o produto certo no Omie.
          </summary>
          <div className="mt-2 overflow-x-auto text-text">
            <table className="w-full min-w-[420px] border-collapse text-[12px]">
              <thead><tr className="text-left text-text-muted"><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Saldo</th><th className="px-2 py-1 text-right">Valor</th></tr></thead>
              <tbody>
                {inativos.slice(0, limite).map((l) => (
                  <tr key={l.codProduto} className="border-t border-border/60">
                    <td className="px-2 py-1"><span className="num text-text-muted">{l.codigo}</span> {l.descricao}</td>
                    <td className="num px-2 py-1 text-right">{qtd(l.saldo)} {l.unidade}</td>
                    <td className="num px-2 py-1 text-right">{brl(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inativos.length > limite && <p className="mt-1 text-text-muted">Mostrando {limite} de {inativos.length}.</p>}
          </div>
        </details>
      )}
    </div>
  )
}
