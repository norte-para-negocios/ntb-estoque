import { notFound } from 'next/navigation'
import { CheckCircle2, AlertTriangle, Link2, Link2Off } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { SincronizarAgora } from '@/components/sync-catalogo/SincronizarAgora'

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '—')
const ROTULO: Record<string, string> = { so_estoque: 'Só no Estoque', so_vendas: 'Só no Vendas', conflito: 'Conflito', erro_entrega: 'Falha de entrega' }

// Divergências da sincronização do catálogo com o Norte Vendas. Nada some em silêncio: o que não entrega aparece aqui.
export default async function SyncCatalogoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const supabase = createServiceClient()
  const [{ data: loja }, { data: fila }, { data: diverg }, { data: ultimo }] = await Promise.all([
    supabase.from('lojas').select('vendas_store_id').eq('id', lojaId).maybeSingle(),
    supabase.from('sync_outbox').select('id, entidade, ref, status, tentativas, erro, proxima_tentativa, atualizado_em').eq('loja_id', lojaId).in('status', ['pending', 'erro']).order('id', { ascending: false }).limit(100),
    supabase.from('sync_divergencias').select('id, entidade, ref, tipo, detalhe, detectado_em').eq('loja_id', lojaId).is('resolvido_em', null).order('detectado_em', { ascending: false }).limit(100),
    supabase.from('sync_outbox').select('atualizado_em').eq('loja_id', lojaId).eq('status', 'ok').order('atualizado_em', { ascending: false }).limit(1),
  ])
  const ligada = !!loja?.vendas_store_id
  const pendentes = (fila ?? []).filter((f) => f.status === 'pending').length
  const erros = (fila ?? []).filter((f) => f.status === 'erro').length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sincronização com o Vendas"
        description="Loja, grupos e produtos seguem sozinhos entre o Norte Estoque e o Norte Vendas. Aqui aparece só o que precisa de atenção."
        actions={<SincronizarAgora />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-text-muted">Ligação</p>
          <p className={`mt-1 flex items-center gap-2 text-[17px] font-semibold ${ligada ? 'text-text' : 'text-warn'}`}>
            {ligada ? <Link2 className="size-5 text-ok" /> : <Link2Off className="size-5 text-warn" />}{ligada ? 'Conectada' : 'Aguardando'}
          </p>
          <p className="mt-1 text-[12px] text-text-muted">{ligada ? 'A loja existe nos dois sistemas.' : 'A loja é criada no Vendas na próxima rodada automática.'}</p>
        </div>
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-text-muted">Na fila</p>
          <p className="mt-1 text-[28px] font-bold leading-none tabular-nums text-text">{pendentes}</p>
          <p className="mt-2 text-[12px] text-text-muted">Entregues a cada poucos minutos.</p>
        </div>
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-text-muted">Com falha</p>
          <p className={`mt-1 text-[28px] font-bold leading-none tabular-nums ${erros ? 'text-err' : 'text-text'}`}>{erros}</p>
          <p className="mt-2 text-[12px] text-text-muted">Depois de 8 tentativas viram divergência.</p>
        </div>
        <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-[13px] font-medium text-text-muted">Última entrega</p>
          <p className="mt-1 text-[17px] font-semibold text-text">{fmt((ultimo?.[0]?.atualizado_em as string | undefined) ?? null)}</p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 px-1 text-[17px] font-semibold tracking-[-0.01em] text-text">Divergências</h2>
        <div className="overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          {(diverg ?? []).length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-6 text-[14px] text-text-muted"><CheckCircle2 className="size-5 text-ok" />Nenhuma divergência. Os dois catálogos estão iguais.</div>
          ) : (
            <ul className="divide-y divide-border">
              {(diverg ?? []).map((d) => (
                <li key={d.id as number} className="flex items-start gap-3 px-5 py-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-text">{ROTULO[d.tipo as string] ?? d.tipo} · {d.entidade === 'produto' ? 'produto' : 'grupo'} <span className="font-mono text-text-muted">{d.ref}</span></p>
                    {d.detalhe && <p className="mt-0.5 break-words text-[13px] text-text-muted">{d.detalhe as string}</p>}
                  </div>
                  <span className="shrink-0 text-[12px] text-text-muted">{fmt(d.detectado_em as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[17px] font-semibold tracking-[-0.01em] text-text">Fila de entrega</h2>
        <div className="overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
          {(fila ?? []).length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Fila vazia" hint="Tudo o que foi alterado já foi entregue." />
          ) : (
            <ul className="divide-y divide-border">
              {(fila ?? []).map((f) => (
                <li key={f.id as number} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${f.status === 'erro' ? 'bg-err-fill' : 'bg-warn-fill'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-text">{f.entidade === 'produto' ? 'Produto' : 'Grupo'} <span className="font-mono text-text-muted">{f.ref}</span></p>
                    <p className="mt-0.5 text-[13px] text-text-muted">{f.status === 'erro' ? 'Falhou' : 'Aguardando'} · {f.tentativas} tentativa(s){f.erro ? ` · ${f.erro}` : ''}</p>
                  </div>
                  <span className="shrink-0 text-[12px] text-text-muted">{fmt(f.atualizado_em as string)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
