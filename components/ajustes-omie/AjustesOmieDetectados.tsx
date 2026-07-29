import { carregarAjustesOmieDetectados, type AjusteOmieDetectado } from '@/lib/ajustes-omie'

function fmtData(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

export async function AjustesOmieDetectados({ lojaId, tipo }: { lojaId: number; tipo: 'TRF' | 'SLD' }) {
  let itens: AjusteOmieDetectado[] = []
  try {
    itens = await carregarAjustesOmieDetectados(lojaId, tipo, '2025-07-01', new Date().toISOString().slice(0, 10))
    console.log(`[DEBUG AjustesOmieDetectados] lojaId=${lojaId} tipo=${tipo} -> ${itens.length} itens`)
  } catch (e) {
    console.error(`[DEBUG AjustesOmieDetectados] ERRO lojaId=${lojaId} tipo=${tipo}:`, e)
  }
  if (itens.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Feito direto na Omie ({itens.length})</h2>
      </div>
      <p className="text-[12px] text-text-muted">
        Detectado automaticamente a partir dos ajustes de estoque sincronizados da Omie. A Omie não informa quem fez
        o lançamento — responsável aparece como &quot;Não identificado&quot;.
      </p>
      <ul className="divide-y divide-border">
        {itens.slice(0, 20).map((it: AjusteOmieDetectado) => (
          <li key={it.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="num text-text-muted">{fmtData(it.data)}</span>
            <span className="text-text">
              {it.localOrigemNome}
              {it.localDestinoNome ? ` → ${it.localDestinoNome}` : ''}
            </span>
            <span className="text-[12px] text-text-muted">{it.qtdProdutos} produto(s)</span>
            <span className="ml-auto text-[12px] text-text-muted">Responsável: Não identificado</span>
          </li>
        ))}
      </ul>
      {itens.length > 20 && <p className="text-[11px] text-text-muted">Mostrando os 20 mais recentes de {itens.length}.</p>}
    </section>
  )
}
