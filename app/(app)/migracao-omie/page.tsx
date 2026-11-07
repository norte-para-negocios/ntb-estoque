import { Rocket } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { exigirDev } from '@/lib/recursos-dev'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
import { avaliarProntidao, type Estado, type Prontidao } from '@/lib/migracao/prontidao-puro'

// Fase 10: o quanto cada loja Omie está pronta para sair do Omie e ir para o Norte ERP. Só leitura (RPC prontidao_migracao,
// migration 470, sobre os espelhos do Omie). Só desenvolvedor. O Sertão (loja 4) nunca aparece.
export const dynamic = 'force-dynamic'

const COR: Record<Estado, string> = { ok: 'bg-ok', atencao: 'bg-warn', bloqueia: 'bg-err' }
const ROTULO: Record<Estado, string> = { ok: 'Pronto', atencao: 'Atenção', bloqueia: 'Impede a virada' }
const num = (x: unknown) => Number(x ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

type Pior = { produto: string; local: number; saldo?: number; valor?: number; cmc?: number; posicao?: number; kardex?: number; ultimo_mov?: string }

function Tabela({ titulo, linhas, colunas }: { titulo: string; linhas: Pior[]; colunas: [string, (p: Pior) => string][] }) {
  if (!linhas.length) return null
  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <h2 className="mb-2 text-[15px] font-semibold text-text">{titulo}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-text-muted"><th className="py-1 pr-3">Produto</th><th className="py-1 pr-3">Local</th>{colunas.map(([c]) => <th key={c} className="py-1 pr-3 text-right">{c}</th>)}</tr></thead>
          <tbody>
            {linhas.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1 pr-3 text-text">{p.produto}</td>
                <td className="num py-1 pr-3 text-text-muted">{p.local}</td>
                {colunas.map(([c, f]) => <td key={c} className="num py-1 pr-3 text-right">{f(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function MigracaoOmiePage({ searchParams }: { searchParams: Promise<{ loja?: string }> }) {
  await exigirDev()
  const sb = createServiceClient()
  const { data: lojas } = await sb.from('lojas').select('id, nome').eq('ativo', true).eq('is_test', false).eq('modo_estoque', 'omie').neq('id', 4).order('id')
  const lista = (lojas ?? []) as { id: number; nome: string }[]
  const sp = await searchParams
  const lojaId = lista.find((l) => String(l.id) === sp.loja)?.id ?? lista[0]?.id
  const { data, error } = lojaId ? await sb.rpc('prontidao_migracao', { p_loja: lojaId }) : { data: null, error: null }
  const p = data as (Prontidao & { piores: { negativos: Pior[]; custo_absurdo: Pior[]; diferem: Pior[] } }) | null
  const av = p ? avaliarProntidao(p, hojeBahiaISO()) : null

  return (
    <div className="space-y-4">
      <PageHeader title="Prontidão para sair do Omie" icon={Rocket}
        description="O que o Norte ERP já tem de cada loja e o que ainda impede a troca. Só leitura: nada é gravado no Omie." />
      <SegmentLinks basePath="/migracao-omie" param="loja" aria-label="Loja"
        opcoes={lista.map((l, i) => ({ value: i === 0 ? '' : String(l.id), label: `${l.id} · ${l.nome}` }))} />
      {error && <p className="rounded-[var(--r-md)] bg-warn/10 px-3 py-2 text-[13px] text-text">Não foi possível medir agora: {error.message}</p>}
      {av && p && (
        <>
          <p className="text-[14px] text-text">
            {av.pronta ? 'Nada impede a troca.' : `${av.resumo.bloqueia} item(ns) impedem a troca`} · {av.resumo.atencao} pedem atenção · {av.resumo.ok} prontos
          </p>
          <ol className="space-y-2">
            {av.itens.map((i) => (
              <li key={i.chave} className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className={`inline-block size-2.5 rounded-full ${COR[i.estado]}`} />
                  <span className="text-[15px] font-medium text-text">{i.titulo}</span>
                  <span className="text-[12px] text-text-muted">{ROTULO[i.estado]}</span>
                </div>
                <p className="mt-1 text-[13px] text-text-muted">{i.detalhe}</p>
                {i.acao && <p className="mt-1 text-[13px] text-text">{i.acao}</p>}
              </li>
            ))}
          </ol>
          <Tabela titulo="Maiores negativos" linhas={p.piores.negativos} colunas={[['Saldo', (x) => num(x.saldo)], ['Valor', (x) => num(x.valor)]]} />
          <Tabela titulo="Custos absurdos (≥ R$ 1.000)" linhas={p.piores.custo_absurdo} colunas={[['Saldo', (x) => num(x.saldo)], ['Custo médio', (x) => num(x.cmc)]]} />
          <Tabela titulo="Posição que não bate com o kardex" linhas={p.piores.diferem}
            colunas={[['Posição', (x) => num(x.posicao)], ['Fim do kardex', (x) => num(x.kardex)], ['Último movimento', (x) => (x.ultimo_mov ?? '').split('-').reverse().join('/')]]} />
        </>
      )}
    </div>
  )
}
