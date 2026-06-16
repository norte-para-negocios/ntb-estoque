import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Factory } from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { CriarOPProdutos } from '@/components/ordem-producao/CriarOPProdutos'

// Passo 2 da criacao de OP: escolher os produtos. O cabecalho (data/recorrencia/
// local/obs) vem por query da tela anterior (modal "Criar OP"). Espelha o fluxo
// da transferencia (modal de cabecalho -> tela dedicada de itens).
export default async function NovaOPPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; semanas?: string; local?: string; obs?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Ordens de Producao'))) notFound()

  const sp = await searchParams
  const data = (sp.data ?? '').match(/^\d{4}-\d{2}-\d{2}$/) ? sp.data! : ''
  const semanas = Math.max(1, Math.min(12, Number(sp.semanas) || 1))
  const localCodigo = sp.local && /^\d+$/.test(sp.local) ? Number(sp.local) : null
  const obs = sp.obs ?? ''

  const voltar = (
    <Link href="/ordem-producao" className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text">
      <ArrowLeft className="size-4" /> Voltar
    </Link>
  )

  // Sem data valida = acesso direto sem passar pelo passo 1.
  if (!data) {
    return (
      <div className="space-y-4">
        {voltar}
        <EmptyState
          icon={Factory}
          title="Comece pela tela de Ordens de Produção"
          hint='Clique em "Criar OP" para escolher a data e o local antes de adicionar os produtos.'
        />
        <div>
          <Link href="/ordem-producao" className={btnClass('primary')}>
            Ir para Ordens de Produção
          </Link>
        </div>
      </div>
    )
  }

  // Nome do local escolhido (so para exibir no resumo).
  let localNome: string | null = null
  if (localCodigo != null) {
    const supabase = await createClient()
    const { data: loc } = await supabase
      .from('local_estoques')
      .select('descricao')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', localCodigo)
      .maybeSingle()
    localNome = (loc?.descricao as string | null) ?? null
  }

  return (
    <div className="space-y-4">
      {voltar}
      <CriarOPProdutos data={data} semanas={semanas} localCodigo={localCodigo} localNome={localNome} obs={obs} />
    </div>
  )
}
