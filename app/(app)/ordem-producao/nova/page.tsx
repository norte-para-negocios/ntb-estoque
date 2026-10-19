import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Factory } from 'lucide-react'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { btnClass } from '@/components/ui-kit/Button'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { CriarOPProdutos } from '@/components/ordem-producao/CriarOPProdutos'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { quantidadeParaDuplicar } from '@/lib/produto/duplicar-puro'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'
import { UNIDADE_OP_VALIDAS, descreverRecorrenciaOP, type UnidadeOP } from '@/lib/op-recorrencia'

// Passo 2 da criacao de OP: escolher os produtos. O cabecalho (data/recorrencia/
// local/obs) vem por query da tela anterior (modal "Criar OP"). Espelha o fluxo
// da transferencia (modal de cabecalho -> tela dedicada de itens).
export default async function NovaOPPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; unidade?: string; intervalo?: string; vezes?: string; local?: string; destino?: string; obs?: string; duplicar?: string }>
}) {
  const lojaId = await getCurrentLojaId()
  // Passo 2 da criacao de OP: exige a permissao de Criar (pode ser aberta por URL).
  if (!(await requirePermissao(lojaId, 'Ordens de Producao - Criar'))) notFound()

  const sp = await searchParams
  const data = (sp.data ?? '').match(/^\d{4}-\d{2}-\d{2}$/) ? sp.data! : ''
  const unidade: UnidadeOP = UNIDADE_OP_VALIDAS.includes(sp.unidade as UnidadeOP) ? (sp.unidade as UnidadeOP) : 'nao'
  const intervalo = unidade === 'nao' ? 1 : Math.max(1, Math.min(60, Number(sp.intervalo) || 1))
  const vezes = unidade === 'nao' ? 1 : Math.max(2, Math.min(60, Number(sp.vezes) || 4))
  const localCodigo = sp.local && /^\d+$/.test(sp.local) ? Number(sp.local) : null
  const destinoCodigo = sp.destino && /^\d+$/.test(sp.destino) ? Number(sp.destino) : null
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

  let destinoNome: string | null = null
  if (destinoCodigo != null) {
    const supabase = await createClient()
    const { data: loc } = await supabase
      .from('local_estoques')
      .select('descricao')
      .eq('loja_id', lojaId)
      .eq('codigo_local_estoque', destinoCodigo)
      .maybeSingle()
    destinoNome = (loc?.descricao as string | null) ?? null
  }

  // Fase G [M6]: duplicar OP só no estoque próprio (no Omie a OP é escrita no Omie, que pede OK do dono).
  const itensIniciais: { produto: ProdutoBusca; quantidade: string }[] = []
  if (sp.duplicar && /^\d+$/.test(sp.duplicar) && (await modoDaLoja(lojaId)) === 'proprio') {
    const supabase = await createClient()
    const { data: origem } = await supabase.from('ordens_producao').select('identificacao_n_cod_produto, identificacao_n_qtde')
      .eq('loja_id', lojaId).eq('id', Number(sp.duplicar)).maybeSingle()
    if (origem?.identificacao_n_cod_produto) {
      const { data: p } = await supabase.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, unidade')
        .eq('loja_id', lojaId).eq('codigo_produto', origem.identificacao_n_cod_produto).eq('inativo', false).maybeSingle()
      if (p) itensIniciais.push({
        produto: { ...(p as ProdutoBusca), descricao: formatarNomeProduto(p.descricao) },
        quantidade: quantidadeParaDuplicar(Number(origem.identificacao_n_qtde)),
      })
    }
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
            {destinoNome && (
              <>
                <span aria-hidden>→</span>
                <span>{destinoNome}</span>
              </>
            )}
            {unidade !== 'nao' && (
              <>
                <span aria-hidden>·</span>
                <span>{descreverRecorrenciaOP(unidade, intervalo, vezes)}</span>
              </>
            )}
          </span>
        }
      />
      <CriarOPProdutos data={data} unidade={unidade} intervalo={intervalo} vezes={vezes} localCodigo={localCodigo} localNome={localNome} destinoCodigo={destinoCodigo} destinoNome={destinoNome} obs={obs} itensIniciais={itensIniciais} />
    </div>
  )
}
