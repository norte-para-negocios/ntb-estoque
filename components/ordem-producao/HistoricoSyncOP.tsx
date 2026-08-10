import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'

// Seção "Histórico de sync com a Omie" -- expõe os campos gravados pela Task 1
// desta mesma auditoria (retry Omie) em `ordens_producao`: conclusao_status,
// conclusao_erro_msg, conclusao_tentativas, conclusao_ultima_tentativa_em (fila
// de reenvio automático) e conclusao_qtde_desejada/conclusao_data_desejada
// (o que a próxima tentativa vai usar). Puramente informativo -- não é
// interativo (a ação de reenvio já existe na listagem, via finishOP).
export type SyncOPInfo = {
  // Achado real (revisão desta task): as 6 colunas conclusao_* (Task 1 desta
  // auditoria) só existem na tabela `ordens_producao` do Supabase -- confirmado
  // ao vivo (`\d ordens_producao` no Postgres `ntb_frio` do Contabo) que NUNCA
  // foram migradas pro banco frio. Uma OP fora da janela quente (fallback via
  // complementarOrdensProducao) sempre chega aqui com esses 6 campos ausentes
  // -- sem essa flag, a seção mostraria "sem pendência" quando na verdade é
  // "não sabemos" (dado não disponível nessa fonte).
  fonte: 'quente' | 'frio'
  concluida: boolean
  conclusaoStatus: string | null
  conclusaoErroMsg: string | null
  conclusaoTentativas: number | null
  conclusaoUltimaTentativaEm: string | null
  conclusaoQtdeDesejada: number | null
  conclusaoDataDesejada: string | null
}

function fmtDataHora(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDataBR(d: string | null): string | null {
  if (!d) return null
  const m = d.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d
}

const STATUS_TOKEN: Record<string, CorToken> = {
  Erro: 'err',
  'Sem CMC': 'warn',
}

export function HistoricoSyncOP({ info }: { info: SyncOPInfo }) {
  const semPendencia = !info.conclusaoStatus && (info.conclusaoTentativas ?? 0) === 0

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-medium text-text-muted">Histórico de sync com a Omie</h2>

      {info.fonte === 'frio' ? (
        <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[13px] text-text-muted">
          Dado não disponível para esta OP. Ela é mais antiga que a janela do banco quente (Supabase) e veio do
          histórico do Contabo -- os campos de sync (status/tentativas/erro) nunca foram migrados pra lá, então
          isto NÃO significa &ldquo;sem erro&rdquo;, só que não dá pra saber a partir daqui.
        </p>
      ) : semPendencia ? (
        <p className="text-[13px] text-text-muted">
          {info.concluida
            ? 'Concluída no Omie sem nenhum erro de sincronização registrado.'
            : 'Nenhuma tentativa de conclusão automática registrada ainda.'}
        </p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-[11px] text-text-muted">Status da fila de reenvio</dt>
            <dd className="mt-0.5">
              {info.conclusaoStatus ? (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[STATUS_TOKEN[info.conclusaoStatus] ?? 'neutro']}`}>
                  {info.conclusaoStatus}
                </span>
              ) : (
                <span className="text-[13px] text-ok">Sem pendência</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-muted">Tentativas</dt>
            <dd className="num text-[13px] text-text">{info.conclusaoTentativas ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-text-muted">Última tentativa</dt>
            <dd className="num text-[13px] text-text">{fmtDataHora(info.conclusaoUltimaTentativaEm) ?? '-'}</dd>
          </div>
          {info.conclusaoQtdeDesejada != null && (
            <div>
              <dt className="text-[11px] text-text-muted">Quantidade desejada (próxima tentativa)</dt>
              <dd className="num text-[13px] text-text">{info.conclusaoQtdeDesejada.toLocaleString('pt-BR')}</dd>
            </div>
          )}
          {info.conclusaoDataDesejada != null && (
            <div>
              <dt className="text-[11px] text-text-muted">Data desejada (próxima tentativa)</dt>
              <dd className="num text-[13px] text-text">{fmtDataBR(info.conclusaoDataDesejada)}</dd>
            </div>
          )}
          {info.conclusaoErroMsg && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-[11px] text-text-muted">Última mensagem de erro</dt>
              <dd className="mt-0.5 rounded-md border border-err/30 bg-err/10 px-3 py-2 text-[12px] text-text">
                {info.conclusaoErroMsg}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
