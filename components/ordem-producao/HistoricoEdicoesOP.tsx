import { createClient } from '@/lib/supabase/server'

// Seção "Histórico de edições" -- lê `audit_log`. Achado real durante a Task 18
// desta auditoria (retry Omie): a entidade gravada por
// lib/actions/ordem-producao.ts (registrarAuditoria) NÃO é 'ordem_producao'
// como o brief original supunha -- é o rótulo legível 'ordem de produção' (com
// acento e espaço), e o `entidade_id` gravado é o CÓDIGO OMIE
// (identificacao_n_cod_op), não o `id` interno da linha no Supabase. Confirmado
// direto no código (lib/actions/ordem-producao.ts, todas as chamadas de
// registrarAuditoria) e ao vivo no Postgres de produção (audit_log real:
// entidade='ordem de produção', entidade_id='3802880260' etc.) antes de
// escrever esta query -- não assumido.
const ACAO_LABEL: Record<string, string> = {
  criar: 'Criada',
  editar: 'Editada',
  excluir: 'Excluída',
  concluir: 'Concluída',
  reverter: 'Conclusão revertida',
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export async function HistoricoEdicoesOP({
  lojaId,
  codigoOmieOP,
}: {
  lojaId: number
  codigoOmieOP: number | null
}) {
  const supabase = await createClient()

  const { data } = codigoOmieOP
    ? await supabase
        .from('audit_log')
        .select('id, acao, user_nome, descricao, created_at')
        .eq('loja_id', lojaId)
        .eq('entidade', 'ordem de produção')
        .eq('entidade_id', String(codigoOmieOP))
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] }

  const registros = data ?? []

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-medium text-text-muted">Histórico de edições</h2>
      {registros.length === 0 ? (
        <p className="text-[13px] text-text-muted">Nenhuma edição registrada para esta OP.</p>
      ) : (
        <ul className="space-y-2">
          {registros.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-2 last:border-none last:pb-0">
              <div>
                <span className="text-[13px] text-text">{ACAO_LABEL[r.acao] ?? r.acao}</span>
                {r.descricao && <span className="text-[13px] text-text-muted"> · {r.descricao}</span>}
                <div className="text-[11px] text-text-muted">{r.user_nome ?? 'Usuário desconhecido'}</div>
              </div>
              <span className="num shrink-0 text-[12px] text-text-muted">{fmtDataHora(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
