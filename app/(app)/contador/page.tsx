import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BookOpenCheck, Download, FileSpreadsheet, FileText } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { mesesDaTela, rotuloMes } from '@/lib/estoque/periodo-fechado-puro'
import { lerParamsPacote } from '@/lib/contador/params-puro'
import { carregarLivroEntradas } from '@/lib/contador/livro-entradas-loader'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { FechamentoMeses, type MesTela } from '@/components/contador/FechamentoMeses'

// Fase F: tela do contador. Fechamento do mês (trava de lançamentos) e pacote do contador (XMLs das notas de entrada,
// livro de entradas e inventário tipo Bloco H). Só leitura do banco: nada aqui fala com o Omie nem com a SEFAZ.

type Sp = Record<string, string | undefined>
const campo = 'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-2.5 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-brand/40'
const rotulo = 'mb-1 block text-[11px] font-medium text-text-muted'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default async function ContadorPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  const [podeFechar, podeReabrir, podePacote] = await Promise.all([
    requirePermissao(lojaId, 'Fechamento - Fechar mes'), requirePermissao(lojaId, 'Fechamento - Reabrir mes'), requirePermissao(lojaId, 'Contador - Pacote'),
  ])
  if (!podeFechar && !podeReabrir && !podePacote) notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const modo = await modoDaLoja(lojaId)
  const sb = await createClient()

  const [{ data: fechados, error: eFech }, { data: eventos }] = await Promise.all([
    sb.from('estoque_periodo_fechado').select('mes, fechado_em, fechado_por_nome, obs').eq('loja_id', lojaId),
    sb.from('estoque_periodo_eventos').select('id, mes, acao, user_nome, motivo, created_at').eq('loja_id', lojaId).order('id', { ascending: false }).limit(20),
  ])
  const porMes = new Map((fechados ?? []).map((f) => [String(f.mes).slice(0, 7), f]))
  const lista = mesesDaTela(hoje, 12)
  // mês fechado mais antigo que a janela da tela também aparece (para poder reabrir)
  for (const m of porMes.keys()) if (!lista.includes(m)) lista.push(m)
  lista.sort().reverse()
  const meses: MesTela[] = lista.map((m) => {
    const f = porMes.get(m)
    return { mes: m, fechado: f ? { em: f.fechado_em as string, por: (f.fechado_por_nome as string | null) ?? null, obs: (f.obs as string | null) ?? null } : null }
  })

  const params = lerParamsPacote({ mes: sp.mes, data: sp.data }, hoje)
  const escolhido = 'error' in params ? lerParamsPacote({}, hoje) as { mes: string; data: string } : params
  const livro = podePacote ? await carregarLivroEntradas(lojaId, escolhido.mes) : null
  const q = `mes=${escolhido.mes}&data=${escolhido.data}`

  return (
    <div className="space-y-6">
      <PageHeader title="Contador e fechamento" icon={BookOpenCheck}
        description="Feche o mês para travar os lançamentos com data nele e baixe o pacote do contador." />

      {podePacote && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-text">Pacote do contador</h2>
          {'error' in params && sp.mes && <p className="rounded-[var(--r-lg)] bg-warn/10 px-4 py-3 text-[13px] text-text">{params.error} Mostrando {rotuloMes(escolhido.mes)}.</p>}
          <form method="get" className="grid grid-cols-1 items-end gap-3 rounded-[var(--r-lg)] bg-surface p-3 shadow-[var(--shadow-sm)] sm:grid-cols-[1fr_1fr_auto]">
            <div><label className={rotulo} htmlFor="c-mes">Mês das notas de entrada</label>
              <select id="c-mes" name="mes" defaultValue={escolhido.mes} className={campo}>
                {mesesDaTela(hoje, 24).map((m) => <option key={m} value={m}>{cap(rotuloMes(m))}{porMes.has(m) ? ' (fechado)' : ''}</option>)}
              </select></div>
            <div><label className={rotulo} htmlFor="c-data">Inventário (Bloco H) em</label>
              <input id="c-data" type="date" name="data" defaultValue={escolhido.data} max={hoje} className={campo} /></div>
            <button type="submit" className={btnClass('outline')}>Ver</button>
          </form>
          {livro && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card titulo="Notas de entrada" valor={livro.total.notas.toLocaleString('pt-BR')} sub={`entrada em ${rotuloMes(escolhido.mes)}`} />
              <Card titulo="Valor contábil" valor={<Money value={livro.total.valorContabil} />} />
              <Card titulo="ICMS" valor={<Money value={livro.total.icms} />} />
              <Card titulo="IPI + ICMS-ST" valor={<Money value={livro.total.ipi + livro.total.icmsSt} />} />
            </div>
          )}
          {livro?.erros.length ? <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">Falha ao ler {livro.erros.join(', ')}: o livro pode estar incompleto.</p> : null}
          {!porMes.has(escolhido.mes) && <p className="text-[13px] text-text-muted">Este mês ainda está aberto: o pacote pode mudar se alguém lançar algo com data nele. Feche o mês antes de mandar ao contador.</p>}
          <div className="flex flex-wrap gap-2">
            <a href={`/contador/pacote?${q}`} className={btnClass('primary')}><Download className="size-4" /> Baixar pacote (ZIP)</a>
            <a href={`/contador/livro?mes=${escolhido.mes}`} className={btnClass('outline')}><FileSpreadsheet className="size-4" /> Livro de entradas (Excel)</a>
            <a href={`/contador/livro?mes=${escolhido.mes}&formato=pdf`} target="_blank" rel="noopener" className={btnClass('outline')}><FileText className="size-4" /> Livro de entradas (PDF)</a>
            <a href={`/contador/bloco-h?${q}`} className={btnClass('outline')}><FileSpreadsheet className="size-4" /> Inventário Bloco H (Excel)</a>
          </div>
          <p className="text-[12px] text-text-muted">
            O ZIP leva os XMLs das notas de entrada guardados no Norte Estoque{modo === 'omie' ? ' (loja ligada ao Omie: os XMLs ficam no Omie, o LEIA-ME lista as chaves)' : ''},
            o livro de entradas (uma linha por nota e CFOP, pela data de entrada) e o inventário tipo Bloco H na data escolhida
            {modo === 'omie' ? ' (loja Omie: a foto de posição mais recente até a data)' : ' (pelo estoque, exato na data)'}.
            {' '}Detalhe da posição em <Link href="/relatorio-posicao-estoque?ver=sped" className="text-brand hover:underline">Posição de estoque</Link>.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-text">Fechamento do mês</h2>
        {eFech ? (
          <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">O fechamento de mês ainda não foi ativado nesta instalação.</p>
        ) : (
          <FechamentoMeses meses={meses} podeFechar={podeFechar} podeReabrir={podeReabrir} />
        )}
        {(eventos ?? []).length > 0 && (
          <details className="rounded-[var(--r-lg)] bg-surface p-3 text-[13px] shadow-[var(--shadow-sm)]">
            <summary className="cursor-pointer font-medium text-text">Histórico de fechamentos</summary>
            <ul className="mt-2 space-y-1 text-text-muted">
              {(eventos ?? []).map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at as string).toLocaleString('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                  {e.acao === 'fechar' ? 'fechou' : 'reabriu'} {rotuloMes(String(e.mes).slice(0, 7))}{e.user_nome ? ` · ${e.user_nome}` : ''}{e.motivo ? ` · ${e.motivo}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}
