import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ListTodo } from 'lucide-react'
import { getCurrentLojaId, getProfile, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { CartaoResumo as Card } from '@/components/faturamento/CartaoResumo'
import { montarTarefas, resumoTarefas, ROTULO_TAREFA, type EntradaTarefas, type TipoTarefa } from '@/lib/compras/tarefas-puro'
import { listarPedidos } from '../pedido-compra/dados'
import { listarRequisicoes } from '../requisicao-compra/dados'

type Sp = Record<string, string | undefined>
const COR: Record<TipoTarefa, string> = {
  pedido_atrasado: 'bg-err', aprovar_pedido: 'bg-warn', conferir_nota: 'bg-info', aprovar_requisicao: 'bg-warn', gerar_pedido: 'bg-info', rascunho_parado: 'bg-text-muted',
}
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')

/** Notas do estoque próprio dos últimos 90 dias, não canceladas, e se já têm vínculo com algum pedido. */
async function notasRecentes(lojaId: number, hoje: string): Promise<EntradaTarefas['notas']> {
  const sb = await createClient()
  const desde = new Date(Date.parse(`${hoje}T12:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data } = await sb.from('compras_proprio').select('id, nota_fiscal_id, numero, fornecedor_nome, fornecedor_cnpj, emissao')
    .eq('loja_id', lojaId).neq('status', 'cancelada').gte('created_at', desde).order('id', { ascending: false }).limit(500)
  const notas = data ?? []
  const comVinculo = new Set<number>()
  for (let i = 0; i < notas.length; i += 200) {
    const { data: vs } = await sb.from('pedidos_compra_vinculos').select('compra_id').eq('loja_id', lojaId).in('compra_id', notas.slice(i, i + 200).map((n) => n.id))
    for (const v of vs ?? []) comVinculo.add(Number(v.compra_id))
  }
  return notas.map((n) => ({ compraId: Number(n.id), notaId: n.nota_fiscal_id == null ? null : Number(n.nota_fiscal_id), numero: n.numero, fornecedorNome: n.fornecedor_nome,
    fornecedorCnpj: n.fornecedor_cnpj, emissao: n.emissao, temVinculo: comVinculo.has(Number(n.id)) }))
}

// Painel de tarefas de compras (Fase C2, I7): o que espera ação. Só estoque próprio; loja Omie = 404.
export default async function TarefasComprasPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const [aprovar, pedidos, requisicoes, notas] = await Promise.all([
    requirePermissao(lojaId, 'Compras - Aprovar pedidos'), requirePermissao(lojaId, 'Compras - Pedidos'),
    requirePermissao(lojaId, 'Compras - Requisicoes'), requirePermissao(lojaId, 'Notas Fiscais'),
  ])
  if (!aprovar && !pedidos && !requisicoes) notFound()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const perfil = await getProfile()
  const sb = await createClient()
  const [ped, req, nts, { data: meus }] = await Promise.all([
    listarPedidos(lojaId), listarRequisicoes(lojaId), notasRecentes(lojaId, hoje),
    sb.from('compradores').select('id').eq('loja_id', lojaId).eq('user_id', perfil.id).eq('ativo', true).limit(1),
  ])
  const meuComprador = meus?.[0]?.id != null ? Number(meus[0].id) : null
  const entrada: EntradaTarefas = {
    hoje, pode: { aprovar, pedidos, requisicoes, notas },
    requisicoes: req.requisicoes.map((r) => ({ id: r.id, numero: r.numero, etapa: r.etapa, criadaEm: r.createdAt, compradorId: r.compradorId, itens: r.itens.length, valor: r.valor })),
    pedidos: ped.pedidos.map((p) => ({ id: p.id, numero: p.numero, etapa: p.etapa, fornecedorNome: p.fornecedorNome, fornecedorCnpj: p.fornecedorCnpj, previsao: p.previsaoEntrega,
      atualizadoEm: p.updatedAt, compradorId: p.compradorId, qtdBase: p.qtdBase, recebido: p.recebido, total: p.total })),
    notas: nts,
  }
  const minhas = sp.minhas === '1' && meuComprador != null
  const tarefas = montarTarefas(entrada, minhas ? { compradorId: meuComprador } : undefined)
  const res = resumoTarefas(tarefas)
  const tipos = (Object.keys(ROTULO_TAREFA) as TipoTarefa[]).filter((t) => res.porTipo[t] > 0)
  const vis = sp.tipo && sp.tipo in ROTULO_TAREFA ? tarefas.filter((t) => t.tipo === sp.tipo) : tarefas
  const link = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ minhas: minhas ? '1' : undefined, tipo: sp.tipo, ...extra }).filter(([, v]) => v) as [string, string][]).toString()
    return `/tarefas-compras${q ? `?${q}` : ''}`
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Tarefas de compras" icon={ListTodo} description="O que está esperando alguém: aprovar, gerar pedido, cobrar entrega atrasada ou conferir a nota com o pedido."
        actions={meuComprador != null ? (
          <Link href={link({ minhas: minhas ? undefined : '1' })} className={btnClass(minhas ? 'primary' : 'outline')}>{minhas ? 'Mostrando só as minhas' : 'Só as minhas'}</Link>
        ) : undefined} />
      {(ped.erro || req.erro) && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">{req.erro ?? ped.erro}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Tarefas" valor={res.total.toLocaleString('pt-BR')} sub={minhas ? 'só as minhas' : 'de todos'} />
        <Card titulo="Pedidos atrasados" valor={res.porTipo.pedido_atrasado.toLocaleString('pt-BR')} />
        <Card titulo="Para aprovar" valor={(res.porTipo.aprovar_pedido + res.porTipo.aprovar_requisicao).toLocaleString('pt-BR')} sub="pedidos e requisições" />
        <Card titulo="Notas para conferir" valor={res.porTipo.conferir_nota.toLocaleString('pt-BR')} sub="com pedido aprovado do fornecedor" />
      </div>

      {tipos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href={link({ tipo: undefined })} className={btnClass(!sp.tipo ? 'primary' : 'outline')}>Todas</Link>
          {tipos.map((t) => <Link key={t} href={link({ tipo: t })} className={btnClass(sp.tipo === t ? 'primary' : 'outline')}>{ROTULO_TAREFA[t]} ({res.porTipo[t]})</Link>)}
        </div>
      )}

      {vis.length === 0 ? (
        <EmptyState icon={ListTodo} title="Nada esperando ação" hint="Requisições, pedidos e notas estão em dia." />
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
          {vis.map((t) => (
            <li key={`${t.tipo}-${t.ref}`}>
              <Link href={t.href} className="grid items-center gap-x-4 gap-y-1 px-4 py-3 u-motion hover:bg-surface-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_auto]">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text">
                  <span className={`size-2 shrink-0 rounded-full ${COR[t.tipo]}`} aria-hidden />{ROTULO_TAREFA[t.tipo]}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-text">{t.titulo}</span>
                  <span className="block text-[12px] text-text-muted">{t.detalhe}{t.data && t.tipo !== 'pedido_atrasado' ? ` · ${dataBR(t.data)}` : ''}</span>
                </span>
                <span className="md:text-right">{t.valor != null ? <Money value={t.valor} className="text-[14px] font-semibold" /> : null}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
