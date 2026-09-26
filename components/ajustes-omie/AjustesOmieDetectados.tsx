import { carregarAjustesOmieDetectados, type AjusteOmieDetectado } from '@/lib/ajustes-omie'

function fmtData(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

export async function AjustesOmieDetectados({ lojaId, tipo }: { lojaId: number; tipo: 'TRF' | 'SLD' }) {
  const itens = await carregarAjustesOmieDetectados(lojaId, tipo, '2025-07-01', new Date().toISOString().slice(0, 10))
  if (itens.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[17px] font-semibold text-text">
          Feito direto na Omie (<span className="num">{itens.length}</span>)
        </h2>
      </div>
      <p className="px-1 text-[13px] text-text-muted">
        Detectado automaticamente a partir dos ajustes de estoque sincronizados da Omie. A Omie não informa quem fez
        o lançamento — responsável aparece como &quot;Não identificado&quot;.
      </p>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        {itens.slice(0, 20).map((it: AjusteOmieDetectado) => (
          <li key={it.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[14px]">
            <span className="num whitespace-nowrap text-text-muted">{fmtData(it.data)}</span>
            <span className="text-text">
              {it.localOrigemNome}
              {it.localDestinoNome ? ` → ${it.localDestinoNome}` : ''}
            </span>
            <span className="num text-[13px] text-text-muted">{it.qtdProdutos} produto(s)</span>
            <span className="ml-auto text-[13px] text-text-muted">Responsável: Não identificado</span>
          </li>
        ))}
      </ul>
      {itens.length > 20 && <p className="px-1 text-[12px] text-text-muted">Mostrando os 20 mais recentes de {itens.length}.</p>}
    </section>
  )
}
