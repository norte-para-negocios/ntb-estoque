import Link from 'next/link'
import { ArrowUpRight, ArrowRight, ClipboardList, ArrowLeftRight, FileText } from 'lucide-react'

// Variante A — Linear monocromático disciplinado. Dados de exemplo.
const KPIS = [
  { label: 'Produtos', value: '2.272', hint: 'cadastrados', href: '/produto', primary: true },
  { label: 'Notas fiscais', value: '57', hint: 'últimos 30 dias', href: '/nota-fiscal' },
  { label: 'Ordens de produção', value: '496', hint: 'no total', href: '/ordem-producao' },
  { label: 'Inventários abertos', value: '0', hint: 'em contagem', href: '/inventario' },
]

const NOTAS = [
  { d: '12/06/2026', n: '000939395', f: 'FRUTCOM EXPRESS COM. DE GENEROS ALIMENTICIOS LTDA', v: 'R$ 626,10' },
  { d: '12/06/2026', n: '000051569', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', v: 'R$ 297,01' },
  { d: '12/06/2026', n: '000388265', f: 'FRUVELE PLUS COMERCIO DE GENEROS ALIMENTICIOS LTDA', v: 'R$ 80,00' },
  { d: '12/06/2026', n: '000048012', f: 'FLIPPER INDUSTRIA E COMERCIO DE GELO LTDA', v: 'R$ 72,00' },
  { d: '12/06/2026', n: '000051570', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', v: 'R$ 308,80' },
]

const ATALHOS = [
  { label: 'Novo inventário', href: '/inventario', icon: ClipboardList },
  { label: 'Nova transferência', href: '/transferencia', icon: ArrowLeftRight },
  { label: 'Etiquetas de NF', href: '/nota-fiscal', icon: FileText },
]

export default function PreviewA() {
  return (
    <div className="-mx-4 lg:-mx-8 -my-6">
      {/* Cabeçalho com régua */}
      <header className="border-b border-border px-4 lg:px-8 pt-8 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Donana Rio Vermelho</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold tracking-tight text-text">Visão geral</h1>
        <p className="mt-0.5 text-[13px] text-text-muted num">Sincronizado 12/06/2026 às 21:53</p>
      </header>

      {/* KPIs — sem cor, número manda, divisores finos */}
      <section className="grid grid-cols-2 lg:grid-cols-4 border-b border-border">
        {KPIS.map((k, i) => (
          <Link
            key={k.label}
            href={k.href}
            className={`group relative px-4 lg:px-8 py-7 transition-colors hover:bg-surface-2/50 ${i !== 0 ? 'border-l border-border' : ''} ${i === 2 ? 'border-l' : ''} max-lg:[&:nth-child(3)]:border-t lg:[&]:border-t-0 max-lg:[&:nth-child(4)]:border-t`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{k.label}</span>
              <ArrowUpRight className="size-3.5 text-transparent transition-colors group-hover:text-text-muted" strokeWidth={2} />
            </div>
            <div className={`mt-3 text-[2.6rem] leading-none font-semibold tracking-tight num ${k.primary ? 'text-brand' : 'text-text'}`}>
              {k.value}
            </div>
            <div className="mt-2 text-[12px] text-text-muted">{k.hint}</div>
          </Link>
        ))}
      </section>

      <div className="px-4 lg:px-8 py-8 space-y-10">
        {/* Atalhos como linha de texto, não cards coloridos */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted mb-1">Ações</h2>
          <div className="divide-y divide-border border-y border-border">
            {ATALHOS.map((a) => (
              <Link key={a.href} href={a.href} className="group flex items-center gap-3 py-3.5 transition-colors hover:text-brand">
                <a.icon className="size-4 text-text-muted group-hover:text-brand transition-colors" strokeWidth={1.75} />
                <span className="text-[15px] text-text group-hover:text-brand transition-colors">{a.label}</span>
                <ArrowRight className="ml-auto size-4 text-text-muted/40 group-hover:text-brand group-hover:translate-x-0.5 transition-all" strokeWidth={1.75} />
              </Link>
            ))}
          </div>
        </section>

        {/* Últimas notas — tabela minimalista */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">Últimas notas fiscais</h2>
            <Link href="/nota-fiscal" className="text-[13px] text-text-muted hover:text-brand transition-colors">ver todas</Link>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {NOTAS.map((nf) => (
                <tr key={nf.n} className="group border-b border-border last:border-0 hover:bg-surface-2/40 transition-colors">
                  <td className="py-3 pr-4 num text-text-muted w-28">{nf.d}</td>
                  <td className="py-3 pr-4 num text-text w-28">{nf.n}</td>
                  <td className="py-3 pr-4 text-text/90 truncate max-w-0 w-full">{nf.f}</td>
                  <td className="py-3 pl-4 text-right num font-medium text-text whitespace-nowrap">{nf.v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
