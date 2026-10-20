import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileOutput } from 'lucide-react'
import { getCurrentLojaId, isAdminDaLoja, requirePermissao } from '@/lib/auth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { ConfigNfeForm } from '@/components/nfe-saida/ConfigNfeForm'
import { listarNfesSaida } from '@/lib/nfe-saida/loader'
import { rotuloAmbiente, tpAmbDaNfe } from '@/lib/nfe-saida/ambiente'
import { rotuloStatusNfe } from '@/lib/nfe-saida/regras-puro'

// Fase F (F1/F2): NF-e de SAÍDA do estoque próprio — lista das emitidas (devolução e transferência) e a configuração
// fiscal da loja. A emissão é feita no documento de origem (nota de entrada → devolução; transferência entre lojas).

const dataBR = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '—')

export default async function NfeSaidaPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Emitir NF-e')) && !(await isAdminDaLoja(lojaId))) notFound()
  const tpAmb = tpAmbDaNfe()
  const sb = await createClient()
  const [nfes, { data: cfg, error: ecfg }, { data: loja }, { data: num }] = await Promise.all([
    listarNfesSaida(lojaId),
    sb.from('nfe_config').select('*').eq('loja_id', lojaId).maybeSingle(),
    // colunas de lojas com grant restrito (Fase 0): lidas pelo servidor, só para os avisos abaixo
    createServiceClient().from('lojas').select('codigo_municipio, uf, inscricao_estadual, certificado_validade').eq('id', lojaId).maybeSingle(),
    sb.from('nfe_numeracao').select('tp_amb, serie, ultimo_numero').eq('loja_id', lojaId).order('tp_amb').order('serie'),
  ])
  const ativada = nfes !== null && !ecfg
  const podeEditar = await isAdminDaLoja(lojaId)

  return (
    <div className="space-y-4">
      <PageHeader title="NF-e de saída" icon={FileOutput}
        description="Notas fiscais emitidas pelo Norte Estoque: devolução ao fornecedor e transferência/remessa entre lojas. Emita no próprio documento (nota de entrada → devolução, ou Transferências entre lojas)." />
      <p className={`rounded-[var(--r-lg)] px-4 py-3 text-[13px] ${tpAmb === 2 ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}>
        Ambiente: <b>{rotuloAmbiente(tpAmb)}</b>. {tpAmb === 2 ? 'As notas são autorizadas como teste e não têm valor fiscal; a devolução continua "a emitir".' : 'As notas têm valor fiscal.'} O ambiente é definido no servidor (NFE_AMBIENTE), não por esta tela.
      </p>
      {!ativada && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">A NF-e de saída ainda não foi ativada nesta instalação (migration 260).</p>}
      {ativada && (
        <>
          <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 u-card">
            <h2 className="text-[15px] font-semibold text-text">Configuração fiscal</h2>
            {!loja?.inscricao_estadual && <p className="text-[13px] text-warn">A loja está sem inscrição estadual no cadastro (Loja).</p>}
            {!loja?.certificado_validade && <p className="text-[13px] text-warn">A loja está sem certificado digital A1 (Loja → Certificado).</p>}
            <ConfigNfeForm podeEditar={podeEditar}
              numeracao={(num ?? []).map((n) => ({ tpAmb: n.tp_amb === 1 ? 1 : 2, serie: n.serie, ultimo: n.ultimo_numero }))}
              inicial={{
                crt: cfg?.crt ?? null, serieProducao: cfg?.serie_producao ?? null, serieHomologacao: cfg?.serie_homologacao ?? 920, autxmlCnpj: cfg?.autxml_cnpj ?? null,
                cstPisCofins: cfg?.cst_pis_cofins ?? '49', csosnTransferencia: cfg?.csosn_transferencia ?? '400', cstTransferencia: cfg?.cst_transferencia ?? '41',
                csosnRemessa: cfg?.csosn_remessa ?? '900', cstRemessa: cfg?.cst_remessa ?? '90', infoComplementar: cfg?.info_complementar ?? null,
                codigoMunicipio: loja?.codigo_municipio ?? null,
                respTecCnpj: cfg?.resp_tec_cnpj ?? null, respTecContato: cfg?.resp_tec_contato ?? null, respTecEmail: cfg?.resp_tec_email ?? null,
                respTecFone: cfg?.resp_tec_fone ?? null,
              }} />
          </section>
          {nfes.length === 0 ? (
            <EmptyState icon={FileOutput} title="Nenhuma NF-e de saída" hint="Registre uma devolução ao fornecedor (na nota de entrada) ou uma transferência entre lojas e emita a NF-e por lá." />
          ) : (
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--r-lg)] bg-surface u-card">
              {nfes.map((n) => (
                <li key={n.id} className="grid gap-x-4 gap-y-1 px-4 py-3 text-[13px] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="min-w-0">
                    <span className="block font-medium text-text">
                      {n.tpAmb === 2 ? '[homologação] ' : ''}NF-e nº {n.numero} série {n.serie} · {n.origemTipo === 'devolucao' ? 'Devolução' : 'Transferência'}
                    </span>
                    <span className="block truncate text-[12px] text-text-muted">{n.destNome ?? '—'} · {dataBR(n.dhEmissao ?? n.createdAt)}{n.criadoPor ? ` · ${n.criadoPor}` : ''}</span>
                    {n.chave && <span className="block break-all font-mono text-[11px] text-text-muted">{n.chave}</span>}
                  </span>
                  <span className="text-text">
                    {rotuloStatusNfe(n.status, n.enviandoDesde)}
                    {n.cStat && n.status !== 'autorizada' && <span className="block text-[12px] text-text-muted">{n.cStat} {n.xMotivo}</span>}
                  </span>
                  <span className="text-right">
                    {n.valorTotal != null && <Money value={n.valorTotal} />}
                    {(n.status === 'autorizada' || n.status === 'cancelada') && (
                      <span className="block text-[12px]">
                        <a className="text-brand hover:underline" href={`/api/nfe-saida/${n.id}/xml`}>XML</a> · <a className="text-brand hover:underline" href={`/api/nfe-saida/${n.id}/danfe`} target="_blank">DANFE</a>
                        {' · '}<Link className="text-brand hover:underline" href={n.origemTipo === 'devolucao' ? '/devolucao-fornecedor' : '/transferencia-loja'}>documento</Link>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
