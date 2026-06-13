import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { CopyWebhook } from '@/components/loja/CopyWebhook'
import { ForceSyncLoja } from '@/components/loja/ForceSyncLoja'
import { LojaForm } from '@/components/loja/LojaForm'
import { ExcluirLoja } from '@/components/loja/ExcluirLoja'
import { Store, ArrowLeft } from 'lucide-react'

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString('pt-BR') : 'dd/mm/aa hh:mm:ss'
}

function status(s: string | null): string {
  return s ?? 'N/A'
}

export default async function LojaPage() {
  if (!(await isAdmin())) notFound()

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('*')
    .order('id')

  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL || 'https://ntb-estoque.vercel.app') + '/api/webhook'

  return (
    <div className="space-y-4">
      {/* Título estilo original: voltar + ícone + nome */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <Store className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">Lojas</h1>
        </div>
        <LojaForm />
      </div>

      {/* Aviso do webhook do Omie */}
      <div className="ntb-card">
        <div className="ntb-card-header">Webhook do Omie</div>
        <div className="ntb-card-body space-y-2">
          <p className="text-sm text-[#5d5d5d]">
            Importante: cadastre o webhook abaixo nos seus aplicativos Omie no endereço{' '}
            <a
              href="https://developer.omie.com.br/my-apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#2eb5c3] hover:underline"
            >
              developer.omie.com.br/my-apps
            </a>{' '}
            e ative todas as opções.
          </p>
          <CopyWebhook url={webhookUrl} />
        </div>
      </div>

      {/* Lista de cards empilhados (fiel ao original) */}
      <div className="space-y-4">
        {lojas?.length ? (
          lojas.map((loja) => (
            <div key={loja.id} className="ntb-card">
              <div className="ntb-card-header flex items-center justify-between gap-3">
                <span className="truncate">
                  {loja.cnpj ? `${loja.cnpj}: ` : ''}
                  {loja.nome_fantasia || loja.nome}
                  {loja.nome_fantasia && loja.nome ? (
                    <span className="font-normal text-white/90"> | {loja.nome}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-normal text-white/90">
                  {loja.ativo ? 'Ativa' : 'Inativa'}
                </span>
              </div>
              <div className="ntb-card-body space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#5d5d5d]">Atualizações:</span>
                  <ForceSyncLoja lojaId={loja.id} />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <small className="text-[#8a8a8a]">Local de Estoque</small>
                    <p className="text-sm font-semibold text-[#5d5d5d]">
                      {fmt(loja.local_estoque_ultima_atualizacao)}
                    </p>
                    <small className="text-[#8a8a8a]">({status(loja.local_estoque_status)})</small>
                  </div>
                  <div>
                    <small className="text-[#8a8a8a]">Produto</small>
                    <p className="text-sm font-semibold text-[#5d5d5d]">
                      {fmt(loja.produto_ultima_atualizacao)}
                    </p>
                    <small className="text-[#8a8a8a]">({status(loja.produto_status)})</small>
                  </div>
                  <div>
                    <small className="text-[#8a8a8a]">Ordem de Produção</small>
                    <p className="text-sm font-semibold text-[#5d5d5d]">
                      {fmt(loja.ordem_producao_ultima_atualizacao)}
                    </p>
                    <small className="text-[#8a8a8a]">({status(loja.ordem_producao_status)})</small>
                  </div>
                  <div>
                    <small className="text-[#8a8a8a]">Nota Fiscal</small>
                    <p className="text-sm font-semibold text-[#5d5d5d]">
                      {fmt(loja.nota_fiscal_ultima_atualizacao)}
                    </p>
                    <small className="text-[#8a8a8a]">({status(loja.nota_fiscal_status)})</small>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 border-t border-[#e2e2e2] pt-3">
                  <span className="text-xs text-[#8a8a8a]">
                    OMIE KEY: {loja.omie_app_key ? loja.omie_app_key.slice(0, 6) : '-'}
                  </span>
                  <span className="text-xs text-[#8a8a8a]">
                    OMIE SECRET: {loja.omie_app_secret ? loja.omie_app_secret.slice(0, 6) : '-'}
                  </span>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[#e2e2e2] pt-3">
                  <LojaForm loja={loja} />
                  <ExcluirLoja lojaId={loja.id} nome={loja.nome_fantasia || loja.nome} />
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="ntb-card">
            <div className="ntb-card-body text-center text-[#8a8a8a]">
              Nenhuma loja cadastrada. Clique em &quot;Nova loja&quot; para começar.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
