import Link from 'next/link'
import { ArrowRight, AlertTriangle, Printer, ClipboardCheck, Boxes } from 'lucide-react'

// Variante C — Centro de operações. Dados de exemplo.
// Saúde de sync por loja: cada pilar = produtos / locais / notas / ordens
type Pilar = 'ok' | 'erro' | 'sync'
const LOJAS: { nome: string; cnpj: string; pilares: Pilar[]; quando: string }[] = [
  { nome: 'Donana Vilas do Atlântico', cnpj: '12.781.367/0001-79', pilares: ['ok', 'ok', 'ok', 'ok'], quando: '8 min' },
  { nome: 'Donana Rio Vermelho', cnpj: '42.200.741/0002-47', pilares: ['ok', 'ok', 'ok', 'erro'], quando: '8 min' },
  { nome: 'O Sertão Vai Virar Mar', cnpj: '39.912.717/0001-45', pilares: ['ok', 'ok', 'ok', 'ok'], quando: '12 min' },
  { nome: 'Donana Pituba', cnpj: '50.118.402/0001-30', pilares: ['ok', 'sync', 'ok', 'ok'], quando: 'agora' },
  { nome: 'Donana Itaigara', cnpj: '55.402.119/0001-08', pilares: ['ok', 'ok', 'ok', 'ok'], quando: '15 min' },
  { nome: 'Donana Stiep', cnpj: '61.770.233/0001-92', pilares: ['ok', 'ok', 'ok', 'ok'], quando: '9 min' },
]

const PILAR_LABEL = ['Produtos', 'Locais', 'Notas', 'Ordens']
const COR: Record<Pilar, string> = { ok: '#2eb5c3', erro: '#ef4444', sync: '#f59e0b' }

const ATENCAO = [
  { icon: AlertTriangle, tom: '#ef4444', texto: 'Falha na sincronização de Ordens de Produção', alvo: 'Donana Rio Vermelho', cta: 'Reprocessar', href: '/loja' },
  { icon: Printer, tom: '#f59e0b', texto: '12 notas recebidas hoje ainda sem etiqueta impressa', alvo: 'Donana Pituba', cta: 'Imprimir', href: '/nota-fiscal' },
  { icon: ClipboardCheck, tom: '#2eb5c3', texto: '1 inventário em contagem aguardando finalização', alvo: 'Donana Itaigara', cta: 'Abrir', href: '/inventario' },
]

