import Link from 'next/link'
import { ArrowRight, ClipboardList, ArrowLeftRight, FileText, TrendingUp } from 'lucide-react'

// Variante B — Editorial industrial. Dados de exemplo.
const SECUNDARIOS = [
  { label: 'Notas fiscais', value: '57', hint: '30 dias', href: '/nota-fiscal' },
  { label: 'Ordens de produção', value: '496', hint: 'total', href: '/ordem-producao' },
  { label: 'Inventários', value: '0', hint: 'abertos', href: '/inventario' },
]

const NOTAS = [
  { d: '12/06', n: '000939395', f: 'FRUTCOM EXPRESS COM. DE GENEROS ALIMENTICIOS', v: 'R$ 626,10' },
  { d: '12/06', n: '000051569', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', v: 'R$ 297,01' },
  { d: '12/06', n: '000388265', f: 'FRUVELE PLUS COMERCIO DE GENEROS ALIMENTICIOS', v: 'R$ 80,00' },
  { d: '12/06', n: '000048012', f: 'FLIPPER INDUSTRIA E COMERCIO DE GELO LTDA', v: 'R$ 72,00' },
  { d: '12/06', n: '000051570', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', v: 'R$ 308,80' },
]

const ATALHOS = [
  { label: 'Novo inventário', desc: 'Contagem de estoque', href: '/inventario', icon: ClipboardList },
  { label: 'Nova transferência', desc: 'Entre locais', href: '/transferencia', icon: ArrowLeftRight },
  { label: 'Etiquetas de NF', desc: 'Imprimir', href: '/nota-fiscal', icon: FileText },
]

export default function PreviewB() {
  return (
    <div className="space-y-9">
      {/* Hero: bloco escuro com número gigante + barra teal */}
      <section className="relative overflow-hidden rounded-2xl bg-[#10151c] text-white p-7 lg:p-9">
        {/* grão sutil + glow teal */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.5]" style={{ background: 'radial-gradient(120% 80% at 85% -20%, rgba(46,181,195,0.18), transparent 60%)' }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
            <span className="inline-block size-1.5 rounded-full bg-brand" />
            Donana Rio Vermelho
          </div>
          <div className="mt-6 flex items-end justify-between gap-6 flex-wrap">
            <div>
              <p className="text-[12px] uppercase tracking-[0.16em] text-white/45 mb-2">Produtos em estoque</p>
              <div className="num text-[4.5rem] leading-[0.85] font-bold tracking-tight">2.272</div>
              <div className="mt-4 h-1 w-24 rounded-full bg-brand" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/5 ring-1 ring-white/10 px-3 py-1.5 text-[12px] text-white/70">
              <TrendingUp className="size-3.5 text-brand" /> sync 21:53
            </div>
          </div>
        </div>
      </section>

      {/* 3 secundários, blocos com régua teal lateral */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {SECUNDARIOS.map((k) => (
          <Link key={k.label} href={k.href}
            className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 transition-all duration-300 hover:border-brand/40"
            style={{ transitionTimingFunction: 'var(--ease)' }}>
            <span className="absolute left-0 top-0 h-full w-1 bg-brand/0 group-hover:bg-brand transition-colors duration-300" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{k.label}</p>
            <div className="mt-3 flex items-end gap-2">
              <span className="num text-[2.4rem] leading-none font-bold tracking-tight text-text">{k.value}</span>
              <span className="mb-1 text-[12px] text-text-muted">{k.hint}</span>
            </div>
          </Link>
        ))}
      </section>

      {/* Atalhos: chips com seta */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Ações rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {ATALHOS.map((a) => (
            <Link key={a.href} href={a.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-4 transition-all duration-300 hover:bg-[#10151c] hover:border-[#10151c]"
              style={{ transitionTimingFunction: 'var(--ease)' }}>
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white transition-colors shrink-0">
                <a.icon className="size-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text group-hover:text-white transition-colors">{a.label}</div>
                <div className="text-[11px] text-text-muted group-hover:text-white/50 transition-colors truncate">{a.desc}</div>
              </div>
              <ArrowRight className="size-4 text-text-muted/30 group-hover:text-brand group-hover:translate-x-1 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      </section>

      {/* Últimas notas — header de seção forte */}
      <section>
        <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
          <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Últimas notas fiscais</h2>
          <Link href="/nota-fiscal" className="text-[13px] text-brand hover:underline">ver todas →</Link>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {NOTAS.map((nf) => (
              <tr key={nf.n} className="border-b border-border last:border-0 hover:bg-surface-2/50 transition-colors">
                <td className="py-3 pr-3 num text-text-muted w-16">{nf.d}</td>
                <td className="py-3 pr-4 num font-medium text-text w-28">{nf.n}</td>
                <td className="py-3 pr-4 text-text/80 truncate max-w-0 w-full">{nf.f}</td>
                <td className="py-3 text-right num font-semibold text-text whitespace-nowrap">{nf.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
