import { notFound } from 'next/navigation'
import { Truck } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { PainelNfeSaida } from '@/components/nfe-saida/PainelNfeSaida'
import { CancelarTransferenciaLoja, NovaTransferenciaLoja } from '@/components/nfe-saida/NovaTransferenciaLoja'
import { nfesDasOrigens } from '@/lib/nfe-saida/loader'
import { tpAmbDaNfe } from '@/lib/nfe-saida/ambiente'
import { naturezaEntreLojas } from '@/lib/nfe-saida/regras-puro'

// Fase F [F2/H4]: transferência/remessa ENTRE LOJAS com nota (só estoque próprio). A transferência entre locais da
// mesma loja continua em Transferências (sem nota). Migration 261 (documento + saída do estoque) e 260 (NF-e).

type Linha = {
  id: number; numero: number; loja_destino_id: number; destino_nome: string | null; natureza: string; situacao: string; data: string
  valor_custo: number; obs: string | null; criado_por_nome: string | null; motivo_cancelamento: string | null
  itens: { linha: number; descricao: string | null; unidade: string | null; quantidade: number; custo_unitario: number }[]
}
const dataBR = (d: string) => d.slice(0, 10).split('-').reverse().join('/')
const q = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default async function TransferenciaLojaPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const pode = await requirePermissao(lojaId, 'Transferencias - Entre lojas')
  const podeNfe = await requirePermissao(lojaId, 'Compras - Emitir NF-e')
  if (!pode && !podeNfe) notFound()
  const tpAmb = tpAmbDaNfe()
  const svc = createServiceClient()
  const [{ data, error }, { data: eu }, { data: lojas }, { data: locais }] = await Promise.all([
    (await createClient()).from('transferencias_loja')
      .select('id, numero, loja_destino_id, destino_nome, natureza, situacao, data, valor_custo, obs, criado_por_nome, motivo_cancelamento, itens:transferencias_loja_itens(linha, descricao, unidade, quantidade, custo_unitario)')
      .eq('loja_id', lojaId).order('numero', { ascending: false }).limit(100),
    svc.from('lojas').select('cnpj, is_test').eq('id', lojaId).maybeSingle(),
    svc.from('lojas').select('id, nome, nome_fantasia, cnpj, cidade, uf, is_test, ativo').neq('id', lojaId).eq('ativo', true).order('nome'),
    svc.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  const lista = (data ?? []) as Linha[]
  const nfes = await nfesDasOrigens(lojaId, 'transferencia_loja', lista.map((t) => t.id))
  const destinos = (lojas ?? [])
    .filter((l) => !!l.is_test === !!eu?.is_test && String(l.cnpj ?? '').replace(/\D/g, '').length === 14)
    .map((l) => ({ id: Number(l.id), nome: `${l.nome_fantasia || l.nome}${l.cidade ? ` · ${l.cidade}/${l.uf ?? ''}` : ''}`, natureza: naturezaEntreLojas(String(eu?.cnpj ?? ''), String(l.cnpj)) }))

  return (
    <div className="space-y-4">
      <PageHeader title="Transferências entre lojas" icon={Truck}
        description="Mercadoria que sai desta loja para outra loja (outro CNPJ), com NF-e. Entre locais da mesma loja use Transferências." />
      {error && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">A transferência entre lojas ainda não foi ativada nesta instalação (migration 261).</p>}
      {pode && !error && (
        <div className="flex justify-end">
          <NovaTransferenciaLoja destinos={destinos} locais={(locais ?? []).map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: String(l.descricao ?? l.codigo_local_estoque) }))} />
        </div>
      )}
      {lista.length === 0 && !error ? (
        <EmptyState icon={Truck} title="Nenhuma transferência entre lojas" hint="Use “Nova transferência” para enviar mercadoria a outra loja com nota fiscal." />
      ) : (
        <ul className="space-y-3">
          {lista.map((t) => (
            <li key={t.id} className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-text">Nº {t.numero} · {dataBR(t.data)} · para {t.destino_nome ?? `loja ${t.loja_destino_id}`} · {t.natureza === 'remessa' ? 'Remessa' : 'Transferência'}</span>
                <span className={t.situacao === 'cancelada' ? 'text-text-muted' : 'text-text'}>{t.situacao === 'cancelada' ? 'Cancelada' : 'Registrada'} · custo <Money value={Number(t.valor_custo)} /></span>
              </div>
              <ul className="pl-3 text-text-muted">
                {[...t.itens].sort((a, b) => a.linha - b.linha).map((i) => <li key={i.linha}>{i.linha}. {i.descricao}: {q(i.quantidade)} {i.unidade ?? ''}</li>)}
              </ul>
              {t.obs && <p className="text-text-muted">Obs.: {t.obs}</p>}
              {t.situacao === 'cancelada' && t.motivo_cancelamento && <p className="text-text-muted">Cancelada: {t.motivo_cancelamento}</p>}
              {nfes && (t.situacao !== 'cancelada' || (nfes.get(t.id) ?? []).length > 0) && (
                <PainelNfeSaida origem="transferencia_loja" origemId={t.id} nfes={nfes.get(t.id) ?? []} tpAmb={tpAmb} pode={podeNfe} emitivel={t.situacao === 'registrada'} />
              )}
              {pode && t.situacao === 'registrada' && <CancelarTransferenciaLoja id={t.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
