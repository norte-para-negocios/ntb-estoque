import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { StatusPill } from '@/components/ui-kit/StatusPill'
import {
  ContagemTransferencia,
  type ItemMovimento,
} from '@/components/transferencia/ContagemTransferencia'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export default async function ContagemTransferenciaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()
  const podeEditar = await requirePermissao(lojaId, 'Transferencias - Editar')

  const { id } = await params
  const supabase = await createClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino, status, user_id')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) notFound()

  const { data: responsavel } = trans.user_id
    ? await supabase.from('profiles').select('name').eq('id', trans.user_id).maybeSingle()
    : { data: null }

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id, id_prod, quan, status')
    .eq('transferencia_id', id)
    .order('id')

  // Resolver descricoes dos produtos
  const codigos = [...new Set((movimentos ?? []).map((m) => m.id_prod))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, codigo, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const itens: ItemMovimento[] = (movimentos ?? []).map((m) => {
    const p = prodMap.get(m.id_prod)
    return {
      id: m.id,
      id_prod: m.id_prod,
      descricao: formatarNomeProduto(p?.descricao) || `Produto ${m.id_prod}`,
      codigo: p?.codigo || String(m.id_prod),
      unidade: p?.unidade ?? null,
      quan: m.quan,
      status: m.status,
    }
  })

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_local_estoque', [trans.codigo_local_origem, trans.codigo_local_destino])
  const localMap = new Map((locais ?? []).map((l) => [l.codigo_local_estoque, l.descricao]))

  const finalizado = trans.status === 'Concluido'

  return (
    <div className="pb-4">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/transferencia"
            className="mb-2 inline-flex items-center gap-1 text-[13px] text-text-muted transition-colors hover:text-text"
          >
            <ArrowLeft className="size-3.5" /> Voltar
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight text-text">
            {localMap.get(trans.codigo_local_origem) || trans.codigo_local_origem}
            {' → '}
            {localMap.get(trans.codigo_local_destino) || trans.codigo_local_destino}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="num text-[13px] text-text-muted">
              {new Date(trans.data).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })}
            </span>
            <StatusPill status={trans.status} />
            {responsavel?.name && (
              <span className="text-[13px] text-text-muted">por {responsavel.name}</span>
            )}
          </div>
        </div>
        <a
          href={`/transferencia/${trans.id}/imprimir`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
        >
          <Printer className="size-4" /> Imprimir PDF
        </a>
      </div>

      <ContagemTransferencia
        transferenciaId={trans.id}
        itensIniciais={itens}
        finalizado={finalizado}
        podeEditar={podeEditar}
      />
    </div>
  )
}
