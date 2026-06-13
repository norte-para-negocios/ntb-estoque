import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ContagemTransferencia,
  type ItemMovimento,
} from '@/components/transferencia/ContagemTransferencia'

export default async function ContagemTransferenciaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Ver'))) notFound()

  const { id } = await params
  const supabase = await createClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, data, codigo_local_origem, codigo_local_destino, status')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) notFound()

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
        .select('codigo_produto, codigo, descricao')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }
  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  const itens: ItemMovimento[] = (movimentos ?? []).map((m) => {
    const p = prodMap.get(m.id_prod)
    return {
      id: m.id,
      id_prod: m.id_prod,
      descricao: p?.descricao || `Produto ${m.id_prod}`,
      codigo: p?.codigo || String(m.id_prod),
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/transferencia" className="text-sm text-blue-600 hover:underline">
            ← Voltar
          </Link>
          <h1 className="text-2xl font-bold mt-1">
            {localMap.get(trans.codigo_local_origem) || trans.codigo_local_origem}
            {' → '}
            {localMap.get(trans.codigo_local_destino) || trans.codigo_local_destino}
          </h1>
          <p className="text-sm text-gray-500">
            {new Date(trans.data).toLocaleDateString('pt-BR')} · {trans.status}
          </p>
        </div>
        <a
          href={`/transferencia/${trans.id}/imprimir`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline whitespace-nowrap mt-5"
        >
          Imprimir PDF
        </a>
      </div>

      <ContagemTransferencia
        transferenciaId={trans.id}
        itensIniciais={itens}
        finalizado={finalizado}
      />
    </div>
  )
}
