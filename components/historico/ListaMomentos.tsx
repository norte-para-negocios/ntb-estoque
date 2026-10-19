import type { MomentoHistorico, TipoItem } from '@/lib/historico/historico-puro'

const TIPO_LABEL: Record<TipoItem, string> = {
  criou: 'Criou',
  alterou: 'Alterou',
  excluiu: 'Excluiu',
  item_incluido: 'Incluiu',
  item_alterado: 'Alterou',
  item_removido: 'Removeu',
}

function fmtQuando(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Linha do tempo: quem, quando e, por item, campo: de → para. */
export function ListaMomentos({ momentos }: { momentos: MomentoHistorico[] }) {
  return (
    <ol className="divide-y divide-border/60">
      {momentos.map((m, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[15px] font-medium text-text">
              {m.autor}
              {m.origem === 'sistema' && <span className="ml-1.5 text-[12px] font-normal text-text-muted">(automático)</span>}
            </span>
            <span className="num shrink-0 text-[13px] text-text-muted">{fmtQuando(m.quando)}</span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {m.itens.map((it, j) => (
              <li key={j} className="text-[13px] text-text">
                <span className="font-medium">{TIPO_LABEL[it.tipo]}</span>
                {it.titulo && <span className="text-text-muted"> · {it.titulo}</span>}
                {it.mudancas.length > 0 && (
                  <dl className="mt-1 grid gap-x-3 gap-y-0.5 pl-3 sm:grid-cols-[minmax(8rem,auto)_1fr]">
                    {it.mudancas.map((x) => (
                      <div key={x.campo} className="contents">
                        <dt className="text-text-muted">{x.rotulo}</dt>
                        <dd className="break-words">
                          {it.tipo === 'item_incluido' || it.tipo === 'criou' ? (
                            <span>{x.para}</span>
                          ) : it.tipo === 'item_removido' || it.tipo === 'excluiu' ? (
                            <span className="text-text-muted line-through">{x.de}</span>
                          ) : (
                            <>
                              <span className="text-text-muted">{x.de}</span>
                              <span aria-hidden className="mx-1.5 text-text-muted">→</span>
                              <span className="sr-only">para</span>
                              <span>{x.para}</span>
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

export function SecaoHistorico({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-[17px] font-semibold text-text">{titulo}</span>
          {descricao && <span className="mt-0.5 block text-[13px] text-text-muted">{descricao}</span>}
        </span>
        <span aria-hidden className="text-[13px] text-text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
