import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { EstoqueAtalhos } from '@/components/estoque-proprio/EstoqueAtalhos'
import { carregarSaude, type SecaoSaude } from '../dados-saude'

const LIMITE_POR_SECAO = 30

function Secao({ s }: { s: SecaoSaude }) {
  const n = s.itens.length
  return (
    <section id={s.chave} aria-label={s.titulo} className="scroll-mt-20 rounded-[var(--r-lg)] bg-surface p-4 u-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text">{s.titulo}</h2>
          {s.explicacao && !s.naoSeAplica && <p className="mt-0.5 text-[12px] text-text-muted">{s.explicacao}</p>}
        </div>
        {!s.naoSeAplica && (
          <span className={`num shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${n ? 'bg-surface-2 text-err' : 'bg-surface-2 text-ok'}`}>{n}</span>
        )}
      </div>
      {s.naoSeAplica ? (
        <p className="mt-2 text-[13px] text-text-muted">{s.naoSeAplica}</p>
      ) : n === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-text-muted"><CheckCircle2 className="size-4 text-ok" /> Tudo certo</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {s.itens.slice(0, LIMITE_POR_SECAO).map((i) => (
              <li key={i.chave}>
                <Link href={i.href} className="flex items-center gap-3 py-2 text-[13px] hover:bg-surface-2/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">{i.descricao} <span className="num font-normal text-text-muted">· {i.codigo}</span></span>
                    <span className={`block text-[12px] ${i.tom === 'erro' ? 'text-err' : i.tom === 'aviso' ? 'text-warn' : 'text-text-muted'}`}>{i.detalhe}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
          {n > LIMITE_POR_SECAO && <p className="mt-2 text-[12px] text-text-muted">Mostrando {LIMITE_POR_SECAO} de {n}.</p>}
        </>
      )}
    </section>
  )
}

export default async function SaudeEstoquePage() {
  const lojaId = await getCurrentLojaId()
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()

  const { secoes, avisos } = await carregarSaude(lojaId, modo)
  const ativas = secoes.filter((s) => !s.naoSeAplica)

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader title="Saúde do estoque" description={modo === 'omie' ? 'O que está fora do lugar no estoque do Omie, com o caminho para conferir cada item' : 'O que está fora do lugar no estoque, com o caminho para conferir cada item'} />
      </ListaHeader>
      <EstoqueAtalhos atual="saude" />

      {avisos.length > 0 && (
        <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-warn">
          {avisos.map((a) => <p key={a} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {ativas.map((s) => (
          <a key={s.chave} href={`#${s.chave}`} className="block rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <div className={`num text-[24px] font-semibold leading-none tracking-[-0.02em] ${s.itens.length ? (s.itens[0]?.tom === 'erro' ? 'text-err' : 'text-warn') : 'text-text'}`}>{s.itens.length}</div>
            <div className="mt-1.5 text-[13px] font-medium text-text">{s.titulo}</div>
          </a>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {secoes.map((s) => <Secao key={s.chave} s={s} />)}
      </div>
    </div>
  )
}
