import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { SyncButton } from '@/components/SyncButton'
import { OrdemProducaoRow } from '@/components/ordem-producao/OrdemProducaoRow'
import { Factory, ArrowLeft } from 'lucide-react'

export default async function OrdemProducaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const supabase = await createClient()

  const { data: ordens } = await supabase
    .from('ordens_producao')
    .select(
      'id, num_ordem, identificacao_c_num_op, identificacao_n_cod_produto, identificacao_n_qtde, validade, quantidade'
    )
    .eq('loja_id', lojaId)
    .order('updated_at', { ascending: false })
    .limit(50)

  // Buscar descricoes dos produtos relacionados
  const codigos = [...new Set((ordens ?? []).map((o) => o.identificacao_n_cod_produto).filter(Boolean))]
  const { data: produtos } = codigos.length
    ? await supabase
        .from('produtos')
        .select('codigo_produto, descricao, unidade')
        .eq('loja_id', lojaId)
        .in('codigo_produto', codigos)
    : { data: [] }

  const prodMap = new Map((produtos ?? []).map((p) => [p.codigo_produto, p]))

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <Factory className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Ordens de Produção</h1>
        </div>
        <SyncButton endpoint="/api/sync/ordens-producao" label="Sincronizar" />
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {ordens?.length ? (
          ordens.map((op) => {
            const prod = prodMap.get(op.identificacao_n_cod_produto)
            return (
              <OrdemProducaoRow
                key={op.id}
                op={{
                  id: op.id,
                  numOP: op.identificacao_c_num_op || op.num_ordem || '-',
                  produto: prod?.descricao || `Produto ${op.identificacao_n_cod_produto}`,
                  unidade: prod?.unidade || 'UN',
                  qtdOP: op.identificacao_n_qtde,
                  validade: op.validade,
                  quantidade: op.quantidade,
                }}
              />
            )
          })
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhuma ordem de produção. Sincronize com o Omie.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
