import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Factory } from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { CriarOPProdutos } from '@/components/ordem-producao/CriarOPProdutos'
import { FREQ_OP_LABEL, FREQ_OP_VALIDAS, type FreqOP } from '@/lib/op-recorrencia'

// Passo 2 da criacao de OP: escolher os produtos. O cabecalho (data/recorrencia/
// local/obs) vem por query da tela anterior (modal "Criar OP"). Espelha o fluxo
// da transferencia (modal de cabecalho -> tela dedicada de itens).
export default async function NovaOPPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; freq?: string; vezes?: string; local?: string; obs?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  // Passo 2 da criacao de OP: exige a permissao de Criar (pode ser aberta por URL).
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Criar'))) notFound()

  const sp = await searchParams
  const data = (sp.data ?? '').match(/^\d{4}-\d{2}-\d{2}$/) ? sp.data! : ''
  const freq: FreqOP = FREQ_OP_VALIDAS.includes(sp.freq as FreqOP) ? (sp.freq as FreqOP) : 'nao'
  const vezes = freq === 'nao' ? 1 : Math.max(2, Math.min(24, Number(sp.vezes) || 4))
  const localCodigo = sp.local && /^\d+$/.test(sp.local) ? Number(sp.local) : null
  const obs = sp.obs ?? ''

  // Sem data valida = acesso direto sem passar pelo passo 1.
  if (!data) {
    return (
      <div className="space-y-4">
        <DetailHeader
          href="/ordem-producao"
          title="Nova ordem de produção"
          breadcrumb={[
            { label: 'Ordens de Produção', href: '/ordem-producao' },
            { label: 'Nova OP' },
          ]}
        />
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

  const m = data.match(/^(\d{4})-(\d{2})-(\d{2})/)
  const dataBR = m ? `${m[3]}/${m[2]}/${m[1]}` : data

  return (
    <div className="pb-4">
      <DetailHeader
        href="/ordem-producao"
        title="Nova ordem de produção"
        breadcrumb={[
          { label: 'Ordens de Produção', href: '/ordem-producao' },
          { label: 'Nova OP' },
        ]}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-muted">
            <span className="num">{dataBR}</span>
            <span aria-hidden>·</span>
            <span>{localNome ?? 'Padrão do produto'}</span>
            {freq !== 'nao' && (
              <>
                <span aria-hidden>·</span>
                <span>{FREQ_OP_LABEL[freq].toLowerCase()}, {vezes}×</span>
              </>
            )}
          </span>
        }
      />
      <CriarOPProdutos data={data} freq={freq} vezes={vezes} localCodigo={localCodigo} localNome={localNome} obs={obs} />
    </div>
  )
}
