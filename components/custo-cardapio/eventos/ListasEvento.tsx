import Link from 'next/link'
import { AlertTriangle, ClipboardList, FileText, ShoppingCart } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import { formatarData, porFamilia, quantidadeTexto, type LinhaCompra } from '@/lib/custo-cardapio/eventos-puro'
import type { ListasEvento as Listas } from '@/lib/custo-cardapio/eventos'
import { brl } from '@/lib/custo-cardapio/formato'
import { CopiarWhatsApp } from './CopiarWhatsApp'

// Lista de produção (preparações somadas entre os pratos) e de compras (insumos menos o saldo), do evento salvo.
export function ListasEvento({ eventoId, listas, texto, modo }: { eventoId: number; listas: Listas; texto: string; modo: 'omie' | 'proprio' }) {
  const comprar = listas.compras.filter((c) => c.faltaComprar > 0)
  const totalCompra = comprar.reduce((a, c) => a + c.custoCompra, 0)
  const totalConsumo = listas.compras.reduce((a, c) => a + c.bruta * (c.custoUnitario ?? 0), 0)
  const grupos = porFamilia(listas.compras)
  const vazio = listas.pratos.length === 0
  const dataSaldo = listas.dataSaldo ? listas.dataSaldo.split('-').reverse().join('/') : null
  const folga = listas.folgaPct > 0 ? ` com folga de ${listas.folgaPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : ''
  const conflitos = listas.compras.filter((c) => c.situacao === 'conflito')
  const reservaAlguma = listas.compras.some((c) => c.reservadoOutros > 0)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-bold tracking-[-0.01em]">Produção e compras</h2>
          <p className="text-[13px] text-text-muted">Pela ficha técnica, para os convidados salvos{folga}. Saldo {modo === 'omie' ? `do Omie${dataSaldo ? ` em ${dataSaldo}` : ''}` : 'atual do estoque'}, menos o que outros eventos confirmados já reservaram.</p>
        </div>
        {!vazio && (
          <div className="flex flex-wrap gap-2">
            <CopiarWhatsApp texto={texto} />
            <a href={`/cozinha/eventos/${eventoId}/pdf`} className={btnClass('outline')}><FileText className="size-4" /> PDF</a>
          </div>
        )}
      </div>

      {listas.semFicha.length > 0 && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">Sem ficha técnica, fora das listas: {listas.semFicha.join(', ')}.</p>}
      {listas.ciclo && <p className="rounded-[var(--r-md)] bg-err/10 px-3 py-2 text-[13px] text-err">Alguma ficha tem ciclo (uma preparação usa a si mesma). Confira as quantidades.</p>}
      {conflitos.length > 0 && (
        <div className="rounded-[var(--r-md)] bg-err/10 px-3 py-2 text-[13px] text-err">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-4 shrink-0" /> {conflitos.length} insumo{conflitos.length > 1 ? 's' : ''} disputado{conflitos.length > 1 ? 's' : ''} com outros eventos</p>
          <ul className="mt-1 space-y-0.5">
            {conflitos.map((c) => (
              <li key={c.codigo}>
                {c.descricao}: precisa <span className="num">{quantidadeTexto(c.bruta, c.unidade)}</span>, sobram <span className="num">{quantidadeTexto(Math.max(c.disponivel ?? 0, 0), c.unidade)}</span> depois de{' '}
                {c.concorrentes.map((o, i) => (
                  <span key={o.eventoId}>{i > 0 ? ', ' : ''}<Link href={`/cozinha/eventos/${o.eventoId}`} className="underline underline-offset-2">{o.nome}</Link> ({formatarData(o.data)}, <span className="num">{quantidadeTexto(o.quantidade, c.unidade)}</span>)</span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {listas.unidadeDiferente > 0 && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-warn">{listas.unidadeDiferente} insumo{listas.unidadeDiferente > 1 ? 's' : ''} com unidade na ficha diferente da do estoque: o saldo não foi descontado.</p>}

      {vazio ? (
        <p className="rounded-[var(--r-lg)] bg-surface px-5 py-8 text-center text-[13px] text-text-muted shadow-[var(--shadow-sm)]">Adicione pratos ao evento para montar as listas.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div id="producao" className="scroll-mt-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold"><ClipboardList className="size-4 text-text-muted" /> Lista de produção</h3>
            <p className="mb-3 text-[12px] text-text-muted">Preparações somadas entre todos os pratos{folga}. Porções dos pratos sem a folga.</p>
            <ul className="divide-y divide-border/60 text-[14px]">
              {listas.pratos.map((p) => (
                <li key={`p${p.codigo}`} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-medium">{p.descricao}</span>
                  <span className="num shrink-0">{p.porcoes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} porç{p.porcoes === 1 ? 'ão' : 'ões'}</span>
                </li>
              ))}
              {listas.producao.map((p) => (
                <li key={`r${p.codigo}`} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{p.descricao}</span>
                    {p.emEstoque != null && p.emEstoque > 0 && <span className="block text-[12px] text-text-muted">em estoque: <span className="num">{quantidadeTexto(p.emEstoque, p.unidade)}</span></span>}
                  </span>
                  <span className="num shrink-0">{quantidadeTexto(p.quantidade, p.unidade)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div id="compras" className="scroll-mt-4 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold"><ShoppingCart className="size-4 text-text-muted" /> Lista de compras</h3>
              <p className="text-[13px] text-text-muted">comprar <span className="num font-semibold text-text">{brl(totalCompra)}</span> · consumo <span className="num">{brl(totalConsumo)}</span></p>
            </div>
            <p className="mb-3 text-[12px] text-text-muted">Precisa = quantidade bruta (com perda{folga}). Disponível = em estoque − reservado por outros eventos. Custo pelo custo médio atual.</p>
            {comprar.length === 0 && <p className="mb-3 rounded-[var(--r-md)] bg-ok/10 px-3 py-2 text-[13px] text-ok">Tudo o que o evento precisa já está em estoque.</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="text-left text-text-muted [&_th]:pb-2 [&_th]:font-semibold">
                    <th>Insumo</th><th className="text-right">Precisa</th><th className="text-right">Em estoque</th>
                    {reservaAlguma && <th className="text-right">Outros eventos</th>}
                    <th className="text-right">Disponível</th><th className="text-right">Comprar</th><th className="text-right">Custo</th>
                  </tr>
                </thead>
                {grupos.map((g) => (
                  <tbody key={g.familia}>
                    <tr><td colSpan={reservaAlguma ? 7 : 6} className="pb-1 pt-3 text-[12px] font-semibold text-text-muted">{g.familia}</td></tr>
                    {g.linhas.map((c: LinhaCompra) => (
                      <tr key={c.codigo} className="border-t border-border/60 [&_td]:py-1.5">
                        <td className="max-w-[240px] pr-3">
                          <span className="block truncate">{c.descricao}{c.semCusto && <span className="text-warn"> · sem custo</span>}</span>
                          {c.situacao === 'conflito' && <span className="block truncate text-[11px] font-semibold text-err">disputado com {c.concorrentes.map((o) => o.nome).join(', ')}</span>}
                        </td>
                        <td className="num whitespace-nowrap text-right">{quantidadeTexto(c.bruta, c.unidade)}</td>
                        <td className="num whitespace-nowrap text-right text-text-muted">{c.emEstoque == null ? 'conferir' : quantidadeTexto(c.emEstoque, c.unidade)}</td>
                        {reservaAlguma && (
                          <td className="num whitespace-nowrap text-right text-text-muted" title={c.concorrentes.map((o) => `${o.nome} (${formatarData(o.data)})`).join(', ')}>
                            {c.reservadoOutros > 0 ? `− ${quantidadeTexto(c.reservadoOutros, c.unidade)}` : ''}
                          </td>
                        )}
                        <td className={`num whitespace-nowrap text-right ${c.disponivel != null && c.disponivel < c.bruta ? 'text-err' : 'text-text-muted'}`}>
                          {c.disponivel == null ? '—' : c.disponivel < 0 ? `− ${quantidadeTexto(-c.disponivel, c.unidade)}` : quantidadeTexto(c.disponivel, c.unidade)}
                        </td>
                        <td className={`num whitespace-nowrap text-right ${c.faltaComprar > 0 ? 'font-semibold' : 'text-ok'}`}>{c.faltaComprar > 0 ? quantidadeTexto(c.faltaComprar, c.unidade) : 'coberto'}</td>
                        <td className="num whitespace-nowrap text-right">{c.faltaComprar > 0 ? (c.semCusto ? '—' : brl(c.custoCompra)) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
