import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { rotuloSituacaoDevolucao } from '@/lib/compras/devolucao-puro'
import { nfesDasOrigens } from '@/lib/nfe-saida/loader'
import { tpAmbDaNfe } from '@/lib/nfe-saida/ambiente'
import { rotuloStatusNfe } from '@/lib/nfe-saida/regras-puro'

// Fase F [H1/F1]: devoluções ao fornecedor do estoque próprio (registradas na página da nota). A NF-e de devolução é
// emitida no painel de cada devolução, na página da nota (migration 260); aqui só a situação.

type Linha = {
  id: number; numero: number; situacao: string; data: string; motivo: string; valor_custo: number; valor_fiscal: number
  nota_fiscal_id: number | null; numero_nota_origem: string | null; fornecedor_nome: string | null; criado_por_nome: string | null
}
const dataBR = (d: string) => d.slice(0, 10).split('-').reverse().join('/')

export default async function DevolucoesFornecedorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Devolucao ao fornecedor')) && !(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()
  const sp = await searchParams
  const { data, error } = await (await createClient()).from('devolucoes_fornecedor')
    .select('id, numero, situacao, data, motivo, valor_custo, valor_fiscal, nota_fiscal_id, numero_nota_origem, fornecedor_nome, criado_por_nome')
    .eq('loja_id', lojaId).order('numero', { ascending: false }).limit(300)
  const todas = (data ?? []) as Linha[]
  const vis = sp.situacao ? todas.filter((d) => d.situacao === sp.situacao) : todas
  const aEmitir = todas.filter((d) => d.situacao === 'a_emitir')
  const tpAmb = tpAmbDaNfe()
  const nfes = await nfesDasOrigens(lojaId, 'devolucao', vis.map((d) => d.id))
  const nfeDe = (id: number) => (nfes?.get(id) ?? []).find((n) => n.tpAmb === tpAmb && n.status !== 'descartada') ?? null

  return (
    <div className="space-y-4">
      <PageHeader title="Devoluções ao fornecedor" icon={Undo2}
        description="Itens devolvidos ao fornecedor: saem do estoque pelo custo da entrada. A NF-e de devolução é emitida na página da nota de entrada." />
      {error && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">A devolução ao fornecedor ainda não foi ativada nesta instalação.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Card titulo="A emitir" valor={aEmitir.length.toLocaleString('pt-BR')} sub="esperando a NF-e de devolução" />
        <Card titulo="Valor a emitir (na nota)" valor={<Money value={aEmitir.reduce((a, d) => a + Number(d.valor_fiscal), 0)} />} />
        <Card titulo="Devoluções" valor={todas.length.toLocaleString('pt-BR')} sub={todas.length >= 300 ? 'as 300 mais recentes' : undefined} />
      </div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        {[['', 'Todas'], ['a_emitir', 'A emitir'], ['cancelada', 'Canceladas']].map(([v, t]) => (
          <Link key={v} href={v ? `/devolucao-fornecedor?situacao=${v}` : '/devolucao-fornecedor'}
            className={`rounded-full px-3 py-1 ${(sp.situacao ?? '') === v ? 'bg-brand text-white' : 'bg-surface-2 text-text'}`}>{t}</Link>
        ))}
      </div>
      {vis.length === 0 ? (
        <EmptyState icon={Undo2} title="Nenhuma devolução" hint="Para devolver itens, abra a nota de entrada e use “Devolver itens”." />
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
          {vis.map((d) => (
            <li key={d.id}>
              <Link href={d.nota_fiscal_id ? `/nota-fiscal/${d.nota_fiscal_id}` : '/nota-fiscal'} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 u-motion hover:bg-surface-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text">Nº {d.numero} · {d.fornecedor_nome ?? 'Fornecedor'}</span>
                  <span className="text-[12px] text-text-muted">{dataBR(d.data)} · nota {d.numero_nota_origem ?? '—'} · {d.motivo}{d.criado_por_nome ? ` · ${d.criado_por_nome}` : ''}</span>
                </span>
                <span className={`text-[13px] ${d.situacao === 'a_emitir' ? 'text-warn' : 'text-text-muted'}`}>
                  {rotuloSituacaoDevolucao(d.situacao)}
                  {nfeDe(d.id) && <span className="block text-[12px] text-text-muted">NF-e {nfeDe(d.id)!.numero}{tpAmb === 2 ? ' (homologação)' : ''}: {rotuloStatusNfe(nfeDe(d.id)!.status)}</span>}
                </span>
                <span className="num text-right text-[13px] text-text">custo <Money value={Number(d.valor_custo)} /> · nota <Money value={Number(d.valor_fiscal)} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