const NOTAS = [
  { h: '14:22', n: '000939395', f: 'FRUTCOM EXPRESS COM. DE GENEROS ALIMENTICIOS LTDA', loja: 'Rio Vermelho', v: 'R$ 626,10' },
  { h: '13:51', n: '000051569', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', loja: 'Pituba', v: 'R$ 297,01' },
  { h: '11:08', n: '000388265', f: 'FRUVELE PLUS COMERCIO DE GENEROS ALIMENTICIOS LTDA', loja: 'Stiep', v: 'R$ 80,00' },
  { h: '10:30', n: '000048012', f: 'FLIPPER INDUSTRIA E COMERCIO DE GELO LTDA', loja: 'Itaigara', v: 'R$ 72,00' },
  { h: '09:14', n: '000051570', f: 'WMS SUPERMERCADOS DO BRASIL LTDA', loja: 'Pituba', v: 'R$ 308,80' },
]

export default function PreviewC() {
  const comErro = LOJAS.filter((l) => l.pilares.includes('erro')).length
  const sincronizando = LOJAS.filter((l) => l.pilares.includes('sync')).length
  const ok = LOJAS.length - comErro - sincronizando

  return (
    <div className="-mx-4 lg:-mx-8 -my-6 min-h-screen">
      {/* Faixa de comando */}
      <div className="border-b border-border bg-surface px-4 lg:px-8 py-5 flex items-baseline justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-bold uppercase tracking-[0.18em] text-text">Operação</h1>
          <span className="num text-[13px] text-text-muted">qua 13 jun · 14:30</span>
        </div>
        <div className="flex items-center gap-4 num text-[13px]">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: '#2eb5c3' }} />{ok} ok</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: '#f59e0b' }} />{sincronizando} sincronizando</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: '#ef4444' }} />{comErro} com erro</span>
        </div>
      </div>

      {/* Grid de saúde das 6 lojas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 border-b border-border">
        {LOJAS.map((l, idx) => {
          const temErro = l.pilares.includes('erro')
          return (
            <div key={l.cnpj} className={`relative px-4 lg:px-6 py-4 border-border ${idx % 3 !== 0 ? 'xl:border-l' : ''} ${idx % 2 !== 0 ? 'sm:border-l xl:border-l' : ''} ${idx >= 1 ? 'border-t sm:border-t' : ''} ${idx >= 2 ? 'xl:border-t-0' : ''}`}>
              {temErro && <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: '#ef4444' }} />}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text truncate">{l.nome}</div>
                  <div className="num text-[11px] text-text-muted">{l.cnpj}</div>
                </div>
                <span className="num text-[11px] text-text-muted whitespace-nowrap shrink-0">{l.quando}</span>
              </div>
              {/* 4 pilares de sync */}
              <div className="mt-3 grid grid-cols-4 gap-1.5">
                {l.pilares.map((p, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="h-1 rounded-full" style={{ background: COR[p] }} />
                    <span className="text-[9px] uppercase tracking-wide text-text-muted">{PILAR_LABEL[i]}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-4 lg:px-8 py-7 space-y-9">
        {/* Precisa de atenção — a fila de trabalho */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted mb-3">Precisa de atenção</h2>
          <div className="space-y-2">
            {ATENCAO.map((a, i) => (
              <Link key={i} href={a.href}
                className="group flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3 transition-all duration-200 hover:border-text/20 hover:shadow-[var(--shadow-sm)]"
                style={{ transitionTimingFunction: 'var(--ease)' }}>
                <span className="flex size-8 items-center justify-center rounded-md shrink-0" style={{ background: `${a.tom}1a`, color: a.tom }}>
                  <a.icon className="size-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text">{a.texto}</div>
                  <div className="num text-[11px] text-text-muted">{a.alvo}</div>
                </div>
                <span className="flex items-center gap-1 text-[13px] font-medium text-text-muted group-hover:text-brand transition-colors shrink-0">
                  {a.cta}<ArrowRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Atividade — chegadas recentes, densa estilo terminal */}
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Chegadas recentes</h2>
            <Link href="/nota-fiscal" className="text-[12px] text-text-muted hover:text-brand transition-colors">histórico completo</Link>
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              {NOTAS.map((nf) => (
                <tr key={nf.n} className="border-b border-border/70 last:border-0 hover:bg-surface-2/40 transition-colors">
                  <td className="py-2.5 pr-3 num text-text-muted w-14">{nf.h}</td>
                  <td className="py-2.5 pr-4 num text-text w-28">{nf.n}</td>
                  <td className="py-2.5 pr-4 text-text/85 truncate max-w-0 w-full">{nf.f}</td>
                  <td className="py-2.5 pr-4 text-[11px] uppercase tracking-wide text-text-muted whitespace-nowrap">{nf.loja}</td>
                  <td className="py-2.5 text-right num font-medium text-text whitespace-nowrap">{nf.v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Âncora discreta — total do estoque, sem alarde */}
        <section className="flex items-center gap-2 text-[13px] text-text-muted border-t border-border pt-4">
          <Boxes className="size-4" strokeWidth={1.75} />
          <span className="num text-text font-medium">2.272</span> produtos ativos em 6 unidades
          <Link href="/produto" className="ml-auto text-text-muted hover:text-brand transition-colors">ver catálogo →</Link>
        </section>
      </div>
    </div>
  )
}
